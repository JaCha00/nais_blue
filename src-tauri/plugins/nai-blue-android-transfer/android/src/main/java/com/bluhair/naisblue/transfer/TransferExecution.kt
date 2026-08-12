package com.bluhair.naisblue.transfer

import java.util.concurrent.ConcurrentHashMap

/**
 * The scheduler depends on this narrow executor seam. The Cloudflare R2
 * implementation installs in UI and headless processes while unsupported LAN
 * tickets remain visibly blocked instead of reporting success.
 */
interface TransferExecutor {
    suspend fun execute(
        ticket: TransferTicketSnapshot,
        reportCheckpoint: suspend (Long) -> Unit,
    ): TransferOutcome

    /** Remote cancellation commits a tombstone independently of local work cancellation. */
    suspend fun cancel(ticket: TransferTicketSnapshot): TransferOutcome
}

sealed interface TransferOutcome {
    data object Succeeded : TransferOutcome
    data class Retry(val errorCode: String) : TransferOutcome
    data class Failed(val errorCode: String) : TransferOutcome
    data class Blocked(val errorCode: String) : TransferOutcome
}

object TransferExecutionRegistry {
    @Volatile
    private var executor: TransferExecutor? = null

    /** Installation is explicit so capability discovery can remain false first. */
    fun install(value: TransferExecutor) {
        executor = value
    }

    /** Headless JobService/WorkManager startup installs the same executor once. */
    fun installIfAbsent(value: TransferExecutor) {
        if (executor == null) synchronized(this) {
            if (executor == null) executor = value
        }
    }

    internal suspend fun cancel(ticket: TransferTicketSnapshot): TransferOutcome =
        executor?.cancel(ticket) ?: TransferOutcome.Blocked(ERROR_EXECUTOR_UNAVAILABLE)

    internal suspend fun execute(
        ticket: TransferTicketSnapshot,
        reportCheckpoint: suspend (Long) -> Unit,
    ): TransferOutcome = executor?.execute(ticket, reportCheckpoint)
        ?: TransferOutcome.Blocked(ERROR_EXECUTOR_UNAVAILABLE)

    private const val ERROR_EXECUTOR_UNAVAILABLE = "E_TRANSFER_EXECUTOR_UNAVAILABLE"
}

enum class TransferRunResult {
    COMPLETE,
    RETRY,
    BLOCKED,
    FAILED,
    CONTROLLED,
}

/**
 * JobScheduler and WorkManager share the default app process and this gate.
 * It links both lifecycle owners, rejects their recovery race, and releases in
 * finally so process recreation may resume from the durable checkpoint.
 */
private val ACTIVE_TRANSFERS = ConcurrentHashMap.newKeySet<String>()

/** Shared outcome handling keeps UIDT and WorkManager state transitions equal. */
suspend fun runTransfer(
    store: TransferTicketStore,
    transferId: String,
    reportStatus: suspend (TransferStatus) -> Unit,
): TransferRunResult {
    if (!ACTIVE_TRANSFERS.add(transferId)) return TransferRunResult.CONTROLLED
    try {
        return runExclusiveTransfer(store, transferId, reportStatus)
    } finally {
        ACTIVE_TRANSFERS.remove(transferId)
    }
}

private suspend fun runExclusiveTransfer(
    store: TransferTicketStore,
    transferId: String,
    reportStatus: suspend (TransferStatus) -> Unit,
): TransferRunResult {
    val running = store.markRunning(transferId)
    reportStatus(running)
    if (running.state != TransferState.RUNNING) return TransferRunResult.CONTROLLED

    val ticket = store.ticket(transferId)
    return when (val outcome = TransferExecutionRegistry.execute(ticket) { checkpoint ->
        reportStatus(store.advance(transferId, checkpoint))
    }) {
        TransferOutcome.Succeeded -> {
            reportStatus(store.markSucceeded(transferId))
            TransferRunResult.COMPLETE
        }
        is TransferOutcome.Retry -> {
            reportStatus(store.markRetryScheduled(transferId, safeCode(outcome.errorCode)))
            TransferRunResult.RETRY
        }
        is TransferOutcome.Blocked -> {
            reportStatus(store.markBlocked(transferId, safeCode(outcome.errorCode)))
            TransferRunResult.BLOCKED
        }
        is TransferOutcome.Failed -> {
            reportStatus(store.markFailed(transferId, safeCode(outcome.errorCode)))
            TransferRunResult.FAILED
        }
    }
}

private fun safeCode(value: String): String =
    if (Regex("^E_[A-Z0-9_]{1,61}$").matches(value)) value else "E_TRANSFER_EXECUTION_FAILED"
