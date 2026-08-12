package com.bluhair.naisblue.transfer

import app.tauri.annotation.InvokeArg
import app.tauri.plugin.JSObject

/**
 * Fixed bridge models connect Rust validation, durable state, and both Android
 * schedulers. They intentionally carry references and counters, never payloads.
 */
enum class TransferKind(val wireName: String) {
    R2_UPLOAD("r2-upload"),
    LAN_BLOB("lan-blob");

    companion object {
        fun fromWire(value: String): TransferKind =
            entries.firstOrNull { it.wireName == value }
                ?: throw IllegalArgumentException("Unsupported transfer kind")
    }
}

enum class TransferState(val wireName: String) {
    QUEUED("queued"),
    RUNNING("running"),
    PAUSED("paused"),
    RETRY("retry"),
    BLOCKED("blocked"),
    CANCELLED("cancelled"),
    SUCCEEDED("succeeded"),
    FAILED("failed");

    companion object {
        fun fromWire(value: String): TransferState =
            entries.firstOrNull { it.wireName == value } ?: FAILED
    }
}

@InvokeArg
class TransferTicket {
    lateinit var transferId: String
    lateinit var kind: String
    lateinit var resourceRef: String
    lateinit var credentialRef: String
    var peerDeviceRef: String? = null
    lateinit var contentSha256: String
    var sizeBytes: Long = 0
    var checkpointBytes: Long = 0
    var userInitiated: Boolean = false

    fun snapshot(): TransferTicketSnapshot = TransferTicketSnapshot(
        transferId = transferId,
        kind = TransferKind.fromWire(kind),
        resourceRef = resourceRef,
        credentialRef = credentialRef,
        peerDeviceRef = peerDeviceRef,
        contentSha256 = contentSha256,
        sizeBytes = sizeBytes,
        checkpointBytes = checkpointBytes,
        userInitiated = userInitiated,
    )
}

data class TransferTicketSnapshot(
    val transferId: String,
    val kind: TransferKind,
    val resourceRef: String,
    val credentialRef: String,
    val peerDeviceRef: String?,
    val contentSha256: String,
    val sizeBytes: Long,
    val checkpointBytes: Long,
    val userInitiated: Boolean,
)

data class TransferStatus(
    val transferId: String,
    val kind: TransferKind,
    val state: TransferState,
    val checkpointBytes: Long,
    val sizeBytes: Long,
    val attempt: Int,
    val nextAttemptAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val errorCode: String?,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("transferId", transferId)
        put("kind", kind.wireName)
        put("state", state.wireName)
        put("checkpointBytes", checkpointBytes)
        put("sizeBytes", sizeBytes)
        put("attempt", attempt)
        put("nextAttemptAtEpochMs", nextAttemptAtEpochMs)
        put("updatedAtEpochMs", updatedAtEpochMs)
        put("errorCode", errorCode)
    }
}

@InvokeArg
class ScheduleArgs {
    lateinit var ticket: TransferTicket
}

@InvokeArg
class TransferIdArgs {
    lateinit var transferId: String
}

@InvokeArg
class CheckpointArgs {
    lateinit var transferId: String
    var checkpointBytes: Long = 0
}

@InvokeArg
class CloudflarePairingArgs {
    lateinit var credentialRef: String
    lateinit var endpoint: String
    lateinit var deviceId: String
    lateinit var pairingCapability: String
}

data class CloudflarePairingStatus(
    val credentialRef: String,
    val deviceId: String,
    val configured: Boolean,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("credentialRef", credentialRef)
        put("deviceId", deviceId)
        put("configured", configured)
    }
}
