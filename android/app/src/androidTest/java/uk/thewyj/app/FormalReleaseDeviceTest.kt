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
        val serverSession = runBlocking { ThewyjApiClient().currentAccount(saved!!.accessToken) }
        assertTrue("Original session must still authenticate normally on the server", serverSession is ApiCall.Success && serverSession.value.id == saved!!.account.id)
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
        val expectedMinor = args.getString("expectedMinor")?.toLong() ?: 1L
        val expectedDirection = args.getString("expectedDirection") ?: "EXPENSE"
        val cases = args.getString("liveCases")?.toInt() ?: 10
        val sourceActivity = args.getString("sourceActivity") ?: "RemittanceDetailUI"
        require(expectedMinor > 0 && cases >= 1 && cases <= 20 && (expectedDirection == "EXPENSE" || expectedDirection == "INCOME"))
        val sourceText = when (expectedDirection) {
            "INCOME" -> "你收到一笔转账"
            else -> "你建立了一笔转账"
        }
        val expectedMoney = "%d.%02d".format(java.util.Locale.ROOT, expectedMinor / 100, expectedMinor % 100)
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
        // Native relogin revokes every session for the supplied logical device.
        // Keep the original server session intact with a separate fixture ID.
        val fixtureDevice = UUID.randomUUID().toString()
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
            assertTrue(context.getSharedPreferences("uk.thewyj.app.device.v1", Context.MODE_PRIVATE).edit()
                .putString("device_id", fixtureDevice).commit())
            credentials.saveActive(fixture)
            assertTrue(NotificationSessionProvider(context).currentAccount()?.accountId == fixture.account.id)
            args.getString("driverTransitionDelayMs")?.toLong()?.let {
                require(it in 0L..10_000L)
                SystemClock.sleep(it)
            }
            Configurator.getInstance().uiAutomationFlags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
            val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
            val device = UiDevice.getInstance(instrumentation)
            val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
            val own = enabled.split(':').filter { android.content.ComponentName.unflattenFromString(it)?.className == "uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService" }
            assertTrue("Existing accessibility permission required", own.isNotEmpty())
            // The user grants accessibility through normal settings. Never toggle
            // secure settings or grant an auxiliary listener to prepare this test.
            val connectDeadline = SystemClock.uptimeMillis() + 20_000
            while (!PaymentAccessibilityStatus.connected && SystemClock.uptimeMillis() < connectDeadline) SystemClock.sleep(100)
            assertTrue("The real framework service must bind", PaymentAccessibilityStatus.connected)
            val paymentTask = args.getString("wechatTask")!!.toInt()
            fun foregroundWechat() {
                automation.adoptShellPermissionIdentity("android.permission.REORDER_TASKS")
                try { (context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager).moveTaskToFront(paymentTask, 0) }
                finally { automation.dropShellPermissionIdentity() }
                SystemClock.sleep(700)
                assertTrue("The existing real transfer detail must remain open", device.executeShellCommand("dumpsys activity activities").contains("topResumedActivity") && device.currentPackageName == "com.tencent.mm")
                args.getString("sourceUser")?.let { user ->
                    assertTrue("The same source profile must remain foreground", device.executeShellCommand("dumpsys activity activities").lineSequence().any { it.contains("topResumedActivity") && it.contains(" u$user ") && it.contains("com.tencent.mm") })
                }
            }
            foregroundWechat()
            assertTrue("The declared actual payment-detail activity must be foreground", device.executeShellCommand("dumpsys activity activities").lineSequence().any { it.contains("topResumedActivity") && it.contains(sourceActivity) })
            val coordinator = PaymentRecognitionCoordinator(store, notifier = AndroidPaymentStatusNotifier(context))
            val manager = context.getSystemService(NotificationManager::class.java)
            val baseline = store.localBookings(fixture.account.id).size
            repeat(cases) { index ->
                if (index == 5) {
                    context.startActivity(android.content.Intent(context, MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                    SystemClock.sleep(1200); assertEquals(context.packageName, device.currentPackageName)
                    device.pressHome(); SystemClock.sleep(300); foregroundWechat()
                    proof("formalLifecycle", "returnedToAeris=true backgrounded=true sameWechatDetailResumed=true serviceConnected=${PaymentAccessibilityStatus.connected}")
                }
                assertTrue(device.openNotification()); SystemClock.sleep(400)
                val sourceId = "task25-r8-${fixture.account.id}-$index"
                val outcome = coordinator.onSourceEvent(fixture.account.id, "com.tencent.mm", PaymentSourceType.NOTIFICATION,
                    sourceId, "微信支付", sourceText, sourceAppLabel = "微信")
                assertTrue(outcome.ticketId.isNotBlank())
                val notificationId = store.recognition(fixture.account.id, outcome.recognitionId)!!.notificationId
                PaymentTicketPackageSignal.publish("com.tencent.mm")
                device.pressBack()
                val deadline = SystemClock.uptimeMillis() + 15_000
                while (store.localBookings(fixture.account.id).size < baseline + index + 1 && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(100)
                val booking = store.localBookings(fixture.account.id).firstOrNull { it.recognitionId == outcome.recognitionId }
                assertNotNull("Formal R8 live entry ${index+1} must trigger within the retry window", booking)
                assertEquals("The actual foreground detail amount must match exactly", expectedMinor, booking!!.amountMinor)
                assertEquals(expectedDirection, booking.direction)
                val noticeDeadline = SystemClock.uptimeMillis() + 5000
                while (manager.activeNotifications.none { it.id == notificationId } && SystemClock.uptimeMillis() < noticeDeadline) SystemClock.sleep(100)
                val firstNotice = manager.activeNotifications.singleOrNull { it.id == notificationId }
                assertNotNull("Own final accounting notification must exist", firstNotice)
                repeat(3) { coordinator.onSourceEvent(fixture.account.id, "com.tencent.mm", PaymentSourceType.NOTIFICATION, sourceId, "微信支付", sourceText) }
                val replay = AndroidPaymentRecognitionHook.get(context).onAccessibilityEnrichment(fixture.account.id,
                    PaymentEnrichment("com.tencent.mm", expectedMinor, "CNY", if (expectedDirection == "INCOME") uk.thewyj.app.task21.FinanceDirection.INCOME else uk.thewyj.app.task21.FinanceDirection.EXPENSE, null, null, null, System.currentTimeMillis(), 900), outcome.ticketId)
                assertTrue(replay is EnrichmentOutcome.Rejected)
                assertEquals(baseline + index + 1, store.localBookings(fixture.account.id).size)
                val recorded = manager.activeNotifications.singleOrNull { it.id == notificationId }
                assertNotNull("The final accounting notification must remain visible", recorded)
                assertEquals("Replay must not repost the same success notification", firstNotice!!.postTime, recorded!!.postTime)
                assertTrue(recorded.notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("¥$expectedMoney"))
                proof("formalPaymentCase", "case=${index+1} expectedMinor=$expectedMinor actualMinor=${booking.amountMinor} direction=${booking.direction} fixtureRows=${store.localBookings(fixture.account.id).size} duplicateRows=0 ordinaryGateway=true ownSystemNotificationObserved=true replayPostTimeUnchanged=true")
                if (index == 0 && args.getString("captureProof") == "true") {
                    assertTrue(device.openNotification()); SystemClock.sleep(700)
                    val image = java.io.File(instrumentation.context.getExternalFilesDir(null), "release-b-transfer-notification.png")
                    assertTrue("Real system notification screenshot must be saved", device.takeScreenshot(image))
                    proof("formalScreenshot", "realSystemNotification=true file=release-b-transfer-notification.png privateEvidence=true")
                    device.pressBack(); foregroundWechat()
                }
                manager.cancel(notificationId)
            }
            if (args.getString("verifyCloud") == "true") {
                val pipeline = uk.thewyj.app.task21.NotificationCapturePipeline.create(context, NotificationSessionProvider(context))
                LocalPaymentLedger.recover(context, fixture.account.id, fixtureDevice)
                pipeline.flushDetailed()
                val syncDeadline = SystemClock.uptimeMillis() + 30_000
                while (store.localBookings(fixture.account.id).any { it.syncState != "synced" } && SystemClock.uptimeMillis() < syncDeadline) SystemClock.sleep(100)
                val local = store.localBookings(fixture.account.id)
                assertTrue("Every local booking must receive a real server receipt", local.all { it.syncState == "synced" })
                val remote = request("/api/finance/transactions?limit=100", fixture.accessToken).getJSONArray("transactions")
                assertEquals("Exactly one remote row per verified test event", cases, remote.length())
                val remoteIds = mutableListOf<String>()
                for (i in 0 until remote.length()) {
                    val row = remote.getJSONObject(i)
                    assertEquals(expectedMinor, row.getLong("amount_minor"))
                    assertEquals(expectedDirection, row.getString("direction").uppercase(java.util.Locale.ROOT))
                    remoteIds.add(row.getString("id"))
                }
                assertEquals(local.map { it.transactionId }.sorted(), remoteIds.sorted())
                repeat(2) { LocalPaymentLedger.recover(context, fixture.account.id, fixtureDevice); pipeline.flushDetailed() }
                val replayRows = request("/api/finance/transactions?limit=100", fixture.accessToken).getJSONArray("transactions")
                assertEquals(cases, replayRows.length())
                val replayIds = (0 until replayRows.length()).map { replayRows.getJSONObject(it).getString("id") }
                assertEquals(remoteIds.sorted(), replayIds.sorted())
                proof("formalCloud", "normalProductionApi=true syncedLocalRows=${local.size} remoteRows=${remote.length()} exactAmountsAndDirection=true idsMatch=true repeatedOutboxFlushes=2 duplicateRemoteRows=0")
            }
            assertTrue("Original Finance rows must remain identical", originalBookings == store.localBookings(original.account.id))
            proof("formalFinanceProtection", "originalBookingsBefore=${originalBookings.size} originalBookingsAfter=${store.localBookings(original.account.id).size} originalRowsIdentical=true syntheticAccountOnly=true")
        } finally {
            credentials.saveActive(original)
            assertTrue(context.getSharedPreferences("uk.thewyj.app.device.v1", Context.MODE_PRIVATE).edit()
                .putString("device_id", originalDevice).commit())
            assertTrue("Original encrypted account/session must be restored", credentials.loadActive() == original)
            if (granted) request("/api/admin/entitlement", original.accessToken, grant.put("allowed", false))
            val deleted = request("/api/account/delete", fixture.accessToken, JSONObject().put("secret", secret))
            assertTrue("Only the owned synthetic account must be soft-deleted", deleted.optBoolean("account_deleted"))
            val serverSession = api.currentAccount(original.accessToken)
            assertTrue("Original session must remain valid on the real server", serverSession is ApiCall.Success && serverSession.value.id == original.account.id)
            assertTrue("Original Finance rows must remain identical after restoration", originalBookings == store.localBookings(original.account.id))
            proof("formalRestoration", "originalSessionRestored=true originalFinanceRowsIdentical=true syntheticFinanceEntitlementRevoked=$granted originalDeviceIdentityPreserved=${DeviceIdentityStore(context).getOrCreate() == originalDevice}")
        }
    }
}
