package uk.thewyj.app

import android.app.UiAutomation
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.Configurator
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.task21.FinanceDirection
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

/** Read the owner-selected existing detail. No UI actions, grants, account or cloud writes. */
@RunWith(AndroidJUnit4::class)
class OwnerSelectedReceiptTest {
    @Test fun selectedExistingReceiptUsesRealDeviceOcrAndPreservesManualIdentityReview() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("ownerSelectedReceipt") == "true")
        assertTrue("use the separate debug sandbox", BuildConfig.DEBUG)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assertEquals("uk.thewyj.app.debug", context.packageName)
        val pkg = args.getString("sourcePackage").orEmpty()
        require(pkg in setOf("com.tencent.mm", "com.eg.android.AlipayGphone"))
        val expected = requireNotNull(args.getString("expectedMinor")).toLong()
        val direction = FinanceDirection.valueOf(requireNotNull(args.getString("expectedDirection")))
        val completed = args.getString("expectedCompleted") == "true"
        val user = requireNotNull(args.getString("sourceUser")).toInt()
        Configurator.getInstance().uiAutomationFlags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
        val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        val resumed = automation.executeShellCommand("dumpsys activity activities").use { fd ->
            java.io.FileInputStream(fd.fileDescriptor).bufferedReader().use { reader ->
                reader.lineSequence().firstOrNull { it.contains("topResumedActivity=") }.orEmpty()
            }
        }
        assertTrue("keep the selected source/profile foreground", resumed.contains(" u$user $pkg/"))
        val root = automation.rootInActiveWindow
        val lines = mutableListOf<String>()
        fun collect(node: AccessibilityNodeInfo?, depth: Int = 0) {
            if (node == null || depth > 24 || lines.size >= 160) return
            node.text?.toString()?.takeIf { it.isNotBlank() && it.length <= 120 }?.let(lines::add)
            for (index in 0 until minOf(node.childCount, 64)) collect(node.getChild(index), depth + 1)
        }
        if (root?.packageName?.toString() == pkg) collect(root)
        val tree = PaymentPageSemantics.extract(PaymentPageSnapshot(pkg, lines, System.currentTimeMillis()))
        val bitmap = automation.takeScreenshot()
        assertNotNull("a secure/denied screenshot remains blocked", bitmap)
        val ocr = try {
            runBlocking { PaymentScreenshotVerifier(MlKitOcrEngine(context)).verify(bitmap!!, pkg, System.currentTimeMillis()) }
        } finally { bitmap?.recycle() }
        Log.i("AerisReceiptAcceptance", "source=$pkg user=$user treeLines=${lines.size} treeMinor=${tree?.amountMinor} ocrMinor=${ocr?.amountMinor} ocrDirection=${ocr?.direction} completed=${ocr?.completionConfirmed}")
        assertNotNull("real on-device OCR must identify this selected detail", ocr)
        assertEquals(expected, ocr!!.amountMinor)
        assertEquals(direction, ocr.direction)
        assertEquals(completed, ocr.completionConfirmed)
        if (tree != null) {
            assertEquals(expected, tree.amountMinor)
            assertEquals(direction, tree.direction)
        }
        // This is explicitly an isolated coordinator check, not a real payment
        // notification or an end-to-end cloud receipt.
        val database = Room.inMemoryDatabaseBuilder(context, NotificationDatabase::class.java).build()
        try {
            val store = RoomPaymentRecognitionStore(database)
            val coordinator = PaymentRecognitionCoordinator(store)
            val recognition = coordinator.onSourceEvent("isolated-owner-receipt-test", pkg,
                PaymentSourceType.NOTIFICATION, "isolated-receipt-event", "交易通知", "转账通知")
            assertTrue(recognition.recognitionId.isNotBlank())
            val result = coordinator.onAccessibilityEnrichment("isolated-owner-receipt-test",
                ocr.copy(sourceInstanceUncertain = true), recognition.ticketId)
            assertTrue(result is EnrichmentOutcome.Applied)
            assertTrue(store.localBookings("isolated-owner-receipt-test").isEmpty())
            assertFalse(store.recognition("isolated-owner-receipt-test", recognition.recognitionId)!!.completionConfirmed)
        } finally { database.close() }
    }
}
