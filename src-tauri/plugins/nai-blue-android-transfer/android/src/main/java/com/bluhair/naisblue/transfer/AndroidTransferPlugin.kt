package com.bluhair.naisblue.transfer

import android.app.Activity
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The Tauri plugin connects validated UI commands to durable scheduling only.
 * Transport code must install an executor before application capability changes.
 */
@TauriPlugin
class AndroidTransferPlugin(private val activity: Activity) : Plugin(activity) {
    private val store = TransferTicketStore(activity)
    private val scheduler = TransferScheduler(activity)
    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Command
    fun schedule(invoke: Invoke) = respond(invoke) {
        val ticket = invoke.parseArgs(ScheduleArgs::class.java).ticket.snapshot()
        TransferTicketValidator.validate(ticket)
        val status = store.create(ticket)
        if (status.state in setOf(TransferState.QUEUED, TransferState.RETRY)) {
            scheduler.schedule(ticket, allowUserInitiatedJob = true)
        }
        status.toJs()
    }

    @Command
    fun pause(invoke: Invoke) = control(invoke) { transferId ->
        val status = store.pause(transferId)
        scheduler.cancel(transferId)
        TransferNotifications.cancel(activity, transferId)
        status
    }

    @Command
    fun resume(invoke: Invoke) = control(invoke) { transferId ->
        val status = store.resume(transferId)
        scheduler.cancel(transferId)
        scheduler.schedule(store.ticket(transferId), allowUserInitiatedJob = true)
        status
    }

    @Command
    fun cancel(invoke: Invoke) = control(invoke) { transferId ->
        val ticket = store.ticket(transferId)
        val status = store.cancel(transferId)
        scheduler.cancel(transferId)
        TransferNotifications.cancel(activity, transferId)
        sendRemoteCancel(ticket)
        status
    }

    @Command
    fun retry(invoke: Invoke) = control(invoke) { transferId ->
        val status = store.retry(transferId)
        scheduler.cancel(transferId)
        scheduler.schedule(store.ticket(transferId), allowUserInitiatedJob = true)
        status
    }

    @Command
    fun checkpoint(invoke: Invoke) = respond(invoke) {
        val args = invoke.parseArgs(CheckpointArgs::class.java)
        store.advance(args.transferId, args.checkpointBytes).toJs()
    }

    @Command
    fun status(invoke: Invoke) = control(invoke) { transferId ->
        store.status(transferId)
    }

    @Command
    fun recover(invoke: Invoke) = respond(invoke) {
        recoverTransfers()
        JSObject().apply {
            put("statuses", JSArray().apply {
                store.recoverInterrupted().forEach { put(it.toJs()) }
            })
        }
    }

    @Command
    fun configureCloudflare(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(CloudflarePairingArgs::class.java)
        } catch (_: RuntimeException) {
            invoke.reject("Cloudflare pairing rejected", "E_TRANSFER_INVALID")
            return
        }
        backgroundScope.launch {
            try {
                invoke.resolve(CloudflarePairingClient(activity).configure(args).toJs())
            } catch (_: IllegalArgumentException) {
                invoke.reject("Cloudflare pairing rejected", "E_TRANSFER_INVALID")
            } catch (_: RuntimeException) {
                invoke.reject("Cloudflare pairing failed", "E_TRANSFER_PAIRING")
            }
        }
    }

    override fun load(webView: WebView) {
        super.load(webView)
        TransferExecutionRegistry.installIfAbsent(CloudflareTransferExecutor(activity))
        // Recovery may run after background process recreation, so it never claims
        // a fresh UI gesture and therefore does not schedule a UIDT implicitly.
        try {
            recoverTransfers()
        } catch (_: RuntimeException) {
            // Durable state remains available for an explicit user retry.
        }
    }

    private fun recoverTransfers() {
        store.recoverInterrupted()
        store.pendingRemoteCancellations().forEach(::sendRemoteCancel)
        store.recoverableTickets().forEach { ticket ->
            scheduler.schedule(ticket, allowUserInitiatedJob = false)
        }
    }

    private fun sendRemoteCancel(ticket: TransferTicketSnapshot) {
        backgroundScope.launch {
            if (TransferExecutionRegistry.cancel(ticket) == TransferOutcome.Succeeded) {
                store.markRemoteCancelDelivered(ticket.transferId)
            }
        }
    }

    private fun control(
        invoke: Invoke,
        operation: (String) -> TransferStatus,
    ) = respond(invoke) {
        val transferId = invoke.parseArgs(TransferIdArgs::class.java).transferId
        TransferTicketValidator.validateTransferId(transferId)
        operation(transferId).toJs()
    }

    private inline fun respond(invoke: Invoke, operation: () -> JSObject) {
        try {
            invoke.resolve(operation())
        } catch (_: IllegalArgumentException) {
            invoke.reject("Transfer request rejected", "E_TRANSFER_INVALID")
        } catch (_: IllegalStateException) {
            invoke.reject("Transfer state rejected", "E_TRANSFER_STATE")
        } catch (_: RuntimeException) {
            invoke.reject("Transfer scheduling failed", "E_TRANSFER_NATIVE")
        }
    }
}
