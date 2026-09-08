package uk.thewyj.app.core.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface CredentialStore {
    fun loadActive(): DeviceCredentials?
    fun saveActive(credentials: DeviceCredentials)
    fun clearActive()
    fun loadPendingLogout(): PendingLogout?
    fun savePendingLogout(pending: PendingLogout)
    fun clearPendingLogout()
}

class CredentialStorageException : IllegalStateException("安全凭据暂时无法读取或保存；已保留原数据，请解锁设备后重试")

@Suppress("ApplySharedPref") // Credential changes must be durable before session state advances.
class SecureCredentialStore(context: Context, namespace: String = "") : CredentialStore {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME + namespace, Context.MODE_PRIVATE)
    private val keyAlias = KEY_ALIAS + namespace

    @Synchronized
    override fun loadActive(): DeviceCredentials? = readEncrypted(ACTIVE_PREFIX)?.let {
        runCatching { DeviceCredentials.fromJson(JSONObject(it)) }
            .getOrElse {
                throw CredentialStorageException()
            }
    }

    @Synchronized
    override fun saveActive(credentials: DeviceCredentials) {
        writeEncrypted(ACTIVE_PREFIX, credentials.toJson().toString())
    }

    @Synchronized
    override fun clearActive() = clearEncrypted(ACTIVE_PREFIX)

    @Synchronized
    override fun loadPendingLogout(): PendingLogout? = readEncrypted(PENDING_LOGOUT_PREFIX)?.let {
        runCatching { PendingLogout.fromJson(JSONObject(it)) }
            .getOrElse {
                throw CredentialStorageException()
            }
    }

    @Synchronized
    override fun savePendingLogout(pending: PendingLogout) {
        writeEncrypted(PENDING_LOGOUT_PREFIX, pending.toJson().toString())
    }

    @Synchronized
    override fun clearPendingLogout() = clearEncrypted(PENDING_LOGOUT_PREFIX)

    private fun readEncrypted(prefix: String): String? {
        val ciphertext = preferences.getString("${prefix}_ciphertext", null)
        val iv = preferences.getString("${prefix}_iv", null)
        if (ciphertext == null && iv == null) return null
        if (ciphertext == null || iv == null) {
            throw CredentialStorageException()
        }
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                key(createIfMissing = false),
                GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
            )
            String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
        }.getOrElse {
            throw CredentialStorageException()
        }
    }

    private fun writeEncrypted(prefix: String, plaintext: String) {
        runCatching { encryptAndCommit(prefix, plaintext) }
            .getOrElse {
                throw CredentialStorageException()
            }
    }

    private fun encryptAndCommit(prefix: String, plaintext: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        check(preferences.edit()
            .putString("${prefix}_ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .putString("${prefix}_iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .commit()) { "Unable to persist encrypted credentials" }
    }

    private fun clearEncrypted(prefix: String) {
        preferences.edit()
            .remove("${prefix}_ciphertext")
            .remove("${prefix}_iv")
            .commit()
    }

    private fun key(createIfMissing: Boolean = true): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        check(createIfMissing && !preferences.contains("${ACTIVE_PREFIX}_ciphertext") &&
            !preferences.contains("${PENDING_LOGOUT_PREFIX}_ciphertext")) { "Existing credential key unavailable" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }
    }

    companion object {
        private const val PREFERENCES_NAME = "uk.thewyj.app.secure.session.v1"
        private const val KEY_ALIAS = "uk.thewyj.app.session.aes.v1"
        private const val ACTIVE_PREFIX = "active"
        private const val PENDING_LOGOUT_PREFIX = "pending_logout"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
