package com.bluhair.naisblue.transfer

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException

/**
 * WorkManager owns API 24-33 execution and restart. ForegroundInfo connects it
 * to the same notification and durable state used by the API 34+ UIDT service.
 */
class NaisTransferWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    private val transferId = inputData.getString(TransferScheduler.EXTRA_TRANSFER_ID)

    override suspend fun doWork(): Result {
        TransferExecutionRegistry.installIfAbsent(CloudflareTransferExecutor(applicationContext))
        val id = transferId ?: return Result.failure()
        val store = TransferTicketStore(applicationContext)
        return try {
            setForeground(TransferNotifications.foregroundInfo(applicationContext, store.status(id)))
            when (runTransfer(store, id) { status ->
                setForeground(TransferNotifications.foregroundInfo(applicationContext, status))
            }) {
                TransferRunResult.COMPLETE, TransferRunResult.CONTROLLED -> Result.success()
                TransferRunResult.RETRY -> Result.retry()
                TransferRunResult.BLOCKED, TransferRunResult.FAILED -> Result.failure()
            }
        } catch (cancelled: CancellationException) {
            store.markInterrupted(id)
            throw cancelled
        } catch (_: RuntimeException) {
            store.markFailed(id, "E_TRANSFER_EXECUTION_FAILED")
            Result.failure()
        }
    }

}
