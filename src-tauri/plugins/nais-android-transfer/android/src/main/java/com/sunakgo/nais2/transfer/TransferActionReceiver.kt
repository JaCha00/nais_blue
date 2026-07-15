package com.sunakgo.nais2.transfer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Notification actions update durable intent before cancelling active work. */
class TransferActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val transferId = intent.getStringExtra(TransferNotifications.EXTRA_TRANSFER_ID) ?: return
        try {
            val store = TransferTicketStore(context)
            when (intent.action) {
                TransferNotifications.ACTION_PAUSE -> store.pause(transferId)
                TransferNotifications.ACTION_CANCEL -> store.cancel(transferId)
                else -> return
            }
            TransferScheduler(context).cancel(transferId)
            TransferNotifications.cancel(context, transferId)
        } catch (_: RuntimeException) {
            // The command is intentionally idempotent and rejected data is never logged.
        }
    }
}
