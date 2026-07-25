package expo.modules.foldersync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Bearer token at rest (spec 11.3): an AES-256/GCM key lives in the AndroidKeyStore; only
// the ciphertext (iv:ct) touches SharedPreferences. No third-party dependency — all
// framework APIs (API 23+, safe at minSdk 24). The phone holds the raw token (it must send
// it as a bearer) but never in plaintext on disk.
object TokenVault {
  private const val ANDROID_KEYSTORE = "AndroidKeyStore"
  private const val ALIAS = "foldersync_device_token"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val GCM_TAG_BITS = 128
  private const val PREFS = "foldersync_secure"
  private const val KEY = "device_token"

  fun store(context: Context, token: String) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val iv = cipher.iv // Keystore chose a random 12-byte GCM nonce; persist it with the ct.
    val ciphertext = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
    val blob = Base64.encodeToString(iv, Base64.NO_WRAP) + ":" +
      Base64.encodeToString(ciphertext, Base64.NO_WRAP)
    prefs(context).edit().putString(KEY, blob).apply()
  }

  fun load(context: Context): String? {
    val blob = prefs(context).getString(KEY, null) ?: return null
    val parts = blob.split(":")
    if (parts.size != 2) return null
    return try {
      val iv = Base64.decode(parts[0], Base64.NO_WRAP)
      val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
      String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    } catch (e: Exception) {
      // Keystore reset / key invalidated / tampered blob → treat as unpaired, never crash.
      null
    }
  }

  fun clear(context: Context) {
    prefs(context).edit().remove(KEY).apply()
    try {
      KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }.deleteEntry(ALIAS)
    } catch (_: Exception) {
      // Nothing to delete — fine.
    }
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (keyStore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        // Randomized encryption stays required (default): the Keystore generates a fresh IV
        // per encrypt — never pass our own IV on encrypt. No user-auth binding (the token must
        // be usable by the background service).
        .build(),
    )
    return generator.generateKey()
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
