package com.sunakgo.nais2.transfer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.work.ForegroundInfo
import kotlin.math.roundToInt

/**
 * Notifications link both schedulers to user-visible pause/cancel controls and
 * display counters only; opaque references and content never enter UI extras.
 */
object TransferNotifications {
    const val ACTION_PAUSE = "com.sunakgo.nais2.transfer.PAUSE"
    const val ACTION_CANCEL = "com.sunakgo.nais2.transfer.CANCEL"
    const val EXTRA_TRANSFER_ID = "transfer_id"
    private const val CHANNEL_ID = "nais_large_transfers"

    fun notification(context: Context, status: TransferStatus): Notification {
        ensureChannel(context)
        val progress = if (status.sizeBytes == 0L) 0 else
            ((status.checkpointBytes.toDouble() / status.sizeBytes) * 100).roundToInt().coerceIn(0, 100)
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, CHANNEL_ID)
        } else {
            Notification.Builder(context)
        }
        builder
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("NAIS transfer")
            .setContentText("$progress% complete")
            .setProgress(100, progress, false)
            .setOngoing(status.state !in setOf(TransferState.CANCELLED, TransferState.SUCCEEDED, TransferState.FAILED))
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_media_pause,
                    "Pause",
                    action(context, status.transferId, ACTION_PAUSE, 1),
                ).build(),
            )
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_menu_close_clear_cancel,
                    "Cancel",
                    action(context, status.transferId, ACTION_CANCEL, 2),
                ).build(),
            )

        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launchIntent ->
            builder.setContentIntent(
                PendingIntent.getActivity(
                    context,
                    notificationId(status.transferId),
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
        }
        return builder.build()
    }

    fun foregroundInfo(context: Context, status: TransferStatus): ForegroundInfo {
        val notification = notification(context, status)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(
                notificationId(status.transferId),
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            ForegroundInfo(notificationId(status.transferId), notification)
        }
    }

    fun update(context: Context, status: TransferStatus) {
        context.getSystemService(NotificationManager::class.java)
            ?.notify(notificationId(status.transferId), notification(context, status))
    }

    fun cancel(context: Context, transferId: String) {
        context.getSystemService(NotificationManager::class.java)
            ?.cancel(notificationId(transferId))
    }

    fun notificationId(transferId: String): Int =
        (transferId.hashCode() and 0x3fffffff) or 0x40000000

    private fun action(
        context: Context,
        transferId: String,
        action: String,
        offset: Int,
    ): PendingIntent {
        val intent = Intent(context, TransferActionReceiver::class.java)
            .setAction(action)
            .putExtra(EXTRA_TRANSFER_ID, transferId)
        return PendingIntent.getBroadcast(
            context,
            notificationId(transferId) + offset,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Large transfers",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Progress and controls for user-started NAIS transfers"
            },
        )
    }
}
