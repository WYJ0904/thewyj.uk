package uk.thewyj.app.core.update

import android.content.Context
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.core.network.AppConfig
import java.io.File
import java.security.MessageDigest

/**
 * Task 24.3 audit: the in-app updater must fail closed.
 *
 * The published SHA-256 is the only integrity proof for a downloaded APK. The
 * previous implementation returned `true` whenever the hash was missing or not
 * 64 hex characters, so a metadata gap installed an unverified APK while the UI
 * reported「正在校验安装包」.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AppUpdateInstallerVerifyTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private val installer = AppUpdateInstaller(context)

    private fun configFor(file: File, sha256: String, sizeBytes: Long): AppConfig = AppConfig(
        latestVersionCode = 13,
        latestVersionName = "1.3.0",
        minimumVersionCode = 1,
        downloadUrl = "https://thewyj.uk/api/app/download",
        apkFileName = file.name,
        apkSha256 = sha256,
        apkSizeBytes = sizeBytes,
    )

    private fun writeApk(config: AppConfig, bytes: ByteArray): File {
        val file = installer.localApk(config)
        file.parentFile?.mkdirs()
        file.writeBytes(bytes)
        return file
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    @Test fun missingPublishedHashFailsClosedAndDeletesTheUnverifiableFile() {
        val bytes = "unverified-apk".toByteArray()
        val config = configFor(File("thewyj-android-1.3.0.apk"), "", bytes.size.toLong())
        val file = writeApk(config, bytes)

        assertFalse(runBlocking { installer.verify(config) })
        assertFalse("an unverifiable APK must never be offered to the installer", file.exists())
    }

    @Test fun malformedPublishedHashFailsClosed() {
        val bytes = "malformed-hash-apk".toByteArray()
        val config = configFor(File("thewyj-android-1.3.0.apk"), "not-a-sha256", bytes.size.toLong())
        writeApk(config, bytes)

        assertFalse(runBlocking { installer.verify(config) })
    }

    @Test fun matchingHashAndSizePasses() {
        val bytes = "official-apk".toByteArray()
        val config = configFor(File("thewyj-android-1.3.0.apk"), sha256(bytes), bytes.size.toLong())
        writeApk(config, bytes)

        assertTrue(runBlocking { installer.verify(config) })
    }

    @Test fun publishedHashWithoutSizeIsStillVerifiedByHashAlone() {
        val bytes = "official-apk-no-size".toByteArray()
        val config = configFor(File("thewyj-android-1.3.0.apk"), sha256(bytes), 0)
        writeApk(config, bytes)

        assertTrue(runBlocking { installer.verify(config) })
    }

    @Test fun sizeMismatchFailsEvenWhenTheHashMatches() {
        val bytes = "official-apk-wrong-size".toByteArray()
        val config = configFor(File("thewyj-android-1.3.0.apk"), sha256(bytes), bytes.size.toLong() + 1)
        val file = writeApk(config, bytes)

        assertFalse(runBlocking { installer.verify(config) })
        assertFalse(file.exists())
    }

    @Test fun tamperedDownloadIsDeletedInsteadOfBeingInstalled() {
        val bytes = "official-apk".toByteArray()
        val config = configFor(File("thewyj-android-1.3.0.apk"), sha256(bytes), bytes.size.toLong())
        val file = writeApk(config, "tampered-apk".toByteArray())

        assertFalse(runBlocking { installer.verify(config) })
        assertFalse(file.exists())
    }
}
