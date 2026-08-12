package com.bluhair.naisblue.transfer

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.security.Signature
import kotlin.math.min

private const val PART_BYTES = 5 * 1024 * 1024
private const val MAX_RESPONSE_BYTES = 64 * 1024

data class CloudflareResponse(val status: Int, val body: JSONObject)

/**
 * This executor resolves app-scoped bytes only at execution time, signs every
 * request with the paired Android Keystore key, and advances the durable local
 * checkpoint only after the Worker/Durable Object has acknowledged the part.
 */
class CloudflareTransferExecutor(context: Context) : TransferExecutor {
    private val applicationContext = context.applicationContext
    private val credentials = CloudflareCredentialStore(applicationContext)
    private val client = CloudflareRequestClient(credentials)

    override suspend fun execute(
        ticket: TransferTicketSnapshot,
        reportCheckpoint: suspend (Long) -> Unit,
    ): TransferOutcome {
        if (ticket.kind != TransferKind.R2_UPLOAD) {
            return TransferOutcome.Blocked("E_TRANSFER_KIND_UNSUPPORTED")
        }
        val profile = credentials.profile(ticket.credentialRef)
            ?: return TransferOutcome.Blocked("E_TRANSFER_CREDENTIAL_MISSING")
        val file = try {
            resolveResource(ticket)
        } catch (_: RuntimeException) {
            return TransferOutcome.Failed("E_TRANSFER_RESOURCE_INVALID")
        }
        if (file.length() != ticket.sizeBytes || digest(file) != ticket.contentSha256) {
            return TransferOutcome.Failed("E_TRANSFER_RESOURCE_DIGEST")
        }

        return try {
            val start = client.signed(
                profile,
                "POST",
                "/v1/transfers/${ticket.transferId}/start",
                JSONObject()
                    .put("transferId", ticket.transferId)
                    .put("kind", "r2-upload")
                    .put("contentSha256", ticket.contentSha256.lowercase())
                    .put("sizeBytes", ticket.sizeBytes)
                    .toString()
                    .toByteArray(),
                operation = "start:${ticket.transferId}",
                contentType = "application/json",
            )
            if (start.status !in 200..299) return classify(start)
            if (start.body.optString("state") == "succeeded") {
                reportCheckpoint(ticket.sizeBytes)
                return TransferOutcome.Succeeded
            }
            var checkpoint = start.body.optLong("checkpointBytes", -1L)
            if (checkpoint !in ticket.checkpointBytes..ticket.sizeBytes || checkpoint % PART_BYTES != 0L) {
                return TransferOutcome.Failed("E_TRANSFER_CHECKPOINT_DIVERGED")
            }
            if (checkpoint > ticket.checkpointBytes) reportCheckpoint(checkpoint)

            RandomAccessFile(file, "r").use { source ->
                while (checkpoint < ticket.sizeBytes) {
                    currentCoroutineContext().ensureActive()
                    val length = min(PART_BYTES.toLong(), ticket.sizeBytes - checkpoint).toInt()
                    val bytes = ByteArray(length)
                    source.seek(checkpoint)
                    source.readFully(bytes)
                    val partNumber = (checkpoint / PART_BYTES).toInt() + 1
                    val partDigest = "sha256:${CloudflareCredentialStore.sha256Hex(bytes)}"
                    val uploaded = client.signed(
                        profile,
                        "PUT",
                        "/v1/transfers/${ticket.transferId}/parts/$partNumber",
                        bytes,
                        operation = "part:${ticket.transferId}:$partNumber",
                        contentType = "application/octet-stream",
                        partDigest = partDigest,
                    )
                    if (uploaded.status !in 200..299) return classify(uploaded)
                    val acknowledged = uploaded.body.optLong("checkpointBytes", -1L)
                    if (acknowledged != checkpoint + length) {
                        return TransferOutcome.Failed("E_TRANSFER_CHECKPOINT_DIVERGED")
                    }
                    checkpoint = acknowledged
                    reportCheckpoint(checkpoint)
                }
            }
            currentCoroutineContext().ensureActive()
            val completed = client.signed(
                profile,
                "POST",
                "/v1/transfers/${ticket.transferId}/complete",
                ByteArray(0),
                operation = "complete:${ticket.transferId}",
                contentType = "application/json",
            )
            if (completed.status in 200..299 && completed.body.optString("state") == "succeeded") {
                TransferOutcome.Succeeded
            } else {
                classify(completed)
            }
        } catch (_: IOException) {
            TransferOutcome.Retry("E_TRANSFER_NETWORK_RETRY")
        } catch (_: RuntimeException) {
            TransferOutcome.Failed("E_TRANSFER_EXECUTION_FAILED")
        }
    }

    override suspend fun cancel(ticket: TransferTicketSnapshot): TransferOutcome {
        val profile = credentials.profile(ticket.credentialRef)
            ?: return TransferOutcome.Blocked("E_TRANSFER_CREDENTIAL_MISSING")
        return try {
            val response = client.signed(
                profile,
                "POST",
                "/v1/transfers/${ticket.transferId}/cancel",
                ByteArray(0),
                operation = "cancel:${ticket.transferId}",
                contentType = "application/json",
            )
            if (response.status in 200..299 || response.body.optString("code") == "E_TRANSFER_NOT_FOUND") {
                TransferOutcome.Succeeded
            } else {
                classify(response)
            }
        } catch (_: IOException) {
            TransferOutcome.Retry("E_TRANSFER_NETWORK_RETRY")
        } catch (_: RuntimeException) {
            TransferOutcome.Failed("E_TRANSFER_EXECUTION_FAILED")
        }
    }

    private fun resolveResource(ticket: TransferTicketSnapshot): java.io.File {
        val relative = ticket.resourceRef.removePrefix("appdata:")
        require(relative.isNotEmpty() && !relative.contains("..") && !relative.startsWith('/'))
        val root = applicationContext.dataDir.canonicalFile
        val file = java.io.File(root, relative).canonicalFile
        require(file.path.startsWith(root.path + java.io.File.separator) && file.isFile)
        return file
    }

    private fun digest(file: java.io.File): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { source ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = source.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return "sha256:${digest.digest().joinToString("") { byte -> "%02x".format(byte) }}"
    }

    private fun classify(response: CloudflareResponse): TransferOutcome {
        val remoteCode = response.body.optString("code")
            .takeIf { Regex("^E_[A-Z0-9_]{1,61}$").matches(it) }
            ?: "E_TRANSFER_REMOTE_FAILED"
        return when {
            response.status == 401 || response.status == 403 -> TransferOutcome.Blocked("E_TRANSFER_AUTH")
            response.status in setOf(408, 425, 429) || response.status >= 500 ->
                TransferOutcome.Retry("E_TRANSFER_REMOTE_RETRY")
            else -> TransferOutcome.Failed(remoteCode)
        }
    }
}

class CloudflarePairingClient(private val context: Context) {
    private val credentials = CloudflareCredentialStore(context)

    fun configure(args: CloudflarePairingArgs): CloudflarePairingStatus {
        credentials.validateConfiguration(args)
        val publicKey = credentials.preparePublicKey(args.credentialRef)
        val connection = open(args.endpoint.trimEnd('/') + "/v1/pair", "POST")
        return try {
            val body = JSONObject()
                .put("deviceId", args.deviceId)
                .put("publicKeySpki", publicKey)
                .toString()
                .toByteArray()
            connection.setRequestProperty("content-type", "application/json")
            connection.setRequestProperty("x-nais-pairing-capability", args.pairingCapability)
            write(connection, body)
            val response = read(connection)
            if (response.status !in 200..299 || !response.body.optBoolean("paired", false)) {
                throw IllegalStateException("Pairing rejected")
            }
            credentials.saveProfile(args)
            CloudflarePairingStatus(args.credentialRef, args.deviceId, true)
        } finally {
            connection.disconnect()
        }
    }
}

private class CloudflareRequestClient(private val credentials: CloudflareCredentialStore) {
    private val random = SecureRandom()

    fun signed(
        profile: CloudflareProfile,
        method: String,
        path: String,
        body: ByteArray,
        operation: String,
        contentType: String,
        partDigest: String? = null,
    ): CloudflareResponse {
        val sequence = credentials.nextSequence(profile.credentialRef)
        val nonceBytes = ByteArray(18).also(random::nextBytes)
        val nonce = Base64.encodeToString(nonceBytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val timestamp = System.currentTimeMillis()
        val bodyDigest = "sha256:${CloudflareCredentialStore.sha256Hex(body)}"
        val idempotency = "op:${CloudflareCredentialStore.sha256Hex(operation.toByteArray()).take(40)}"
        val canonical = listOf(method, path, sequence, nonce, timestamp, idempotency, bodyDigest).joinToString("\n")
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(credentials.privateKey(profile.keyAlias))
        signer.update(canonical.toByteArray())
        val signature = Base64.encodeToString(
            derToRaw(signer.sign()),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
        )

        val connection = open(profile.endpoint + path, method)
        return try {
            connection.setRequestProperty("content-type", contentType)
            connection.setRequestProperty("x-nais-device", profile.deviceId)
            connection.setRequestProperty("x-nais-sequence", sequence.toString())
            connection.setRequestProperty("x-nais-nonce", nonce)
            connection.setRequestProperty("x-nais-timestamp", timestamp.toString())
            connection.setRequestProperty("x-nais-idempotency", idempotency)
            connection.setRequestProperty("x-nais-content-sha256", bodyDigest)
            connection.setRequestProperty("x-nais-signature", signature)
            partDigest?.let { connection.setRequestProperty("x-nais-part-sha256", it) }
            write(connection, body)
            read(connection)
        } finally {
            connection.disconnect()
        }
    }
}

private fun open(endpoint: String, method: String): HttpURLConnection =
    (URL(endpoint).openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = 15_000
        readTimeout = 60_000
        instanceFollowRedirects = false
        useCaches = false
        setRequestProperty("accept", "application/json")
    }

private fun write(connection: HttpURLConnection, body: ByteArray) {
    connection.doOutput = true
    connection.setFixedLengthStreamingMode(body.size)
    connection.outputStream.use { it.write(body) }
}

private fun read(connection: HttpURLConnection): CloudflareResponse {
    val status = connection.responseCode
    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
    val bytes = ByteArrayOutputStream()
    stream?.use { source ->
        val buffer = ByteArray(4096)
        while (true) {
            val count = source.read(buffer)
            if (count < 0) break
            require(bytes.size() + count <= MAX_RESPONSE_BYTES) { "Remote response too large" }
            bytes.write(buffer, 0, count)
        }
    }
    val text = bytes.toString(Charsets.UTF_8.name())
    return CloudflareResponse(status, if (text.isBlank()) JSONObject() else JSONObject(text))
}

/** Java emits ASN.1 DER ECDSA signatures; WebCrypto verifies fixed r||s bytes. */
private fun derToRaw(der: ByteArray): ByteArray {
    require(der.size in 8..80 && der[0] == 0x30.toByte())
    var offset = 2
    require(der[offset++] == 0x02.toByte())
    val rLength = der[offset++].toInt() and 0xff
    val r = der.copyOfRange(offset, offset + rLength)
    offset += rLength
    require(der[offset++] == 0x02.toByte())
    val sLength = der[offset++].toInt() and 0xff
    val s = der.copyOfRange(offset, offset + sLength)
    fun normalize(value: ByteArray): ByteArray {
        val stripped = value.dropWhile { it == 0.toByte() }.toByteArray()
        require(stripped.size <= 32)
        return ByteArray(32 - stripped.size) + stripped
    }
    return normalize(r) + normalize(s)
}
