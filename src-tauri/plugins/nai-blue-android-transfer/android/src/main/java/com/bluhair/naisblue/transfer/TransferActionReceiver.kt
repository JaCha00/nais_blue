package com.bluhair.naisblue.transfer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Notification actions update durable intent before cancelling active work. */
class TransferActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val transferId = intent.getStringExtra(TransferNotifications.EXTRA_TRANSFER_ID) ?: return
        try {
            val store = TransferTicketStore(context)
            when (intent.action) {
                TransferNotifications.ACTION_PAUSE -> {
                    store.pause(transferId)
                    TransferScheduler(context).cancel(transferId)
                    TransferNotifications.update(context, store.status(transferId))
                }
                TransferNotifications.ACTION_RESUME -> {
                    store.resume(transferId)
                    TransferScheduler(context).run {
                        cancel(transferId)
                        schedule(store.ticket(transferId), allowUserInitiatedJob = true)
                    }
                }
                TransferNotifications.ACTION_RETRY -> {
                    store.retry(transferId)
                    TransferScheduler(context).run {
                        cancel(transferId)
                        schedule(store.ticket(transferId), allowUserInitiatedJob = true)
                    }
                }
                TransferNotifications.ACTION_CANCEL -> {
                    val ticket = store.ticket(transferId)
                    store.cancel(transferId)
                    TransferExecutionRegistry.installIfAbsent(CloudflareTransferExecutor(context))
                    val pending = goAsync()
                    CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                        try {
                            if (TransferExecutionRegistry.cancel(ticket) == TransferOutcome.Succeeded) {
                                store.markRemoteCancelDelivered(transferId)
                            }
                        } finally {
                            pending.finish()
                        }
                    }
                }
                else -> return
            }
            if (intent.action == TransferNotifications.ACTION_CANCEL) {
                TransferScheduler(context).cancel(transferId)
                TransferNotifications.cancel(context, transferId)
            }
        } catch (_: RuntimeException) {
            // The command is intentionally idempotent and rejected data is never logged.
        }
    }
}
