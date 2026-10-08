package uk.thewyj.app

import android.app.Notification
import android.app.NotificationManager
import android.app.UiAutomation
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.core.auth.DeviceIdentityStore
import uk.thewyj.app.core.auth.SecureCredentialStore
import uk.thewyj.app.core.network.ApiCall
import uk.thewyj.app.core.network.ThewyjApiClient
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID

/** Opt-in hardware acceptance against the ordinary signed R8 package.
 * No replacement gateway, test BuildConfig flag, real payment or original-account booking.
 * Fixtures use a normally authenticated new account; original credentials remain encrypted.
 */
@RunWith(AndroidJUnit4::class)
class FormalReleaseDeviceTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private fun proof(key: String, value: String) = instrumentation.sendStatus(0, Bundle().apply { putString(key, value) })
    private fun ordinaryRelease() {
        assertFalse(BuildConfig.DEBUG)
        assertFalse(BuildConfig.PAYMENT_DEVICE_TEST)
        assertFalse(BuildConfig.PAYMENT_DIAGNOSTICS)
        assertEquals("uk.thewyj.app", context.packageName)
        assertEquals("samsung", Build.MANUFACTURER.lowercase())
        assertEquals(36, Build.VERSION.SDK_INT)
    }
    private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun request(route: String, token: String, payload: JSONObject? = null): JSONObject {
        val connection = URL(BuildConfig.THEWYJ_BASE_URL + route).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 20_000; connection.readTimeout = 20_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Origin", BuildConfig.THEWYJ_BASE_URL)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("User-Agent", "Thewyj-Android/${BuildConfig.VERSION_NAME}")
            connection.setRequestProperty("X-Session-Token", token)
            if (payload != null) {
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.outputStream.use { it.write(payload.toString().toByteArray()) }
            }
            val status = connection.responseCode
            assertEquals("Normal authenticated request failed: $route", 200, status)
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }

    @Test fun originalAccountAndRoomBaseline() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("formalAcceptance") == "true")
        ordinaryRelease()
        val saved = SecureCredentialStore(context).loadActive()
        assertNotNull("Existing encrypted session must survive upgrade", saved)
        val store = RoomPaymentRecognitionStore(NotificationDatabase.get(context))
        val bookings = store.localBookings(saved!!.account.id)
        val prefs = context.getSharedPreferences("task25.formal.acceptance", Context.MODE_PRIVATE)
        assertTrue(prefs.edit().putString("original_account_digest", digest(saved.account.id))
            .putString("original_bookings_digest", digest(bookings.toString())).putInt("original_bookings_count", bookings.size).commit())
        proof("formalBaseline", "version=${BuildConfig.VERSION_NAME}/${BuildConfig.VERSION_CODE} originalAccountAdmin=${saved.account.isAdmin} originalBookings=${bookings.size} encryptedSessionPresent=true deviceTest=false diagnostics=false")
    }

    @Test fun tenLiveOneCentEntriesThroughOrdinaryProductionGateway() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("formalAcceptance") == "true" && args.getString("livePaymentPage") == "true")
        ordinaryRelease()
        val credentials = SecureCredentialStore(context)
        var original = credentials.loadActive() ?: error("Existing encrypted session required")
        val originalDevice = DeviceIdentityStore(context).getOrCreate()
        val api = ThewyjApiClient()
        if (original.accessExpiresAtEpochMs <= System.currentTimeMillis() + 60_000) {
            val renewed = api.refresh(original, originalDevice, UUID.randomUUID().toString())
            assertTrue("Existing session must renew through its normal authenticated refresh API", renewed is ApiCall.Success)
            original = (renewed as ApiCall.Success).value
            credentials.saveActive(original)
        }
        assertTrue("Existing authorized administrator is required for a new isolated Finance test account", original.account.isAdmin)
        // The backup is encrypted and kept on-device until final physical acceptance is complete.
        SecureCredentialStore(context, ".task25-original-backup").saveActive(original)
        val store = RoomPaymentRecognitionStore(NotificationDatabase.get(context))
        val originalBookings = store.localBookings(original.account.id)
        val username = "t25r8_" + UUID.randomUUID().toString().replace("-", "").take(12)
        val secret = UUID.randomUUID().toString() + UUID.randomUUID()
        // A normal account switch on this phone keeps its real device identity.
        val fixtureDevice = originalDevice
        val registration = api.register(username, secret)
        assertTrue("Normal synthetic registration must succeed", registration is ApiCall.Success)
        val login = api.login(username, secret, fixtureDevice)
        assertTrue("Normal native login must succeed", login is ApiCall.Success)
        var fixture = (login as ApiCall.Success).value
        assertFalse(fixture.account.isAdmin)
        val grant = JSONObject().put("user_id", fixture.account.id).put("entitlement", "finance_access")
            .put("allowed", true).put("note", "Task25 formal R8 acceptance: new synthetic account only; revoked after payment checks")
        var granted = false
        try {
            request("/api/admin/entitlement", original.accessToken, grant); granted = true
            val liveAccount = api.currentAccount(fixture.accessToken)
            assertTrue("Server must authoritatively grant fixture Finance access", liveAccount is ApiCall.Success)
            fixture = fixture.copy(account = (liveAccount as ApiCall.Success).value)
            assertTrue(fixture.account.entitlements.contains("finance_access"))
            SecureCredentialStore(context, ".task25-r8-fixture").saveActive(fixture)
            context.getSharedPreferences("task25.formal.acceptance", Context.MODE_PRIVATE).edit()
                .putString("fixture_device", fixtureDevice).putString("fixture_account", fixture.account.id).commit()
            credentials.saveActive(fixture)
            assertTrue(NotificationSessionProvider(context).currentAccount()?.accountId == fixture.account.id)
            Configurator.getInstance().uiAutomationFlags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
            val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
            val device = UiDevice.getInstance(instrumentation)
            val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
            val own = enabled.split(':').filter { android.content.ComponentName.unflattenFromString(it)?.className == "uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService" }
            assertTrue("Existing accessibility permission required", own.isNotEmpty())
            automation.adoptShellPermissionIdentity("android.permission.WRITE_SECURE_SETTINGS")
            try {
                assertTrue(Settings.Secure.putString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, enabled.split(':').filterNot { it in own }.joinToString(":")))
                SystemClock.sleep(300)
                assertTrue(Settings.Secure.putString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, enabled))
            } finally {
                Settings.Secure.putString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, enabled)
                automation.dropShellPermissionIdentity()
            }
            val connectDeadline = SystemClock.uptimeMillis() + 10_000
            while (!PaymentAccessibilityStatus.connected && SystemClock.uptimeMillis() < connectDeadline) SystemClock.sleep(100)
            assertTrue("The real framework service must bind", PaymentAccessibilityStatus.connected)
            val paymentTask = args.getString("wechatTask")!!.toInt()
            fun foregroundWechat() {
                automation.adoptShellPermissionIdentity("android.permission.REORDER_TASKS")
                try { (context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager).moveTaskToFront(paymentTask, 0) }
                finally { automation.dropShellPermissionIdentity() }
                SystemClock.sleep(700)
                assertTrue("The existing real transfer detail must remain open", device.executeShellCommand("dumpsys activity activities").contains("topResumedActivity") && device.currentPackageName == "com.tencent.mm")
            }
            foregroundWechat()
            assertTrue(device.executeShellCommand("dumpsys activity activities").lineSequence().any { it.contains("topResumedActivity") && it.contains("RemittanceDetailUI") })
            val coordinator = PaymentRecognitionCoordinator(store, notifier = AndroidPaymentStatusNotifier(context))
            val manager = context.getSystemService(NotificationManager::class.java)
            val baseline = store.localBookings(fixture.account.id).size
            repeat(10) { index ->
                if (index == 5) {
                    context.startActivity(android.content.Intent(context, MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                    SystemClock.sleep(1200); assertEquals(context.packageName, device.currentPackageName)
                    device.pressHome(); SystemClock.sleep(300); foregroundWechat()
                    proof("formalLifecycle", "returnedToAeris=true backgrounded=true sameWechatDetailResumed=true serviceConnected=${PaymentAccessibilityStatus.connected}")
                }
                assertTrue(device.openNotification()); SystemClock.sleep(400)
                val sourceId = "task25-r8-${fixture.account.id}-$index"
                val outcome = coordinator.onSourceEvent(fixture.account.id, "com.tencent.mm", PaymentSourceType.NOTIFICATION,
                    sourceId, "微信支付", "你建立了一笔转账", sourceAppLabel = "微信")
                assertTrue(outcome.ticketId.isNotBlank())
                PaymentTicketPackageSignal.publish("com.tencent.mm")
                device.pressBack()
                val deadline = SystemClock.uptimeMillis() + 15_000
                while (store.localBookings(fixture.account.id).size < baseline + index + 1 && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(100)
                val booking = store.localBookings(fixture.account.id).firstOrNull { it.recognitionId == outcome.recognitionId }
                assertNotNull("Formal R8 live entry ${index+1} must trigger within the retry window", booking)
                assertEquals("0.01 MUST NOT become 10.00", 1L, booking!!.amountMinor)
                assertEquals("EXPENSE", booking.direction)
                repeat(3) { coordinator.onSourceEvent(fixture.account.id, "com.tencent.mm", PaymentSourceType.NOTIFICATION, sourceId, "微信支付", "你建立了一笔转账") }
                val replay = AndroidPaymentRecognitionHook.get(context).onAccessibilityEnrichment(fixture.account.id,
                    PaymentEnrichment("com.tencent.mm", 1L, "CNY", uk.thewyj.app.task21.FinanceDirection.EXPENSE, null, null, null, System.currentTimeMillis(), 900), outcome.ticketId)
                assertTrue(replay is EnrichmentOutcome.Rejected)
                assertEquals(baseline + index + 1, store.localBookings(fixture.account.id).size)
                val notificationId = store.recognition(fixture.account.id, outcome.recognitionId)!!.notificationId
                val noticeDeadline = SystemClock.uptimeMillis() + 5000
                var notice = manager.activeNotifications.singleOrNull { it.id == notificationId && it.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.contains("金额核实成功") == true }
                while (notice == null && SystemClock.uptimeMillis() < noticeDeadline) {
                    SystemClock.sleep(100)
                    notice = manager.activeNotifications.singleOrNull { it.id == notificationId && it.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.contains("金额核实成功") == true }
                }
                assertNotNull("The actual production notifier must display ¥0.01", notice)
                assertTrue(notice!!.notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("¥0.01"))
                assertFalse(notice.notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("¥10.00"))
                proof("formalPaymentCase", "case=${index+1} expectedMinor=1 actualMinor=${booking.amountMinor} fixtureRows=${store.localBookings(fixture.account.id).size} duplicateRows=0 ordinaryGateway=true")
                manager.cancel(notice.id)
            }
            assertTrue("Original Finance rows must remain identical", originalBookings == store.localBookings(original.account.id))
            proof("formalFinanceProtection", "originalBookingsBefore=${originalBookings.size} originalBookingsAfter=${store.localBookings(original.account.id).size} originalRowsIdentical=true syntheticAccountOnly=true")
        } finally {
            credentials.saveActive(original)
            assertTrue("Original encrypted account/session must be restored", credentials.loadActive() == original)
            if (granted) request("/api/admin/entitlement", original.accessToken, grant.put("allowed", false))
            assertTrue("Original Finance rows must remain identical after restoration", originalBookings == store.localBookings(original.account.id))
            proof("formalRestoration", "originalSessionRestored=true originalFinanceRowsIdentical=true syntheticFinanceEntitlementRevoked=$granted originalDeviceIdentityPreserved=${DeviceIdentityStore(context).getOrCreate() == originalDevice}")
        }
    }
}
