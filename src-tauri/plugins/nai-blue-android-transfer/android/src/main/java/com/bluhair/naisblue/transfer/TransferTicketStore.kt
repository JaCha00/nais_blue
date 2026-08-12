package com.bluhair.naisblue.transfer

import android.content.Context
import android.content.SharedPreferences
import kotlin.math.min

/**
 * SharedPreferences supplies an atomic, process-recreation-safe checkpoint for
 * fixed fields. The executor resolves opaque references only while it is active.
 */
class TransferTicketStore(context: Context) {
    private val preferences: SharedPreferences = context.applicationContext.getSharedPreferences(
        STORE_NAME,
        Context.MODE_PRIVATE,
    )

    fun create(ticket: TransferTicketSnapshot): TransferStatus = synchronized(LOCK) {
        TransferTicketValidator.validate(ticket)
        val existing = readTicket(ticket.transferId)
        if (existing != null) {
            require(sameIdentity(existing, ticket)) { "Transfer identifier collision" }
            return@synchronized requireStatus(ticket.transferId)
        }

        val now = System.currentTimeMillis()
        val ids = allIds().toMutableSet().apply { add(ticket.transferId) }
        val editor = preferences.edit()
            .putStringSet(KEY_IDS, ids)
            .putString(key(ticket.transferId, FIELD_KIND), ticket.kind.wireName)
            .putString(key(ticket.transferId, FIELD_RESOURCE_REF), ticket.resourceRef)
            .putString(key(ticket.transferId, FIELD_CREDENTIAL_REF), ticket.credentialRef)
            .putString(key(ticket.transferId, FIELD_PEER_REF), ticket.peerDeviceRef)
            .putString(key(ticket.transferId, FIELD_DIGEST), ticket.contentSha256)
            .putLong(key(ticket.transferId, FIELD_SIZE), ticket.sizeBytes)
            .putBoolean(key(ticket.transferId, FIELD_USER_STARTED), ticket.userInitiated)
            .putBoolean(key(ticket.transferId, FIELD_REMOTE_CANCEL_PENDING), false)
        writeStatus(
            editor,
            TransferStatus(
                transferId = ticket.transferId,
                kind = ticket.kind,
                state = TransferState.QUEUED,
                checkpointBytes = ticket.checkpointBytes,
                sizeBytes = ticket.sizeBytes,
                attempt = 0,
                nextAttemptAtEpochMs = 0,
                updatedAtEpochMs = now,
                errorCode = null,
            ),
        )
        require(editor.commit()) { "Transfer state commit failed" }
        requireStatus(ticket.transferId)
    }

    fun ticket(transferId: String): TransferTicketSnapshot = synchronized(LOCK) {
        TransferTicketValidator.validateTransferId(transferId)
        readTicket(transferId) ?: throw IllegalArgumentException("Unknown transfer")
    }

    fun status(transferId: String): TransferStatus = synchronized(LOCK) {
        TransferTicketValidator.validateTransferId(transferId)
        requireStatus(transferId)
    }

    fun pause(transferId: String): TransferStatus = transition(transferId) { current ->
        if (current.state in TERMINAL_STATES) current else current.copy(state = TransferState.PAUSED)
    }

    fun resume(transferId: String): TransferStatus = transition(transferId) { current ->
        require(current.state == TransferState.PAUSED) { "Transfer is not paused" }
        current.copy(state = TransferState.QUEUED, nextAttemptAtEpochMs = 0, errorCode = null)
    }

    fun cancel(transferId: String): TransferStatus = transition(transferId) { current ->
        if (current.state in TERMINAL_STATES) current else {
            preferences.edit()
                .putBoolean(key(transferId, FIELD_REMOTE_CANCEL_PENDING), true)
                .commit()
            current.copy(state = TransferState.CANCELLED)
        }
    }

    fun retry(transferId: String): TransferStatus = transition(transferId) { current ->
        require(current.state in RETRYABLE_STATES) { "Transfer cannot be retried" }
        current.copy(state = TransferState.QUEUED, nextAttemptAtEpochMs = 0, errorCode = null)
    }

    fun advance(transferId: String, checkpointBytes: Long): TransferStatus = transition(transferId) { current ->
        require(checkpointBytes in current.checkpointBytes..current.sizeBytes) {
            "Checkpoint must be monotonic and bounded"
        }
        current.copy(checkpointBytes = checkpointBytes)
    }

    fun markRunning(transferId: String): TransferStatus = transition(transferId) { current ->
        if (current.state !in setOf(TransferState.QUEUED, TransferState.RETRY)) {
            current
        } else {
            current.copy(
                state = TransferState.RUNNING,
                attempt = current.attempt + 1,
                nextAttemptAtEpochMs = 0,
                errorCode = null,
            )
        }
    }

    fun markSucceeded(transferId: String): TransferStatus = transition(transferId) { current ->
        if (current.state in CONTROLLED_STATES) current else current.copy(
            state = TransferState.SUCCEEDED,
            checkpointBytes = current.sizeBytes,
            nextAttemptAtEpochMs = 0,
            errorCode = null,
        )
    }

    fun markBlocked(transferId: String, errorCode: String): TransferStatus = transition(transferId) { current ->
        if (current.state in CONTROLLED_STATES) current else current.copy(
            state = TransferState.BLOCKED,
            nextAttemptAtEpochMs = 0,
            errorCode = errorCode.take(64),
        )
    }

    fun markFailed(transferId: String, errorCode: String): TransferStatus = transition(transferId) { current ->
        if (current.state in CONTROLLED_STATES) current else current.copy(
            state = TransferState.FAILED,
            nextAttemptAtEpochMs = 0,
            errorCode = errorCode.take(64),
        )
    }

    fun markInterrupted(transferId: String): TransferStatus = transition(transferId) { current ->
        if (current.state != TransferState.RUNNING) return@transition current
        val delayMs = retryDelay(current.attempt)
        current.copy(
            state = TransferState.RETRY,
            nextAttemptAtEpochMs = System.currentTimeMillis() + delayMs,
            errorCode = ERROR_INTERRUPTED,
        )
    }

    fun markRetryScheduled(transferId: String, errorCode: String): TransferStatus =
        transition(transferId) { current ->
            if (current.state in CONTROLLED_STATES) current else current.copy(
                state = TransferState.RETRY,
                nextAttemptAtEpochMs = System.currentTimeMillis() + retryDelay(current.attempt),
                errorCode = errorCode.take(64),
            )
        }

    fun recoverInterrupted(): List<TransferStatus> = synchronized(LOCK) {
        allIds().sorted().mapNotNull { transferId ->
            val current = readStatus(transferId) ?: return@mapNotNull null
            if (current.state == TransferState.RUNNING) markInterrupted(transferId) else current
        }
    }

    fun recoverableTickets(): List<TransferTicketSnapshot> = synchronized(LOCK) {
        allIds().sorted().mapNotNull { transferId ->
            val state = readStatus(transferId)?.state ?: return@mapNotNull null
            if (state in setOf(TransferState.QUEUED, TransferState.RETRY)) readTicket(transferId) else null
        }
    }

    fun pendingRemoteCancellations(): List<TransferTicketSnapshot> = synchronized(LOCK) {
        allIds().sorted().mapNotNull { transferId ->
            if (preferences.getBoolean(key(transferId, FIELD_REMOTE_CANCEL_PENDING), false)) {
                readTicket(transferId)
            } else {
                null
            }
        }
    }

    fun markRemoteCancelDelivered(transferId: String) = synchronized(LOCK) {
        require(preferences.edit()
            .putBoolean(key(transferId, FIELD_REMOTE_CANCEL_PENDING), false)
            .commit()) { "Transfer cancel receipt commit failed" }
    }

    private fun transition(
        transferId: String,
        transform: (TransferStatus) -> TransferStatus,
    ): TransferStatus = synchronized(LOCK) {
        TransferTicketValidator.validateTransferId(transferId)
        val current = requireStatus(transferId)
        val next = transform(current).copy(updatedAtEpochMs = System.currentTimeMillis())
        val editor = preferences.edit()
        writeStatus(editor, next)
        require(editor.commit()) { "Transfer state commit failed" }
        next
    }

    private fun allIds(): Set<String> = preferences.getStringSet(KEY_IDS, emptySet())?.toSet().orEmpty()

    private fun sameIdentity(left: TransferTicketSnapshot, right: TransferTicketSnapshot): Boolean =
        left.copy(checkpointBytes = 0) == right.copy(checkpointBytes = 0)

    private fun readTicket(transferId: String): TransferTicketSnapshot? {
        val kind = preferences.getString(key(transferId, FIELD_KIND), null) ?: return null
        val resourceRef = preferences.getString(key(transferId, FIELD_RESOURCE_REF), null) ?: return null
        val credentialRef = preferences.getString(key(transferId, FIELD_CREDENTIAL_REF), null) ?: return null
        val digest = preferences.getString(key(transferId, FIELD_DIGEST), null) ?: return null
        return TransferTicketSnapshot(
            transferId = transferId,
            kind = TransferKind.fromWire(kind),
            resourceRef = resourceRef,
            credentialRef = credentialRef,
            peerDeviceRef = preferences.getString(key(transferId, FIELD_PEER_REF), null),
            contentSha256 = digest,
            sizeBytes = preferences.getLong(key(transferId, FIELD_SIZE), -1),
            checkpointBytes = preferences.getLong(key(transferId, FIELD_CHECKPOINT), 0),
            userInitiated = preferences.getBoolean(key(transferId, FIELD_USER_STARTED), false),
        )
    }

    private fun requireStatus(transferId: String): TransferStatus =
        readStatus(transferId) ?: throw IllegalArgumentException("Unknown transfer")

    private fun readStatus(transferId: String): TransferStatus? {
        val ticket = readTicket(transferId) ?: return null
        val state = preferences.getString(key(transferId, FIELD_STATE), null) ?: return null
        return TransferStatus(
            transferId = transferId,
            kind = ticket.kind,
            state = TransferState.fromWire(state),
            checkpointBytes = preferences.getLong(key(transferId, FIELD_CHECKPOINT), 0),
            sizeBytes = ticket.sizeBytes,
            attempt = preferences.getInt(key(transferId, FIELD_ATTEMPT), 0),
            nextAttemptAtEpochMs = preferences.getLong(key(transferId, FIELD_NEXT_ATTEMPT), 0),
            updatedAtEpochMs = preferences.getLong(key(transferId, FIELD_UPDATED), 0),
            errorCode = preferences.getString(key(transferId, FIELD_ERROR), null),
        )
    }

    private fun writeStatus(editor: SharedPreferences.Editor, status: TransferStatus) {
        editor
            .putString(key(status.transferId, FIELD_STATE), status.state.wireName)
            .putLong(key(status.transferId, FIELD_CHECKPOINT), status.checkpointBytes)
            .putInt(key(status.transferId, FIELD_ATTEMPT), status.attempt)
            .putLong(key(status.transferId, FIELD_NEXT_ATTEMPT), status.nextAttemptAtEpochMs)
            .putLong(key(status.transferId, FIELD_UPDATED), status.updatedAtEpochMs)
        if (status.errorCode == null) {
            editor.remove(key(status.transferId, FIELD_ERROR))
        } else {
            editor.putString(key(status.transferId, FIELD_ERROR), status.errorCode)
        }
    }

    private fun key(transferId: String, field: String): String = "transfer.$transferId.$field"

    private fun retryDelay(attempt: Int): Long =
        min(15 * 60_000L, 5_000L shl min(attempt, 7))

    companion object {
        private val LOCK = Any()
        private const val STORE_NAME = "nais_android_transfer_v1"
        private const val KEY_IDS = "transfer_ids"
        private const val FIELD_KIND = "kind"
        private const val FIELD_RESOURCE_REF = "resource_ref"
        private const val FIELD_CREDENTIAL_REF = "credential_ref"
        private const val FIELD_PEER_REF = "peer_ref"
        private const val FIELD_DIGEST = "digest"
        private const val FIELD_SIZE = "size"
        private const val FIELD_USER_STARTED = "user_started"
        private const val FIELD_REMOTE_CANCEL_PENDING = "remote_cancel_pending"
        private const val FIELD_STATE = "state"
        private const val FIELD_CHECKPOINT = "checkpoint"
        private const val FIELD_ATTEMPT = "attempt"
        private const val FIELD_NEXT_ATTEMPT = "next_attempt"
        private const val FIELD_UPDATED = "updated"
        private const val FIELD_ERROR = "error"
        private const val ERROR_INTERRUPTED = "E_TRANSFER_INTERRUPTED"
        private val TERMINAL_STATES = setOf(TransferState.CANCELLED, TransferState.SUCCEEDED)
        private val CONTROLLED_STATES = setOf(
            TransferState.PAUSED,
            TransferState.CANCELLED,
            TransferState.SUCCEEDED,
        )
        private val RETRYABLE_STATES = setOf(
            TransferState.RETRY,
            TransferState.BLOCKED,
            TransferState.FAILED,
        )
    }
}
