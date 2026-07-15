package com.sunakgo.nais2.transfer

import android.app.job.JobParameters
import android.app.job.JobService
import android.os.Build
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * Android 14+ UIDT execution immediately attaches a notification, then shares
 * checkpoint/outcome handling with WorkManager. Stops become durable retries.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class NaisTransferJobService : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jobs = ConcurrentHashMap<String, Job>()

    override fun onStartJob(params: JobParameters): Boolean {
        val transferId = params.extras.getString(TransferScheduler.EXTRA_TRANSFER_ID)
            ?: return false
        val store = TransferTicketStore(this)
        val initial = try {
            store.status(transferId)
        } catch (_: RuntimeException) {
            return false
        }
        setNotification(
            params,
            TransferNotifications.notificationId(transferId),
            TransferNotifications.notification(this, initial),
            JobService.JOB_END_NOTIFICATION_POLICY_REMOVE,
        )

        jobs[transferId] = scope.launch {
            val shouldReschedule = try {
                runTransfer(store, transferId) { status ->
                    TransferNotifications.update(this@NaisTransferJobService, status)
                } == TransferRunResult.RETRY
            } catch (cancelled: CancellationException) {
                store.markInterrupted(transferId)
                return@launch
            } catch (_: RuntimeException) {
                store.markFailed(transferId, "E_TRANSFER_EXECUTION_FAILED")
                false
            }
            jobs.remove(transferId)
            jobFinished(params, shouldReschedule)
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        val transferId = params.extras.getString(TransferScheduler.EXTRA_TRANSFER_ID)
            ?: return false
        jobs.remove(transferId)?.cancel()
        return try {
            TransferTicketStore(this).markInterrupted(transferId).state == TransferState.RETRY
        } catch (_: RuntimeException) {
            false
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
