package com.bluhair.naisblue.transfer

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.net.URI
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.spec.ECGenParameterSpec

data class CloudflareProfile(
    val credentialRef: String,
    val endpoint: String,
    val deviceId: String,
    val keyAlias: String,
)

/**
 * Android Keystore owns the device private key while SharedPreferences links
 * only a vault reference to endpoint/device/sequence metadata. The pairing
 * capability never enters this store, ticket storage, diagnostics, or logs.
 */
class CloudflareCredentialStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        STORE_NAME,
        Context.MODE_PRIVATE,
    )

    fun validateConfiguration(args: CloudflarePairingArgs) {
        require(args.credentialRef.startsWith("vault:") && safeReference(args.credentialRef, 160))
        require(Regex("^[A-Za-z0-9_.-]{8,96}$").matches(args.deviceId))
        require(Regex("^[A-Za-z0-9_-]{32,128}$").matches(args.pairingCapability))
        val endpoint = URI(args.endpoint)
        require(endpoint.scheme == "https" && endpoint.host != null)
        require(endpoint.userInfo == null && endpoint.query == null && endpoint.fragment == null)
        require(endpoint.path.isNullOrEmpty() || endpoint.path == "/")
    }

    fun preparePublicKey(credentialRef: String): String = synchronized(LOCK) {
        val alias = keyAlias(credentialRef)
        val keyStore = androidKeyStore()
        if (!keyStore.containsAlias(alias)) {
            val generator = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC,
                ANDROID_KEYSTORE,
            )
            generator.initialize(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(false)
                    .build(),
            )
            generator.generateKeyPair()
        }
        val publicKey = androidKeyStore().getCertificate(alias)?.publicKey
            ?: throw IllegalStateException("Device key unavailable")
        Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP)
    }

    fun saveProfile(args: CloudflarePairingArgs) = synchronized(LOCK) {
        validateConfiguration(args)
        saveVerifiedProfile(args.credentialRef, args.endpoint, args.deviceId)
    }

    /** Called only after a pairing response has authenticated the same device public key. */
    internal fun saveVerifiedProfile(
        credentialRef: String,
        endpoint: String,
        deviceId: String,
    ) = synchronized(LOCK) {
        require(credentialRef.startsWith("vault:") && safeReference(credentialRef, 160))
        require(Regex("^[A-Za-z0-9_.-]{8,96}$").matches(deviceId))
        val parsedEndpoint = URI(endpoint)
        require(parsedEndpoint.scheme == "https" && parsedEndpoint.host != null)
        require(parsedEndpoint.userInfo == null && parsedEndpoint.query == null && parsedEndpoint.fragment == null)
        require(parsedEndpoint.path.isNullOrEmpty() || parsedEndpoint.path == "/")
        val alias = keyAlias(credentialRef)
        require(androidKeyStore().containsAlias(alias)) { "Device key unavailable" }
        require(preferences.edit()
            .putString(key(credentialRef, FIELD_ENDPOINT), endpoint.trimEnd('/'))
            .putString(key(credentialRef, FIELD_DEVICE), deviceId)
            .putString(key(credentialRef, FIELD_ALIAS), alias)
            .putLong(key(credentialRef, FIELD_SEQUENCE), 0L)
            .commit()) { "Cloudflare profile commit failed" }
    }

    fun profile(credentialRef: String): CloudflareProfile? = synchronized(LOCK) {
        val endpoint = preferences.getString(key(credentialRef, FIELD_ENDPOINT), null) ?: return null
        val deviceId = preferences.getString(key(credentialRef, FIELD_DEVICE), null) ?: return null
        val alias = preferences.getString(key(credentialRef, FIELD_ALIAS), null) ?: return null
        if (!androidKeyStore().containsAlias(alias)) return null
        CloudflareProfile(credentialRef, endpoint, deviceId, alias)
    }

    fun nextSequence(credentialRef: String): Long = synchronized(LOCK) {
        val sequenceKey = key(credentialRef, FIELD_SEQUENCE)
        val next = Math.addExact(preferences.getLong(sequenceKey, 0L), 1L)
        require(preferences.edit().putLong(sequenceKey, next).commit()) {
            "Cloudflare sequence commit failed"
        }
        next
    }

    fun privateKey(alias: String): PrivateKey = synchronized(LOCK) {
        androidKeyStore().getKey(alias, null) as? PrivateKey
            ?: throw IllegalStateException("Device key unavailable")
    }

    private fun keyAlias(credentialRef: String): String =
        "nais_cf_${sha256Hex(credentialRef.toByteArray()).take(24)}"

    private fun key(credentialRef: String, field: String): String =
        "profile_${sha256Hex(credentialRef.toByteArray()).take(24)}_$field"

    private fun androidKeyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply {
        load(null)
    }

    private fun safeReference(value: String, max: Int): Boolean =
        value.length <= max && !value.contains("..") && value.drop("vault:".length).all {
            it.isLetterOrDigit() || it in setOf(':', '_', '-', '.')
        }

    companion object {
        private val LOCK = Any()
        private const val STORE_NAME = "nais_cloudflare_transfer_credentials_v1"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val FIELD_ENDPOINT = "endpoint"
        private const val FIELD_DEVICE = "device"
        private const val FIELD_ALIAS = "alias"
        private const val FIELD_SEQUENCE = "sequence"

        fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { byte -> "%02x".format(byte) }
    }
}
