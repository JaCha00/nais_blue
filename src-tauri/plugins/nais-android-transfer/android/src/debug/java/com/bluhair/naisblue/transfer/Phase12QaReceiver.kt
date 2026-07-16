package com.bluhair.naisblue.transfer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * ADB uses this debug-only, DUMP-protected boundary to create synthetic bytes,
 * inspect sanitized state, and prove the real executor lifecycle. It accepts no
 * capability, token, image, prompt, arbitrary path, or caller-provided bytes.
 */
class Phase12QaReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try {
            resultData = when (intent.action) {
                ACTION_PREPARE -> prepare(context, intent)
                ACTION_CONFIRM -> confirm(context, intent)
                ACTION_RUN -> run(context, intent)
                ACTION_STATUS -> status(context, intent)
                else -> throw IllegalArgumentException("Unknown QA action")
            }
            resultCode = 0
        } catch (_: RuntimeException) {
            resultCode = 1
            resultData = "E_PHASE12_QA"
        }
    }

    private fun prepare(context: Context, intent: Intent): String {
        val credentialRef = required(intent, EXTRA_CREDENTIAL_REF)
        return CloudflareCredentialStore(context).preparePublicKey(credentialRef)
    }

    private fun confirm(context: Context, intent: Intent): String {
        CloudflareCredentialStore(context).saveVerifiedProfile(
            required(intent, EXTRA_CREDENTIAL_REF),
            required(intent, EXTRA_ENDPOINT),
            required(intent, EXTRA_DEVICE_ID),
        )
        TransferExecutionRegistry.installIfAbsent(CloudflareTransferExecutor(context))
        return "configured"
    }

    private fun run(context: Context, intent: Intent): String {
        val transferId = required(intent, EXTRA_TRANSFER_ID)
        val sizeBytes = intent.getLongExtra(EXTRA_SIZE_BYTES, 0L)
        require(sizeBytes in 1..MAX_QA_BYTES)
        val relative = "phase12-qa/$transferId.bin"
        val file = File(context.dataDir, relative)
        require(file.parentFile?.mkdirs() != false)
        val digest = MessageDigest.getInstance("SHA-256")
        val block = ByteArray(64 * 1024) { index -> ((index * 31 + transferId.length) and 0xff).toByte() }
        var remaining = sizeBytes
        file.outputStream().buffered().use { output ->
            while (remaining > 0) {
                val count = minOf(block.size.toLong(), remaining).toInt()
                output.write(block, 0, count)
                digest.update(block, 0, count)
                remaining -= count
            }
        }
        val ticket = TransferTicketSnapshot(
            transferId = transferId,
            kind = TransferKind.R2_UPLOAD,
            resourceRef = "appdata:$relative",
            credentialRef = required(intent, EXTRA_CREDENTIAL_REF),
            peerDeviceRef = null,
            contentSha256 = "sha256:${digest.digest().joinToString("") { byte -> "%02x".format(byte) }}",
            sizeBytes = sizeBytes,
            checkpointBytes = 0,
            userInitiated = true,
        )
        val store = TransferTicketStore(context)
        store.create(ticket)
        TransferScheduler(context).schedule(ticket, allowUserInitiatedJob = true)
        return "scheduled"
    }

    private fun status(context: Context, intent: Intent): String {
        val value = TransferTicketStore(context).status(required(intent, EXTRA_TRANSFER_ID))
        return JSONObject()
            .put("transferId", value.transferId)
            .put("state", value.state.wireName)
            .put("checkpointBytes", value.checkpointBytes)
            .put("sizeBytes", value.sizeBytes)
            .put("attempt", value.attempt)
            .put("errorCode", value.errorCode)
            .toString()
    }

    private fun required(intent: Intent, name: String): String =
        intent.getStringExtra(name)?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("Missing QA field")

    companion object {
        const val ACTION_PREPARE = "com.bluhair.naisblue.transfer.qa.PREPARE"
        const val ACTION_CONFIRM = "com.bluhair.naisblue.transfer.qa.CONFIRM"
        const val ACTION_RUN = "com.bluhair.naisblue.transfer.qa.RUN"
        const val ACTION_STATUS = "com.bluhair.naisblue.transfer.qa.STATUS"
        const val EXTRA_CREDENTIAL_REF = "credential_ref"
        const val EXTRA_ENDPOINT = "endpoint"
        const val EXTRA_DEVICE_ID = "device_id"
        const val EXTRA_TRANSFER_ID = "transfer_id"
        const val EXTRA_SIZE_BYTES = "size_bytes"
        private const val MAX_QA_BYTES = 256L * 1024L * 1024L
    }
}
