package com.sekullar.pyramid

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-256-GCM, layout base64( nonce(12) | ciphertext | tag(16) ), AAD "pyramid1".
 * Same as desktop/electron/sync/crypto.js (the AAD differs from Phoneix on purpose, so messages cannot be mixed up).
 */
object Crypto {
    private val aad = "pyramid1".toByteArray()
    private val rnd = SecureRandom()

    fun seal(key: ByteArray, json: String): String {
        val nonce = ByteArray(12).also { rnd.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        c.updateAAD(aad)
        return Base64.getEncoder().encodeToString(nonce + c.doFinal(json.toByteArray(Charsets.UTF_8)))
    }

    /** null when it cannot be decrypted (wrong key, damaged data). The tag check also proves the sender knew the key. */
    fun open(key: ByteArray, b64: String): String? = try {
        val b = Base64.getDecoder().decode(b64.trim())
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, b, 0, 12))
        c.updateAAD(aad)
        String(c.doFinal(b, 12, b.size - 12), Charsets.UTF_8)
    } catch (e: Exception) { null }
}
