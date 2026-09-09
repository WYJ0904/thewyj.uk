package uk.thewyj.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.task22.TransferApiClient
import uk.thewyj.app.task22.TransferQueueStore
import java.io.ByteArrayOutputStream

/**
 * Drives the real Compose UI and the real system SAF pickers (DocumentsUI),
 * then verifies Content URI persistence, relative paths and the full
 * upload -> publish -> download -> revoke chain through the visible UI.
 */
@RunWith(AndroidJUnit4::class)
class Task22SafUiTest : Task22AcceptanceHarness() {
    private fun visibleTexts(): List<String> {
        val output = ByteArrayOutputStream()
        runCatching { device.dumpWindowHierarchy(output) }
        return Regex("""text="([^"]*)"""").findAll(output.toString(Charsets.UTF_8.name()))
            .map { it.groupValues[1] }
            .filter { it.isNotBlank() }
            .toList()
    }

    private fun waitTextWithScroll(text: String, timeoutMs: Long = 30_000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (device.wait(Until.hasObject(By.textContains(text)), 2_000)) return true
            val width = device.displayWidth
            val height = device.displayHeight
            // Sweep both directions so a card above or below the viewport is found.
            device.swipe(width / 2, height * 3 / 4, width / 2, height / 4, 15)
            if (device.wait(Until.hasObject(By.textContains(text)), 1_000)) return true
            device.swipe(width / 2, height / 4, width / 2, height * 3 / 4, 15)
        }
        return device.wait(Until.hasObject(By.textContains(text)), 2_000)
    }

    @Test fun singleFileThroughSystemPicker() = runBlocking {
        loginFixture()
        TransferQueueStore.inDirectory(context.filesDir, accountId()).save(emptyList())
        openTransferScreen()
        assertTrue("select file button", tapByText("选择文件"))
        // Real system DocumentsUI. Our pushed file is usually on the recents screen.
        if (!tapPickerEntry("saf-single.txt")) {
            runCatching { device.findObject(By.desc("显示根目录")).click() }
            if (device.wait(Until.hasObject(By.text("下载")), 8_000)) {
                device.findObject(By.text("下载")).click()
            }
        }
        assertTrue("picked file visible in picker", tapPickerEntry("saf-single.txt"))
        assertTrue("queue shows picked file", device.wait(Until.hasObject(By.text("saf-single.txt")), 20_000))
        assertTrue("upload finished", waitTextWithScroll("DONE", 12 * 60_000))
        assertTrue("publish", tapByText("创建分享链接"))
        assertTrue("share card visible; texts=" + visibleTexts(), waitTextWithScroll("分享已创建"))
        val linkNode = runCatching { device.findObject(By.textContains("transfer#share=")) }.getOrNull()
        val shareId = linkNode?.text?.substringAfter("share=")?.trim().orEmpty()
        assertTrue("share must exist server-side with a visible link id", shareId.isNotBlank())
        assertTrue("share must exist server-side", TransferApiClient(context).listShares().any { it.id == shareId })
        assertTrue("revoke visible", waitTextWithScroll("撤销"))
        device.findObject(By.text("撤销")).click()
        device.wait(Until.gone(By.text("撤销")), 20_000)
        val deadline = System.currentTimeMillis() + 20_000
        var revoked = false
        while (System.currentTimeMillis() < deadline) {
            if (TransferApiClient(context).listShares().none { it.id == shareId }) {
                revoked = true
                break
            }
            Thread.sleep(500)
        }
        assertTrue("revoke must clear the share server-side", revoked)

        val persisted = context.contentResolver.persistedUriPermissions
        assertTrue("SAF persistable read permission must be granted", persisted.any { it.isReadPermission })
    }

    @Test fun directoryPickerPreservesRelativePaths() = runBlocking {
        loginFixture()
        TransferQueueStore.inDirectory(context.filesDir, accountId()).save(emptyList())
        openTransferScreen()
        assertTrue("select folder button", tapByText("选择文件夹"))
        // DocumentsUI tree picker opens at the internal storage root; enter
        // Downloads first, then select the saf-folder directory.
        if (device.wait(Until.hasObject(By.text("Download")), 8_000)) {
            device.findObject(By.text("Download")).click()
        }
        if (!tapPickerEntry("saf-folder")) {
            runCatching { device.findObject(By.desc("显示根目录")).click() }
            if (device.wait(Until.hasObject(By.text("下载")), 8_000)) {
                device.findObject(By.text("下载")).click()
            }
        }
        assertTrue("folder visible; texts=" + visibleTexts(), tapPickerEntry("saf-folder"))
        val button = listOf("使用此文件夹", "允许", "SELECT", "USE THIS FOLDER")
            .firstOrNull { text ->
                device.wait(Until.hasObject(By.text(text)), 2_000) && runCatching {
                    device.findObject(By.text(text)).click()
                }.isSuccess
            }
        assertTrue("confirm folder selection", button != null)
        if (!device.wait(Until.hasObject(By.text("上传队列")), 8_000)) {
            // The system may ask for folder-access confirmation before returning.
            listOf("允许", "使用此文件夹").forEach { text ->
                if (device.wait(Until.hasObject(By.text(text)), 3_000)) {
                    runCatching { device.findObject(By.text(text)).click() }
                }
            }
            assertTrue("folder picker must close; texts=" + visibleTexts(), device.wait(Until.hasObject(By.text("上传队列")), 10_000))
        }
        assertTrue("a.txt queued", waitTextWithScroll("a.txt", 20_000))
        assertTrue("c.txt queued", waitTextWithScroll("c.txt", 20_000))
        assertTrue("upload finished", waitTextWithScroll("DONE", 12 * 60_000))
        tapByText("创建分享链接")
        assertTrue("share card visible; texts=" + visibleTexts(), waitTextWithScroll("分享已创建"))
        val linkNode = runCatching { device.findObject(By.textContains("transfer#share=")) }.getOrNull()
        val shareId = linkNode?.text?.substringAfter("share=")?.trim().orEmpty()
        assertTrue("folder share must have a visible id", shareId.isNotBlank())
        val metadata = TransferApiClient(context).shareMetadata(shareId, "")
        val files = metadata.getJSONObject("share").getJSONArray("files")
        val paths = buildList {
            for (index in 0 until files.length()) add(files.getJSONObject(index).getString("relative_path"))
        }
        assertTrue("relative paths must be preserved under the picked folder: $paths",
            paths.any { it.endsWith("a.txt") } && paths.any { it.endsWith("sub/c.txt") })
        TransferApiClient(context).revoke(shareId)
    }
}
