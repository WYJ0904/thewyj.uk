package uk.thewyj.app

import android.content.ContentValues
import android.net.Uri
import android.provider.MediaStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.core.session.SessionState
import uk.thewyj.app.task22.TransferApiClient
import uk.thewyj.app.task22.TransferFileSource
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Physical-device acceptance for the Task 22 data plane: a real SAF/MediaStore
 * content URI is streamed part by part through the preview API and read back
 * through a real download grant. The fixture must be a disposable QA account
 * created against the same preview origin.
 */
@RunWith(AndroidJUnit4::class)
class Task22DeviceTransferTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun fixture(): JSONObject {
        val file = File(context.filesDir, "task22-preview-login.json")
        assertTrue("task22 preview fixture missing", file.exists())
        return JSONObject(file.readText())
    }

    @Before fun loginFixture() = runBlocking {
        val fixture = fixture()
        assertTrue(BuildConfig.DEBUG && java.net.URI(BuildConfig.THEWYJ_BASE_URL).host.endsWith(".pages.dev"))
        assertEquals(fixture.getString("origin"), BuildConfig.THEWYJ_BASE_URL)
        AppGraph.sessionRepository.login(fixture.getString("username"), fixture.getString("secret"))
        val deadline = System.currentTimeMillis() + 30_000
        while (System.currentTimeMillis() < deadline) {
            val state = AppGraph.sessionRepository.state.value
            if (state is SessionState.Authenticated && state.account.id == fixture.getString("user_id")) return@runBlocking
            kotlinx.coroutines.delay(250)
        }
        throw AssertionError("device login did not reach the expected preview account")
    }

    @Test fun mediaStoreContentUriStreamsThroughMultipartAndDownloads() {
        runBlocking { runTransferThroughMediaStoreUri() }
    }

    private suspend fun runTransferThroughMediaStoreUri() {
        val payload = "device-transfer-acceptance".toByteArray(Charsets.UTF_8).plus(ByteArray(24))
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, "task22-device.bin")
            put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream")
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw AssertionError("MediaStore insert failed")
        resolver.openOutputStream(uri)?.use { it.write(payload) } ?: throw AssertionError("MediaStore write failed")

        val api = TransferApiClient(context)
        val session = step("createSession") {
            api.createSession(
                minutes = 60,
                maxDownloads = 2,
                oneTime = false,
                password = "",
                fileCount = 1,
                totalBytes = payload.size.toLong(),
            )
        }
        val fileId = "file-device-${UUID.randomUUID().toString().replace("-", "").take(8)}"
        val source = TransferFileSource(
            uri = uri.toString(),
            displayName = "task22-device.bin",
            relativePath = "task22-device.bin",
            sizeBytes = payload.size.toLong(),
            mimeType = "application/octet-stream",
        )
        val allocation = step("allocateFile") { api.allocateFile(session.id, source, fileId) }
        assertTrue(allocation.partCount >= 1)
        var uploaded = 0
        step("uploadPart") {
            api.uploadPart(
                sessionId = session.id,
                fileId = fileId,
                partNumber = 1,
                partLength = payload.size,
                input = resolver.openInputStream(uri) ?: throw AssertionError("content input stream missing"),
                onProgress = { uploaded = it.toInt() },
            )
        }
        assertEquals(payload.size, uploaded)

        val share = step("complete") { api.complete(session.id) }
        assertEquals(1, share.fileCount)
        val metadata = step("shareMetadata") { api.shareMetadata(share.id, "") }
        assertEquals("task22-device.bin", metadata.getJSONObject("share").getJSONArray("files").getJSONObject(0).getString("file_name"))

        val authorizeConnection = URL(BuildConfig.THEWYJ_BASE_URL.trimEnd('/') + "/api/transfer/shares/${share.id}/authorize")
            .openConnection() as HttpURLConnection
        authorizeConnection.requestMethod = "POST"
        authorizeConnection.doOutput = true
        authorizeConnection.setRequestProperty("Content-Type", "application/json")
        authorizeConnection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val authorize = JSONObject(authorizeConnection.inputStream.bufferedReader().use { it.readText() })
        authorizeConnection.disconnect()
        val token = authorize.getJSONObject("download").getString("token")
        val connection = URL(BuildConfig.THEWYJ_BASE_URL.trimEnd('/') + "/api/transfer/shares/${share.id}/download?file=$fileId&grant=$token")
            .openConnection() as HttpURLConnection
        val downloaded = connection.inputStream.readBytes()
        assertEquals(payload.toList(), downloaded.toList())
        connection.disconnect()

        step("revoke") { api.revoke(share.id) }
        resolver.delete(uri, null, null)
    }

    private fun <T> step(name: String, block: () -> T): T {
        return try {
            block()
        } catch (error: Throwable) {
            throw AssertionError("step $name failed: ${error.message} (${error.javaClass.simpleName})", error)
        }
    }
}
