package com.bluhair.naisblue.transfer

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.PersistableBundle
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit
import kotlin.math.max

/**
 * API 34+ user actions use Android's UIDT contract; older devices and recovery
 * use a unique foreground WorkManager request with the same durable transfer id.
 */
class TransferScheduler(private val context: Context) {
    private val applicationContext = context.applicationContext

    fun schedule(ticket: TransferTicketSnapshot, allowUserInitiatedJob: Boolean) {
        TransferTicketValidator.validate(ticket)
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            applicationContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            throw IllegalStateException("Notification permission required")
        }
        val status = TransferTicketStore(applicationContext).status(ticket.transferId)
        val delayMs = max(0, status.nextAttemptAtEpochMs - System.currentTimeMillis())
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
            ticket.userInitiated &&
            allowUserInitiatedJob &&
            delayMs == 0L
        ) {
            // A fresh user action promotes the transfer to UIDT; the shared
            // execution gate covers the asynchronous WorkManager cancellation.
            WorkManager.getInstance(applicationContext).cancelUniqueWork(workName(ticket.transferId))
            scheduleUserInitiated(ticket, status)
        } else {
            // Recovery must not create a fallback while the platform still
            // owns the same UIDT job. JobService remains the durable resumer.
            if (hasPendingUserInitiatedJob(ticket.transferId)) return
            scheduleWork(ticket.transferId, delayMs)
        }
    }

    fun cancel(transferId: String) {
        TransferTicketValidator.validateTransferId(transferId)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            applicationContext.getSystemService(JobScheduler::class.java)
                ?.cancel(jobId(transferId))
        }
        WorkManager.getInstance(applicationContext).cancelUniqueWork(workName(transferId))
    }

    private fun hasPendingUserInitiatedJob(transferId: String): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
            applicationContext.getSystemService(JobScheduler::class.java)
                ?.getPendingJob(jobId(transferId)) != null

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private fun scheduleUserInitiated(ticket: TransferTicketSnapshot, status: TransferStatus) {
        val extras = PersistableBundle().apply {
            putString(EXTRA_TRANSFER_ID, ticket.transferId)
        }
        val networkBuilder = NetworkRequest.Builder()
        if (ticket.kind == TransferKind.R2_UPLOAD) {
            networkBuilder.addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        }
        val network = networkBuilder.build()
        val remainingBytes = max(0, status.sizeBytes - status.checkpointBytes)
        val info = JobInfo.Builder(
            jobId(ticket.transferId),
            ComponentName(applicationContext, NaisTransferJobService::class.java),
        )
            .setExtras(extras)
            .setRequiredNetwork(network)
            .setUserInitiated(true)
            .setEstimatedNetworkBytes(0L, remainingBytes)
            .build()

        val scheduler = applicationContext.getSystemService(JobScheduler::class.java)
            ?: throw IllegalStateException("Scheduler unavailable")
        if (scheduler.getPendingJob(jobId(ticket.transferId)) != null) return
        check(scheduler.schedule(info) == JobScheduler.RESULT_SUCCESS) {
            "Scheduler rejected transfer"
        }
    }

    private fun scheduleWork(transferId: String, delayMs: Long) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val input = Data.Builder().putString(EXTRA_TRANSFER_ID, transferId).build()
        val request = OneTimeWorkRequestBuilder<NaisTransferWorker>()
            .setInputData(input)
            .setConstraints(constraints)
            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
            .addTag(WORK_TAG)
            .build()

        WorkManager.getInstance(applicationContext).enqueueUniqueWork(
            workName(transferId),
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    companion object {
        const val EXTRA_TRANSFER_ID = "nais_transfer_id"
        private const val WORK_TAG = "nais_android_transfer"

        fun workName(transferId: String): String = "nais-transfer-$transferId"

        fun jobId(transferId: String): Int =
            (transferId.hashCode() and 0x3fffffff) or 0x20000000
    }
}
