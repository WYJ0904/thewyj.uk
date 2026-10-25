package uk.thewyj.app

import android.app.UiAutomation
import android.content.ComponentName
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/** Real bound service, real owner-opened chat, isolated ticket/ledger; no chat text capture. */
@RunWith(AndroidJUnit4::class)
class OwnerSelectedChatServiceTest {
    @Test fun chatWithAnActiveTicketNeverReadsScreenshotsOrBooksMoney() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("ownerSelectedChat") == "true")
        assertTrue(BuildConfig.DEBUG)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assertEquals("uk.thewyj.app.debug", context.packageName)
        val component = ComponentName(context.packageName, ThewyjPaymentAccessibilityService::class.java.name)
        val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        assertTrue("enable only Hotfix QA through normal Android Accessibility UI",
            enabled.split(':').mapNotNull(ComponentName::unflattenFromString).contains(component))
        Configurator.getInstance().uiAutomationFlags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
        val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        val device = UiDevice.getInstance(instrumentation)
        val foregroundDeadline = SystemClock.elapsedRealtime() + 75_000
        var foreground = ""
        while (SystemClock.elapsedRealtime() < foregroundDeadline) {
            foreground = automation.executeShellCommand("dumpsys activity activities").use { fd ->
                java.io.FileInputStream(fd.fileDescriptor).bufferedReader().use { reader ->
                    reader.lineSequence().firstOrNull { it.contains("topResumedActivity=") }.orEmpty()
                }
            }
            if (foreground.contains(" com.tencent.mm/") &&
                (foreground.contains(".ui.LauncherUI") || foreground.contains("ChattingUI"))) break
            SystemClock.sleep(700)
        }
        assertTrue("open the owner-selected WeChat chat, not an individual receipt",
            foreground.contains(" com.tencent.mm/") && (foreground.contains(".ui.LauncherUI") || foreground.contains("ChattingUI")))
        val connectionDeadline = SystemClock.elapsedRealtime() + 10_000
        while (!PaymentAccessibilityStatus.connected && SystemClock.elapsedRealtime() < connectionDeadline)
            SystemClock.sleep(100)
        assertTrue("real service must be connected", PaymentAccessibilityStatus.connected)
        val database = Room.inMemoryDatabaseBuilder(context, NotificationDatabase::class.java).build()
        val store = RoomPaymentRecognitionStore(database)
        val coordinator = PaymentRecognitionCoordinator(store)
        val account = "isolated-chat-${UUID.randomUUID()}"
        val outcome = coordinator.onSourceEvent(account, "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "isolated-chat-event", "微信支付", "转账通知")
        assertTrue(outcome.ticketId.isNotBlank())
        val enriched = AtomicInteger()
        val gateway = object : PaymentAccessibilityGateway {
            override fun reserveScan(accountId: String, ticketId: String, nowMs: Long) = uk.thewyj.app.task21.payment.PaymentPersistedScanBudget.reserve(store,accountId,ticketId,nowMs)
            override fun financeAccountId() = account
            override fun activePackages(accountId: String, nowMs: Long) = setOf("com.tencent.mm")
            override fun activeTicket(accountId: String, sourcePackage: String) = store.activeTicketForPackage(accountId, sourcePackage)
            override fun enrich(accountId: String, ticketId: String, enrichment: PaymentEnrichment): EnrichmentOutcome {
                enriched.incrementAndGet()
                return coordinator.onAccessibilityEnrichment(accountId, enrichment, ticketId)
            }
        }
        val readsBefore = PaymentAccessibilityStatus.pageReadCount
        val screenshotsBefore = PaymentAccessibilityStatus.screenshotCount
        PaymentAccessibilityDeviceTest.install(gateway, blockContentReadsForAudit = true)
        try {
            PaymentAccessibilityStatus.onSkipped("com.tencent.mm", "awaiting_chat_test")
            PaymentTicketPackageSignal.publish("com.tencent.mm")
            // One normal vertical scroll produces a genuine foreground event.
            // No bubble/card/button is clicked and no text or message is sent.
            device.swipe(device.displayWidth / 2, device.displayHeight / 2,
                device.displayWidth / 2, device.displayHeight / 2 + device.displayHeight / 10, 30)
            val deadline = SystemClock.elapsedRealtime() + 10_000
            while (SystemClock.elapsedRealtime() < deadline && PaymentAccessibilityStatus.lastSkipped != "wechat_chat_activity")
                SystemClock.sleep(100)
            assertEquals("wechat_chat_activity", PaymentAccessibilityStatus.lastSkipped)
            SystemClock.sleep(1_000)
            assertEquals(readsBefore, PaymentAccessibilityStatus.pageReadCount)
            assertEquals(screenshotsBefore, PaymentAccessibilityStatus.screenshotCount)
            assertEquals(0, enriched.get())
            assertEquals(0, store.localBookings(account).size)
            val className = foreground.substringAfter("com.tencent.mm/").substringBefore(' ')
            Log.i("AerisChatAcceptance", "class=$className serviceConnected=true ticketActive=true skip=wechat_chat_activity pageReads=0 screenshots=0 enrichments=0 ledgerWrites=0 rawTextCaptured=false")
        } finally {
            PaymentAccessibilityDeviceTest.install(null)
            PaymentTicketPackageSignal.clear()
            database.close()
        }
    }
}
