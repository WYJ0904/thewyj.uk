package uk.thewyj.app

import android.content.ContentUris
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import uk.thewyj.app.core.session.SessionState
import uk.thewyj.app.task22.TransferApiClient
import uk.thewyj.app.task22.TransferConfigStore
import uk.thewyj.app.task22.TransferFileSource
import uk.thewyj.app.task22.TransferItemStatus
import uk.thewyj.app.task22.TransferQueueStore
import uk.thewyj.app.task22.TransferUploadWorker
import uk.thewyj.app.task22.QueuedTransfer
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID

/** Shared, non-bypassing acceptance harness: real Keystore login, real SAF URIs, real WorkManager worker. */
abstract class Task22AcceptanceHarness {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val uiAutomation get() = InstrumentationRegistry.getInstrumentation().uiAutomation
    val device get() = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    fun loginFixture() = runBlocking {
        val file = File(context.filesDir, "task22-preview-login.json")
        check(file.exists()) { "task22 preview fixture missing" }
        val fixture = JSONObject(file.readText())
        AppGraph.sessionRepository.login(fixture.getString("username"), fixture.getString("secret"))
        val deadline = System.currentTimeMillis() + 30_000
        while (System.currentTimeMillis() < deadline) {
            val state = AppGraph.sessionRepository.state.value
            if (state is SessionState.Authenticated && state.account.id == fixture.getString("user_id")) return@runBlocking
            delay(250)
        }
        error("device login did not reach the expected preview account")
    }

    fun accountId(): String {
        val state = AppGraph.sessionRepository.state.value
        return (state as? SessionState.Authenticated)?.account?.id ?: error("not authenticated")
    }

    fun mediaStoreUri(displayName: String): Uri {
        val resolver = context.contentResolver
        val collection = MediaStore.Files.getContentUri("external")
        resolver.query(
            collection,
            arrayOf(MediaStore.Files.FileColumns._ID),
            "${MediaStore.Files.FileColumns.DISPLAY_NAME} = ?",
            arrayOf(displayName),
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) return ContentUris.withAppendedId(collection, cursor.getLong(0))
        }
        error("MediaStore entry $displayName not found")
    }

    fun queueItem(source: TransferFileSource, status: TransferItemStatus = TransferItemStatus.PENDING): QueuedTransfer =
        QueuedTransfer(localId = UUID.randomUUID().toString(), source = source, status = status)

    fun runWorkerToDone(item: QueuedTransfer, timeoutMs: Long, waitAfterDone: Long = 0) {
        val accountId = accountId()
        TransferConfigStore.inDirectory(context.filesDir, accountId).save(
            uk.thewyj.app.task22.TransferConfig(minutes = 1440, maxDownloads = 5, oneTime = false, password = ""),
        )
        val store = TransferQueueStore.inDirectory(context.filesDir, accountId)
        store.upsert(item)
        TransferUploadWorker.enqueue(context)
        val deadline = System.currentTimeMillis() + timeoutMs
        runBlocking {
            while (System.currentTimeMillis() < deadline) {
                val current = store.load().firstOrNull { it.localId == item.localId }
                if (current?.status == TransferItemStatus.DONE) return@runBlocking
                if (current?.status == TransferItemStatus.ERROR) {
                    throw AssertionError("worker reached ERROR: ${current.errorMessage}")
                }
                delay(500)
            }
            throw AssertionError("upload did not finish within ${timeoutMs}ms; state=${store.load().firstOrNull { it.localId == item.localId }}")
        }
        if (waitAfterDone > 0) runBlocking { delay(waitAfterDone) }
    }

    fun serverParts(sessionId: String, fileId: String): Set<Int> {
        var lastError: Exception? = null
        for (attempt in 1..5) {
            try {
                return serverPartsOnce(sessionId, fileId)
            } catch (error: Exception) {
                // Mobile networks drop connections mid-handshake; the product
                // worker retries, so the harness polls the same way.
                lastError = error
                Thread.sleep(1_000L * attempt)
            }
        }
        throw lastError ?: IllegalStateException("server part state unavailable")
    }

    private fun serverPartsOnce(sessionId: String, fileId: String): Set<Int> {
        val state = TransferApiClient(context).sessionState(sessionId)
        val files = state.optJSONArray("files") ?: return emptySet()
        for (index in 0 until files.length()) {
            val file = files.getJSONObject(index)
            if (file.getString("file_id") != fileId) continue
            val parts = file.optJSONArray("uploaded_parts") ?: return emptySet()
            return buildSet { for (partIndex in 0 until parts.length()) add(parts.getInt(partIndex)) }
        }
        return emptySet()
    }

    data class DownloadResult(val bytes: Long, val sha256: String)

    private fun authorizeToken(shareId: String): String {
        val base = BuildConfig.THEWYJ_BASE_URL.trimEnd('/')
        val authorizeConnection = URL("$base/api/transfer/shares/$shareId/authorize").openConnection() as HttpURLConnection
        authorizeConnection.requestMethod = "POST"
        authorizeConnection.doOutput = true
        authorizeConnection.setRequestProperty("Content-Type", "application/json")
        authorizeConnection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        val authorize = JSONObject(authorizeConnection.inputStream.bufferedReader().use { it.readText() })
        authorizeConnection.disconnect()
        return authorize.getJSONObject("download").getString("token")
    }

    fun shareFileSize(shareId: String, fileId: String): Long {
        val metadata = TransferApiClient(context).shareMetadata(shareId, "")
        val files = metadata.getJSONObject("share").getJSONArray("files")
        for (index in 0 until files.length()) {
            val file = files.getJSONObject(index)
            if (file.getString("file_id") == fileId) return file.getLong("size_bytes")
        }
        error("share file $fileId not found in metadata")
    }

    /**
     * Bounded-memory ranged download. Bytes are written straight to
     * [destination] while a MessageDigest and byte counter advance, so a
     * 1 GiB transfer never becomes a ByteArray or Blob in RAM. When the
     * destination already holds a prefix, the transfer resumes from that
     * offset and the digest covers the whole file.
     */
    fun downloadToDestination(
        shareId: String,
        fileId: String,
        destination: File,
        limitBytes: Long = Long.MAX_VALUE,
    ): DownloadResult {
        val base = BuildConfig.THEWYJ_BASE_URL.trimEnd('/')
        val token = authorizeToken(shareId)
        val size = shareFileSize(shareId, fileId)
        val target = minOf(size, limitBytes)
        val start = if (destination.exists()) destination.length() else 0L
        check(start <= target) { "destination already holds $start bytes, target is $target" }
        val digest = MessageDigest.getInstance("SHA-256")
        if (start > 0) {
            destination.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    digest.update(buffer, 0, read)
                }
            }
        }
        val rangeSize = 8L * 1024 * 1024
        var offset = start
        java.io.FileOutputStream(destination, start > 0).use { output ->
            val buffer = ByteArray(64 * 1024)
            while (offset < target) {
                val length = minOf(rangeSize, target - offset)
                val connection = URL(
                    "$base/api/transfer/shares/$shareId/download?file=$fileId&grant=$token",
                ).openConnection() as HttpURLConnection
                connection.setRequestProperty("Range", "bytes=$offset-${offset + length - 1}")
                val status = connection.responseCode
                check(status == 206) { "range download failed with $status" }
                var written = 0L
                connection.inputStream.use { input ->
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        written += read
                    }
                }
                connection.disconnect()
                check(written == length) { "range chunk truncated: $written/$length" }
                offset += length
            }
        }
        return DownloadResult(target, digest.digest().joinToString("") { "%02x".format(it) })
    }

    fun sha256OfFile(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun sha256OfUri(uri: Uri): String {
        val digest = MessageDigest.getInstance("SHA-256")
        context.contentResolver.openInputStream(uri)!!.use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun shell(command: String): String {
        val parcel = uiAutomation.executeShellCommand(command)
        val stream = android.os.ParcelFileDescriptor.AutoCloseInputStream(parcel)
        return stream.bufferedReader().use { it.readText() }
    }

    fun tapByText(text: String, timeoutMs: Long = 15_000): Boolean {
        if (!device.wait(Until.hasObject(By.text(text)), timeoutMs)) return false
        device.findObject(By.text(text)).click()
        return true
    }

    fun tapTextWithScroll(text: String, after: String): Boolean {
        repeat(4) {
            if (device.wait(Until.hasObject(By.text(text)), 3_000)) {
                runCatching { device.findObject(By.text(text)).click() }
                if (device.wait(Until.hasObject(By.text(after)), 3_000)) return true
            }
            device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4, device.displayWidth / 2, device.displayHeight / 4, 15)
        }
        return false
    }

    fun tapPickerEntry(name: String, timeoutMs: Long = 25_000): Boolean {
        val descSelector = By.descContains(name)
        val textSelector = By.text(name)
        val found = device.wait(Until.hasObject(descSelector), timeoutMs)
            || device.wait(Until.hasObject(textSelector), 3_000)
        if (!found) return false
        val descNode = runCatching { device.findObject(descSelector) }.getOrNull()
        if (descNode != null) {
            val bounds = descNode.visibleBounds
            device.click(bounds.centerX() - 260, bounds.centerY())
        } else {
            device.findObject(textSelector).click()
        }
        return true
    }

    fun openTransferScreen() {
        shell("am start -n uk.thewyj.app.debug/uk.thewyj.app.MainActivity")
        check(tapTextWithScroll("我的", "Android 能力")) { "我的 nav unreachable" }
        check(tapTextWithScroll("文件传输", "上传队列")) { "文件传输 entry unreachable" }
    }

    /** Selects a real file through the system SAF picker and returns the queued item. */
    fun pickFileThroughUi(displayName: String): QueuedTransfer {
        openTransferScreen()
        check(tapByText("选择文件")) { "选择文件 button missing" }
        var selected = tapPickerEntry(displayName)
        if (!selected) {
            // Prefer the deterministic search path.
            runCatching { device.findObject(By.desc("搜索")).click() }
            if (device.wait(Until.hasObject(By.clazz("android.widget.EditText")), 4_000)) {
                device.findObject(By.clazz("android.widget.EditText")).text = displayName
                Thread.sleep(1_500)
                selected = tapPickerEntry(displayName)
            }
        }
        if (!selected) {
            runCatching { device.findObject(By.desc("显示根目录")).click() }
            for (label in listOf("大型文件", "文档", "下载", "Downloads", "Documents")) {
                if (tapPickerEntry(displayName)) break
                if (device.wait(Until.hasObject(By.text(label)), 3_000)) {
                    val node = device.findObject(By.text(label))
                    val bounds = node.visibleBounds
                    device.click(bounds.centerX(), bounds.centerY())
                    Thread.sleep(2_000)
                    if (tapPickerEntry(displayName)) {
                        selected = true
                        break
                    }
                }
            }
        }
        val visible = runCatching {
            val output = java.io.ByteArrayOutputStream()
            device.dumpWindowHierarchy(output)
            Regex("""text="([^"]*)"""").findAll(output.toString(Charsets.UTF_8.name()))
                .map { it.groupValues[1] }
                .filter { it.isNotBlank() }
                .take(24)
                .joinToString(",")
        }.getOrDefault("")
        check(selected) { "file not selectable in system picker; visible=$visible" }
        check(device.wait(Until.hasObject(By.text(displayName)), 20_000)) { "queue did not show picked file" }
        Thread.sleep(1_500)
        return TransferQueueStore.inDirectory(context.filesDir, accountId()).load()
            .first { it.source.displayName == displayName }
    }

    fun targetPssKb(): Long {
        val output = shell("dumpsys meminfo uk.thewyj.app.debug")
        val total = output.lineSequence()
            .firstOrNull { it.trim().startsWith("TOTAL PSS:") || it.trim().startsWith("TOTAL:") }
            ?.trim()
            ?.split(Regex("\\s+"))
            ?.firstOrNull { it.toLongOrNull() != null }
            ?.toLongOrNull()
            ?: -1L
        return total
    }
}
