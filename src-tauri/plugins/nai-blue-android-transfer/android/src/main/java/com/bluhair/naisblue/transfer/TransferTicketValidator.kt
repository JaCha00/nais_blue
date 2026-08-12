package com.bluhair.naisblue.transfer

/**
 * This validator mirrors the Rust boundary before SharedPreferences is touched.
 * Rejection messages are fixed so rejected material cannot leak through logs.
 */
object TransferTicketValidator {
    private const val MAX_TRANSFER_BYTES = 8L * 1024L * 1024L * 1024L
    private val identifier = Regex("^[A-Za-z0-9:_.-]{1,96}$")
    private val digest = Regex("^sha256:[0-9A-Fa-f]{64}$")
    private val windowsAbsolutePath = Regex("^[A-Za-z]:[/\\\\].*")
    private val forbiddenMarkers = listOf(
        "authorization",
        "bearer ",
        "token=",
        "signed url",
        "x-amz-",
        "thumbnail",
        "base64",
        "data:image",
        "image bytes",
        "file:",
        "://",
    )

    fun validate(ticket: TransferTicketSnapshot) {
        require(identifier.matches(ticket.transferId)) { "Invalid transfer ticket" }
        require(safeReference(ticket.resourceRef, "appdata:", 256)) { "Invalid transfer ticket" }
        require(safeReference(ticket.credentialRef, "vault:", 160)) { "Invalid transfer ticket" }
        require(ticket.sizeBytes in 1..MAX_TRANSFER_BYTES) { "Invalid transfer ticket" }
        require(ticket.checkpointBytes in 0..ticket.sizeBytes) { "Invalid transfer ticket" }
        require(digest.matches(ticket.contentSha256)) { "Invalid transfer ticket" }

        when (ticket.kind) {
            TransferKind.R2_UPLOAD -> require(ticket.peerDeviceRef == null) { "Invalid transfer ticket" }
            TransferKind.LAN_BLOB -> require(
                ticket.peerDeviceRef?.let { safeReference(it, "device:", 160) } == true,
            ) { "Invalid transfer ticket" }
        }

        val values = listOfNotNull(
            ticket.transferId,
            ticket.resourceRef,
            ticket.credentialRef,
            ticket.peerDeviceRef,
            ticket.contentSha256,
        )
        require(values.none(::containsForbiddenValue)) { "Invalid transfer ticket" }
    }

    fun validateTransferId(value: String) {
        require(identifier.matches(value) && !containsForbiddenValue(value)) {
            "Invalid transfer identifier"
        }
    }

    private fun safeReference(value: String, prefix: String, maxLength: Int): Boolean {
        if (!value.startsWith(prefix) || value.length <= prefix.length || value.length > maxLength) {
            return false
        }
        val suffix = value.removePrefix(prefix)
        // An absolute path, traversal, query, or escaped separator may reveal host layout.
        if (suffix.startsWith('/') || windowsAbsolutePath.matches(suffix) ||
            suffix.contains("..") || value.any { it in listOf('\\', '?', '#', '%') }
        ) {
            return false
        }
        return suffix.all { it.isLetterOrDigit() || it in "/:_.-" }
    }

    private fun containsForbiddenValue(value: String): Boolean {
        val normalized = value.lowercase()
        if (forbiddenMarkers.any(normalized::contains)) return true
        if (value.startsWith('/') || value.startsWith("\\\\") || windowsAbsolutePath.matches(value)) {
            return true
        }

        // Reject common encoded/raw image prefixes; image bytes use the blob executor only.
        return value.startsWith("iVBORw0KGgo") || value.startsWith("/9j/") ||
            value.startsWith("R0lGOD") || normalized.startsWith("89504e47")
    }
}
