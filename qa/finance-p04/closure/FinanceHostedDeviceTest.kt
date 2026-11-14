package uk.thewyj.app.qa.finance

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.core.network.*
import uk.thewyj.app.core.auth.DeviceCredentials
import uk.thewyj.app.core.auth.DeviceIdentityStore
import uk.thewyj.app.task21.*

private const val HOSTED_ORIGIN = "https://finance-p03-p04-qa.thewyj-finance-qa.pages.dev"
private val hostedContext get() = InstrumentationRegistry.getInstrumentation().targetContext
private fun hostedDir() = File(hostedContext.filesDir, "finance-p04-closure/hosted-valid-reference").also { it.mkdirs() }
private fun digest(text: String) = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
private fun login(index: Int = 0): NotificationCaptureCoordinator.CaptureAccount {
    val fixture = JSONArray(File(hostedContext.filesDir, "finance-p04-closure/hosted-fixture.json").readText()).getJSONObject(index)
    val device = DeviceIdentityStore(hostedContext).getOrCreate()
    val call = runBlocking { ThewyjApiClient(HOSTED_ORIGIN).login(fixture.getString("username"), fixture.getString("secret"), device) }
    assertTrue("Actual Task20 hosted login: " + (call as? ApiCall.Failure)?.code, call is ApiCall.Success)
    val credentials = (call as ApiCall.Success<DeviceCredentials>).value
    assertEquals(fixture.getString("id"), credentials.account.id)
    return NotificationCaptureCoordinator.CaptureAccount(credentials.account.id, device, credentials.accessToken, true)
}
private fun coordinator(account: NotificationCaptureCoordinator.CaptureAccount, queue: OfflineNotificationQueue, transport: NotificationIngestTransport) =
    NotificationCaptureCoordinator(archiveFor = { LocalNotificationArchive.inDirectory(hostedDir(), it) }, queueFor = { queue }, transport = transport, account = { account })
private fun transactions(transport: NotificationIngestTransport, account: NotificationCaptureCoordinator.CaptureAccount): List<JSONObject> {
    val result = transport.get("/api/finance/transactions?limit=200", account.sessionToken)
    assertEquals("Actual hosted ledger GET", 200, result.status)
    val rows = JSONObject(result.body).getJSONArray("transactions")
    return (0 until rows.length()).map { rows.getJSONObject(it) }
}

/** Generated financial events only: this is not a replay of the owner's WeChat receipt. */
@RunWith(AndroidJUnit4::class)
class FinanceHostedSeedTest {
    @Test fun actualHostedCommitWithLostAckLeavesExactDurableOutbox() {
        val account = login()
        val queueFile = File(hostedDir(), "outbox.queue"); assertFalse("Fresh owned QA fixture", queueFile.exists())
        val queue = OfflineNotificationQueue(queueFile)
        val prefix = "synthetic-native-hosted-" + UUID.randomUUID()
        for (currency in listOf("CNY", "USD", "EUR", "HKD", "GBP", "JPY")) {
            val id = "$prefix-$currency"
            val event = StructuredNotificationEvent(eventId = id, fingerprint = digest(id), sourcePackage = "cmb.pb",
                eventType = NotificationEventType.TRANSACTION, parserVersion = "bank-notification-4", parseStatus = ParseStatus.PARSED,
                direction = FinanceDirection.EXPENSE, amountMinor = 1L, currency = currency, paymentChannel = "bank_card",
                merchant = "SYNTHETIC HOSTED QA", counterparty = "", confidence = 950, occurredAtMs = System.currentTimeMillis(),
                receivedAtMs = System.currentTimeMillis(), providerReference = "SYNTH-" + currency + "-" + UUID.randomUUID().toString().replace("-", "").take(24),
                referenceNamespace = "bank_card:cmb", currencyEvidence = currency, amountExponent = if (currency == "JPY") 0 else 2)
            queue.enqueue(id, StructuredEventJson.ingestPayload("1", account.deviceId, id, event))
        }
        assertEquals(6, queue.pendingCount())
        val original = queue.peekRequests()
        val actual = HttpNotificationIngestTransport(HOSTED_ORIGIN)
        var committed: JSONObject? = null
        val responseFacts = JSONArray()
        val loseOneAck = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String): IngestResponse {
                val response = actual.post(path, sessionToken, body)
                val parsed = runCatching { JSONObject(response.body) }.getOrNull()
                responseFacts.put(JSONObject().put("status", response.status).put("ok", response.ok)
                    .put("code", parsed?.optString("code").orEmpty()).put("response_json", parsed != null))
                if (response.ok && committed == null) {
                    val receipt = JSONObject(response.body).getJSONArray("operation_results").getJSONObject(0)
                    assertTrue("Actual remote transaction receipt before dropping only the QA response", receipt.optString("transaction_id").isNotBlank())
                    committed = receipt
                    return IngestResponse(false, 503, "{\"code\":\"synthetic_client_lost_ack\"}")
                }
                return response
            }
        }
        val result = coordinator(account, queue, loseOneAck).flushDetailed()
        FinanceDeviceSupport.record(hostedContext, "HOSTED-NATIVE-HTTP-OBSERVATION", JSONObject().put("responses", responseFacts)
            .put("uploaded", result.uploaded).put("pending", result.pending).put("rejected_count", result.rejected.size))
        assertNotNull("Real hosted commit occurred", committed)
        assertTrue(result.retryableFailures > 0); assertTrue(result.pending > 0)
        assertTrue(transactions(actual, account).any { it.getString("id") == committed!!.getString("transaction_id") })
        val hashes = JSONObject(); queue.peekRequests().forEach { hashes.put(it.operationId, digest(it.body)) }
        val meta = JSONObject().put("seed_pid", android.os.Process.myPid()).put("queue_sha256", digest(queueFile.readText()))
            .put("pending", queue.pendingCount()).put("body_hashes", hashes).put("prefix", prefix)
            .put("committed_id", committed!!.getString("transaction_id")).put("first_body", original.first().body)
        File(hostedDir(), "seed.json").also { check(it.createNewFile()); it.writeText(meta.toString()) }
        FinanceDeviceSupport.record(hostedContext, "HOSTED-NATIVE-LOST-ACK-SEED", JSONObject().put("pid", android.os.Process.myPid())
            .put("pending", result.pending).put("real_remote_commit", true).put("scope", "Generated synthetic event; lost ack simulated after actual HTTPS commit"))
    }
}

@RunWith(AndroidJUnit4::class)
class FinanceHostedRestoreTest {
    @Test fun freshProcessReauthenticatesReplaysSixUnitsAndIsolatesAnotherAccount() {
        val meta = JSONObject(File(hostedDir(), "seed.json").readText())
        assertNotEquals(meta.getInt("seed_pid"), android.os.Process.myPid())
        val queueFile = File(hostedDir(), "outbox.queue"); assertEquals(meta.getString("queue_sha256"), digest(queueFile.readText()))
        val queue = OfflineNotificationQueue(queueFile)
        queue.peekRequests().forEach { assertEquals(meta.getJSONObject("body_hashes").getString(it.operationId), digest(it.body)) }
        val account = login(); val transport = HttpNotificationIngestTransport(HOSTED_ORIGIN)
        val result = coordinator(account, queue, transport).flushDetailed()
        assertEquals("Exact cloud receipts must clear all retained requests", 0, result.pending)
        assertEquals(meta.getInt("pending"), result.uploaded)
        assertEquals(0, result.retryableFailures); assertFalse(result.authenticationRequired); assertTrue(result.rejected.isEmpty())
        val ids = result.outcomes.map { it.transactionId }.toSet(); assertEquals(6, ids.size)
        val before = transactions(transport, account).filter { it.getString("id") in ids }
        assertEquals(6, before.size); assertEquals(setOf("CNY", "USD", "EUR", "HKD", "GBP", "JPY"), before.map { it.getString("currency") }.toSet())
        before.forEach { assertEquals(1L, it.getLong("amount_minor")); if (it.getString("currency") == "JPY") assertEquals(0, it.getInt("amount_exponent")) }
        val replay = transport.post(OfflineNotificationQueue.INGEST_PATH, account.sessionToken, meta.getString("first_body"))
        assertEquals(200, replay.status)
        assertTrue(JSONObject(replay.body).getJSONArray("operation_results").getJSONObject(0).getBoolean("idempotent_replay"))
        assertEquals(before.map { it.toString() }.toSet(), transactions(transport, account).filter { it.getString("id") in ids }.map { it.toString() }.toSet())
        val other = login(1); assertTrue(transactions(transport, other).none { it.getString("id") in ids })
        val proof = JSONObject().put("seed_pid", meta.getInt("seed_pid")).put("restore_pid", android.os.Process.myPid())
            .put("pending", 0).put("transactions", JSONArray(before)).put("idempotent_replay", true).put("other_account_visible", 0)
            .put("real_wechat", false).put("origin", HOSTED_ORIGIN).put("status", "PASS")
        File(hostedDir(), "restored.json").also { check(it.createNewFile()); it.writeText(proof.toString(2)) }
        FinanceDeviceSupport.record(hostedContext, "HOSTED-NATIVE-COLD-RESTORE", proof)
    }
}
