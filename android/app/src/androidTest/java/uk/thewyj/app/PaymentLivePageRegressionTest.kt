package uk.thewyj.app

import android.app.UiAutomation
import android.os.Bundle
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
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import java.util.Collections
import java.util.UUID

/** Real foreground WeChat + the real bound service. Only ticket/ledger fixtures are isolated. */
@RunWith(AndroidJUnit4::class)
class PaymentLivePageRegressionTest {
    @Test fun tenLiveOneCentEntriesTriggerOnceAndNeverDuplicateAccounting() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("opt in with livePaymentPage=true while a real ¥0.01 detail is open", args.getString("livePaymentPage") == "true")
        assertTrue("use the explicitly signed device-test candidate", BuildConfig.PAYMENT_DEVICE_TEST)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        Configurator.getInstance().uiAutomationFlags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
        val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        assertTrue("the real WeChat transfer detail must already be open", device.executeShellCommand("dumpsys activity activities").contains("com.tencent.mm/.plugin.remittance.ui.RemittanceDetailUI"))
        val originalDatabase = NotificationDatabase.get(context)
        fun userLedgerRows(): Int = originalDatabase.openHelper.readableDatabase.query("SELECT COUNT(*) FROM local_payment_bookings").use { it.moveToFirst(); it.getInt(0) }
        val before = userLedgerRows()
        val sessionBefore = NotificationSessionProvider(context).currentAccount()?.accountId
        val database = Room.inMemoryDatabaseBuilder(context, NotificationDatabase::class.java).build()
        val store = RoomPaymentRecognitionStore(database)
        val account = "aeris-device-regression-${UUID.randomUUID()}"
        val messages = Collections.synchronizedList(mutableListOf<PaymentStatusNotificationMessage>())
        val nativeNotifier = AndroidPaymentStatusNotifier(context)
        val notifier = object : PaymentStatusNotifier {
            override fun notify(message: PaymentStatusNotificationMessage): Boolean {
                val posted = nativeNotifier.notify(message)
                if (posted) messages.add(message)
                return posted
            }
            override fun cancel(notificationId: Int) { nativeNotifier.cancel(notificationId) }
        }
        val coordinator = PaymentRecognitionCoordinator(store, notifier = notifier)
        val gateway = object : PaymentAccessibilityGateway {
            override fun financeAccountId() = account
            override fun activeTicket(accountId: String, sourcePackage: String) = store.activeTicketForPackage(accountId, sourcePackage)
            override fun activePackages(accountId: String, nowMs: Long) = store.activeTicketPackages(accountId, nowMs)
            override fun enrich(accountId: String, ticketId: String, enrichment: PaymentEnrichment) = coordinator.onAccessibilityEnrichment(accountId, enrichment, ticketId)
        }
        PaymentAccessibilityDeviceTest.install(gateway)
        try {
            // `am instrument` stops the target process first. Explicitly rebind
            // only the already-granted Aeris service; retain every other grant.
            val key = Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            val enabled = Settings.Secure.getString(context.contentResolver, key).orEmpty()
            val own = enabled.split(':').filter {
                android.content.ComponentName.unflattenFromString(it)?.className == "uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService"
            }
            assertTrue("the existing Aeris accessibility grant is required", own.isNotEmpty())
            automation.adoptShellPermissionIdentity("android.permission.WRITE_SECURE_SETTINGS")
            try {
                assertTrue(Settings.Secure.putString(context.contentResolver, key, enabled.split(':').filterNot { it in own }.joinToString(":")))
                SystemClock.sleep(300)
                assertTrue(Settings.Secure.putString(context.contentResolver, key, enabled))
            } finally {
                Settings.Secure.putString(context.contentResolver, key, enabled)
                automation.dropShellPermissionIdentity()
            }
            val connectDeadline = SystemClock.uptimeMillis() + 10_000
            while (!PaymentAccessibilityStatus.connected && SystemClock.uptimeMillis() < connectDeadline) SystemClock.sleep(100)
            assertTrue("the real framework service must be bound in this instrumented process", PaymentAccessibilityStatus.connected)
            val repetitions = args.getString("repetitions", "10").toInt()
            repeat(repetitions) { index ->
                if (index == 5) {
                    val activityState = device.executeShellCommand("dumpsys activity activities")
                    val top = activityState.lineSequence().first { it.contains("topResumedActivity") && it.contains("com.tencent.mm/") }
                    val paymentTask = Regex(" t([0-9]+)").find(top)!!.groupValues[1].toInt()
                    context.startActivity(android.content.Intent(context, MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                    SystemClock.sleep(900)
                    assertEquals(context.packageName, device.currentPackageName)
                    device.pressHome()
                    SystemClock.sleep(300)
                    automation.adoptShellPermissionIdentity("android.permission.REORDER_TASKS")
                    try {
                        (context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager).moveTaskToFront(paymentTask, 0)
                    } finally { automation.dropShellPermissionIdentity() }
                    SystemClock.sleep(700)
                    assertEquals("com.tencent.mm", device.currentPackageName)
                    assertTrue(PaymentAccessibilityStatus.connected)
                    instrumentation.sendStatus(0, Bundle().apply { putString("paymentLifecycle", "returnedToAeris=true backgrounded=true sameWechatDetailResumed=true serviceConnected=true") })
                }
                assertTrue(device.openNotification()) // Leave the payment foreground: pending callbacks must cancel.
                SystemClock.sleep(400)
                val sourceId = "live-one-cent-$index"
                val outcome = coordinator.onSourceEvent(account, "com.tencent.mm", PaymentSourceType.NOTIFICATION, sourceId,
                    "微信支付", "你建立了一笔转账", sourceAppLabel = "微信")
                assertTrue("an amount-unknown ticket must exist", outcome.ticketId.isNotBlank())
                PaymentTicketPackageSignal.publish("com.tencent.mm")
                device.pressBack() // Re-enter the same real transfer detail; the event must drive the service.
                val deadline = SystemClock.uptimeMillis() + 15_000
                while (store.localBookings(account).size <= index && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(100)
                val booking = store.localBookings(account).firstOrNull { it.recognitionId == outcome.recognitionId }
                assertNotNull("live entry ${index + 1} must trigger within the finite retry window", booking)
                assertEquals("0.01 MUST NOT become 10.00", 1L, booking!!.amountMinor)
                assertEquals("EXPENSE", booking.direction)
                // Storm/replay the exact transaction: the same source and consumed ticket stay idempotent.
                repeat(3) { coordinator.onSourceEvent(account, "com.tencent.mm", PaymentSourceType.NOTIFICATION, sourceId, "微信支付", "你建立了一笔转账") }
                val replay = coordinator.onAccessibilityEnrichment(account,
                    PaymentEnrichment("com.tencent.mm", 1L, "CNY", uk.thewyj.app.task21.FinanceDirection.EXPENSE, null, null, null, System.currentTimeMillis(), 900), outcome.ticketId)
                assertTrue(replay is EnrichmentOutcome.Rejected)
                assertEquals(index + 1, store.localBookings(account).size)
                val successes = synchronized(messages) { messages.toList() }.filter { it.recognitionId == outcome.recognitionId && it.title.contains("金额核实成功") }
                assertEquals("only one verified notification per transaction", 1, successes.size)
                assertTrue(successes.single().body.contains("¥0.01"))
                assertFalse(successes.single().body.contains("¥10.00"))
                val proof = "case=${index + 1} expectedMinor=1 actualMinor=${booking.amountMinor} verificationCount=${successes.size} financeRows=${store.localBookings(account).size} duplicateRows=0"
                Log.i("AerisPayDiag", "stage=device_case $proof")
                instrumentation.sendStatus(0, Bundle().apply { putString("paymentCase", proof) })
            }
            val after = userLedgerRows()
            assertEquals("the real user ledger must remain unchanged by isolated repetitions", before, after)
            assertEquals(sessionBefore, NotificationSessionProvider(context).currentAccount()?.accountId)
            instrumentation.sendStatus(0, Bundle().apply { putString("paymentDataPreservation", "userLedgerBefore=$before userLedgerAfter=$after sessionPreserved=${sessionBefore != null}") })
        } finally {
            PaymentAccessibilityDeviceTest.install(null)
            synchronized(messages) { messages.toList() }.map { it.notificationId }.distinct().forEach(nativeNotifier::cancel)
            database.close()
            // No original database, credential or user notification is removed.
        }
    }
}
