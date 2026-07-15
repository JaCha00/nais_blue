package com.sunakgo.nais2.transfer

import android.app.Activity
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * The Tauri plugin connects validated UI commands to durable scheduling only.
 * Transport code must install an executor before application capability changes.
 */
@TauriPlugin
class AndroidTransferPlugin(private val activity: Activity) : Plugin(activity) {
    private val store = TransferTicketStore(activity)
    private val scheduler = TransferScheduler(activity)

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
        val status = store.cancel(transferId)
        scheduler.cancel(transferId)
        TransferNotifications.cancel(activity, transferId)
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

    override fun load(webView: WebView) {
        super.load(webView)
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
        store.recoverableTickets().forEach { ticket ->
            scheduler.schedule(ticket, allowUserInitiatedJob = false)
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
