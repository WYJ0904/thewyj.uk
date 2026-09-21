package uk.thewyj.app.task21.payment

import androidx.room.Room
import java.io.File
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.IngestResponse
import uk.thewyj.app.task21.NotificationArchiveSink
import uk.thewyj.app.task21.NotificationCaptureCoordinator
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.NotificationIngestTransport
import uk.thewyj.app.task21.StructuredNotificationEvent
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome
import uk.thewyj.app.task21.ScreenshotMediaEvent
import uk.thewyj.app.task21.store.NotificationCapture
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.NotificationQuery
import uk.thewyj.app.task21.store.PaymentRecognitionStoreContract
import uk.thewyj.app.task21.store.RoomNotificationStore
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import uk.thewyj.app.task21.payment.PaymentRecognitionRecord
import uk.thewyj.app.task21.payment.PaymentRecognitionState

/**
 * Phase 1 cross-client verification (no mocks of the chain under test):
 * a confirm that happened on the Web is pulled by {@link PaymentHintSync.sync()}
 * and must close the Android notification archive with the server transaction id.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PaymentHintSyncCrossClientTest {
    private lateinit var database: NotificationDatabase
    private lateinit var store: RoomNotificationStore
    private lateinit var paymentStore: PaymentRecognitionStoreContract
    private lateinit var databaseFile: File
    private val account = "account-a"

    @Before fun setUp() {
        databaseFile = File(RuntimeEnvironment.getApplication().cacheDir, "hint-sync-${UUID.randomUUID()}.db")
        database = Room.databaseBuilder(RuntimeEnvironment.getApplication(), NotificationDatabase::class.java, databaseFile.absolutePath)
            .addMigrations(
                NotificationDatabase.MIGRATION_1_2,
                NotificationDatabase.MIGRATION_2_3,
                NotificationDatabase.MIGRATION_3_4,
                NotificationDatabase.MIGRATION_4_5,
                NotificationDatabase.MIGRATION_5_6,
                NotificationDatabase.MIGRATION_6_7, NotificationDatabase.MIGRATION_7_8,
            )
            .allowMainThreadQueries()
            .build()
        store = RoomNotificationStore(database)
        paymentStore = RoomPaymentRecognitionStore(database)
    }

    @After fun tearDown() {
        database.close()
        databaseFile.delete()
    }

    private fun sink() = object : NotificationArchiveSink {
        override fun store(
            accountId: String,
            input: NotificationCaptureInput,
            parsed: StructuredNotificationEvent?,
        ): Boolean = false

        override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit

        override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) =
            ScreenshotArchiveOutcome.SKIPPED

        override fun markFinanceOutcome(
            accountId: String,
            sourceEventId: String,
            state: String,
            transactionId: String,
        ): Boolean = store.markFinanceOutcome(accountId, sourceEventId, state, transactionId)

        override fun recognitionSourceEventId(accountId: String, sourceEventId: String): String =
            store.recognitionSourceEventId(accountId, sourceEventId)
    }

    private fun archivePayment(eventId: String) = store.record(
        account,
        NotificationCapture(
            sourcePackage = "cmb.pb",
            sourceType = "notification",
            notificationKey = "key:$eventId",
            notificationId = 7,
            tag = "",
            groupKey = "",
            channelId = "bank",
            postTime = 1_000L,
            isGroup = false,
            isGroupSummary = false,
            title = "招商银行",
            text = "已支付 ¥28.00",
            bigText = "",
            subText = "",
            sourceEventId = eventId,
        ),
    )

    private fun financeState(eventId: String): Pair<String, String> {
        val instanceId = database.notificationDao().instanceIdForEventId(account, eventId)!!
        val instance = database.notificationDao().instance(account, instanceId)!!
        return instance.financeState to instance.financeTransactionId
    }

    private fun syncWith(body: String): PaymentHintSync.Result {
        val transport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String): IngestResponse =
                IngestResponse(false, 404, "{}")

            override fun get(path: String, sessionToken: String): IngestResponse =
                IngestResponse(true, 200, body)
        }
        return PaymentHintSync(
            RuntimeEnvironment.getApplication(),
            hintedTransport = transport,
            hintedStore = paymentStore,
            archiveSink = sink(),
            accountOverride = {
                NotificationCaptureCoordinator.CaptureAccount(
                    accountId = account,
                    deviceId = "device-a",
                    sessionToken = "token-a",
                    financeEntitled = true,
                )
            },
        ).sync()
    }

    @Test fun webConfirmReachesTheAndroidArchiveThroughTheRealPullPath() {
        archivePayment("evt-confirm")
        store.markFinanceOutcome(account, "evt-confirm", "pending")

        val result = syncWith(
            """{"ok":true,"hints":[{"source_event_id":"evt-confirm","state":"confirmed","finance_entry_id":"txn-web-1"}]}""",
        )

        assertEquals(1, result.confirmed)
        assertTrue(result.ok)
        assertEquals("confirmed" to "txn-web-1", financeState("evt-confirm"))
    }

    @Test fun aRepeatedPendingPullCannotResurrectAConfirmedEvent() {
        archivePayment("evt-stable")
        store.markFinanceOutcome(account, "evt-stable", "confirmed", "txn-1")

        // A stale server answer that still lists the event as pending must not
        // rewrite the terminal archive state.
        syncWith("""{"ok":true,"hints":[{"source_event_id":"evt-stable","state":"pending"}]}""")
        assertEquals("confirmed" to "txn-1", financeState("evt-stable"))

        // Nor may a replay of the same confirm change the transaction id.
        syncWith(
            """{"ok":true,"hints":[{"source_event_id":"evt-stable","state":"confirmed","finance_entry_id":"txn-1"}]}""",
        )
        assertEquals("confirmed" to "txn-1", financeState("evt-stable"))
    }

    @Test fun ignoredHintClosesTheArchiveWithoutATransaction() {
        archivePayment("evt-ignored")
        store.markFinanceOutcome(account, "evt-ignored", "pending")
        val result = syncWith("""{"ok":true,"hints":[{"source_event_id":"evt-ignored","state":"ignored"}]}""")
        assertEquals(1, result.ignored)
        assertEquals("ignored" to "", financeState("evt-ignored"))
    }

    @Test fun historyRefreshStillShowsTheTerminalState() {
        archivePayment("evt-history")
        store.markFinanceOutcome(account, "evt-history", "confirmed", "txn-h")
        val history = store.history(account, NotificationQuery(includeRemoved = true, limit = 10))
        assertEquals(1, history.size)
        assertEquals("confirmed" to "txn-h", financeState("evt-history"))
    }

    /**
     * Real-device regression (2026-09-12, ¥104.49 / 招商银行): the pending hint
     * was confirmed on Web /finance, but the local recognition still carried
     * `uploadEventId = ""` (it was captured before the coordinator recorded the
     * hint identity), so the pull could not find it and the Android
     * 「待核实 / 待确认」list kept showing a payment that already had a ledger
     * entry. The archive identity of the same event id is the deterministic link.
     */
    @Test fun legacyHintWithoutALocalUploadEventIdStillClosesTheRecognition() {
        archivePayment("evt-legacy")
        store.markFinanceOutcome(account, "evt-legacy", "pending")
        paymentStore.saveRecognition(
            PaymentRecognitionRecord(
                recognitionId = "rec-legacy",
                accountId = account,
                state = PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
                notificationId = 7,
                sourcePackage = "cmb.pb",
                sourceType = "notification",
                // Exactly what AndroidPaymentRecognitionHook writes for this capture.
                sourceEventId = "notification#key:evt-legacy#1000",
                uploadEventId = "",
                paymentChannel = "bank",
                amountMinor = 10449,
                currency = "CNY",
                direction = "UNKNOWN",
                merchant = "招商银行",
                providerReference = "",
                createdAtMs = 1_000L,
                updatedAtMs = 1_000L,
            ),
        )

        val result = syncWith(
            """{"ok":true,"hints":[{"source_event_id":"evt-legacy","state":"confirmed","finance_entry_id":"txn-legacy-1"}]}""",
        )

        assertEquals(1, result.confirmed)
        assertEquals("confirmed" to "txn-legacy-1", financeState("evt-legacy"))
        assertEquals(
            PaymentRecognitionState.FINANCE_RECORDED.name,
            paymentStore.recognition(account, "rec-legacy")?.state,
        )
    }

    private fun hintAnchorMs(): Long = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US)
        .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
        .parse("2026-09-12T04:28:24")!!
        .time

    private fun legacyMoneyShapeRecognition(recognitionId: String, createdAtMs: Long) = PaymentRecognitionRecord(
        recognitionId = recognitionId,
        accountId = account,
        state = PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
        notificationId = 9,
        sourcePackage = "cmb.pb",
        sourceType = "notification",
        sourceEventId = "notification#bank#$createdAtMs",
        uploadEventId = "",
        paymentChannel = "bank",
        amountMinor = 10449,
        currency = "CNY",
        direction = "UNKNOWN",
        merchant = "招商银行",
        providerReference = "",
        createdAtMs = createdAtMs,
        updatedAtMs = createdAtMs,
    )

    private val moneyShapeHint =
        """{"source_event_id":"evt-money","state":"confirmed","finance_entry_id":"txn-money-1",""" +
            """"device_id":"device-a","source_package":"cmb.pb","amount_minor":10449,""" +
            """"created_at":"2026-09-12T04:28:24"}"""

    /**
     * Real-device evidence (1.3.1, 2026-09-12): the archive entry for the
     * confirmed ¥104.49 hint did not exist, so the archive-identity link was
     * empty and the Android row stayed pending. The same device, package and
     * amount inside the hint's capture window is the last deterministic link.
     */
    @Test fun legacyHintWithoutArchiveEntryClosesThroughTheUniqueMoneyShape() {
        paymentStore.saveRecognition(
            legacyMoneyShapeRecognition("rec-money", hintAnchorMs() - 5L * 60L * 1000L),
        )

        val result = syncWith("""{"ok":true,"hints":[$moneyShapeHint]}""")

        assertEquals(1, result.confirmed)
        assertEquals(
            PaymentRecognitionState.FINANCE_RECORDED.name,
            paymentStore.recognition(account, "rec-money")?.state,
        )
    }

    @Test fun ambiguousMoneyShapeIsNeverClosedByAGuess() {
        val anchor = hintAnchorMs()
        paymentStore.saveRecognition(legacyMoneyShapeRecognition("rec-money-a", anchor - 60_000L))
        paymentStore.saveRecognition(legacyMoneyShapeRecognition("rec-money-b", anchor + 60_000L))

        syncWith("""{"ok":true,"hints":[$moneyShapeHint]}""")

        assertEquals(
            PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
            paymentStore.recognition(account, "rec-money-a")?.state,
        )
        assertEquals(
            PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
            paymentStore.recognition(account, "rec-money-b")?.state,
        )
    }

    @Test fun moneyShapeFromAnotherDeviceIsNeverAdopted() {
        paymentStore.saveRecognition(
            legacyMoneyShapeRecognition("rec-other-device", hintAnchorMs() - 5L * 60L * 1000L),
        )

        syncWith(
            """{"ok":true,"hints":[{"source_event_id":"evt-other","state":"confirmed","finance_entry_id":"txn-other",""" +
                """"device_id":"device-b","source_package":"cmb.pb","amount_minor":10449,""" +
                """"created_at":"2026-09-12T04:28:24"}]}""",
        )

        assertEquals(
            PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
            paymentStore.recognition(account, "rec-other-device")?.state,
        )
    }

    @Test fun accessibilityEnrichmentPushesIntoTheExistingCloudHintIdentity() {
        paymentStore.saveRecognition(
            PaymentRecognitionRecord(
                recognitionId = "rec-enriched",
                accountId = account,
                state = PaymentRecognitionState.ENRICHMENT_VERIFIED.name,
                notificationId = 10,
                sourcePackage = "com.tencent.mm",
                sourceType = "notification",
                sourceEventId = "notification#wechat#enriched",
                uploadEventId = "evt-enriched",
                paymentChannel = "wechat",
                amountMinor = 1,
                currency = "CNY",
                direction = "EXPENSE",
                merchant = "",
                providerReference = "",
                createdAtMs = 2_000L,
                updatedAtMs = 2_000L,
            ),
        )
        paymentStore.saveCandidate(
            PaymentCandidate(
                candidateId = "cand-enriched",
                accountId = account,
                recognitionId = "rec-enriched",
                status = "pending",
                amountMinor = 1,
                direction = "EXPENSE",
                category = "",
                merchant = "",
                occurredAtMs = 2_000L,
                channel = "wechat",
                confidence = 950,
                reason = "accessibility_enrichment",
                createdAtMs = 2_000L,
                updatedAtMs = 2_000L,
            ),
        )
        var postedPath = ""
        var postedBody = ""
        val transport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String): IngestResponse {
                postedPath = path
                postedBody = body
                return IngestResponse(true, 200, """{"ok":true}""")
            }
        }
        val sync = PaymentHintSync(
            RuntimeEnvironment.getApplication(),
            hintedTransport = transport,
            hintedStore = paymentStore,
            archiveSink = sink(),
            accountOverride = {
                NotificationCaptureCoordinator.CaptureAccount(
                    accountId = account,
                    deviceId = "device-a",
                    sessionToken = "token-a",
                    financeEntitled = true,
                )
            },
        )

        assertTrue(sync.publishEnrichment(account, "rec-enriched"))
        assertEquals("/api/notification/hints", postedPath)
        val payload = org.json.JSONObject(postedBody)
        val hint = payload.getJSONArray("hints").getJSONObject(0)
        assertEquals("evt-enriched", hint.getString("source_event_id"))
        assertEquals(1L, hint.getLong("amount_minor"))
        assertEquals("expense", hint.getString("direction"))
        assertEquals("accessibility", hint.getString("source_type"))
        assertEquals("CONFIRMED_PAYMENT", hint.getString("recognition_status"))
    }

    @Test fun explicitIgnoreTerminatesTheMatchingCloudReviewBeforeLocalDismissal() {
        var postedPath = ""
        var postedBody = ""
        val transport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String): IngestResponse {
                postedPath = path
                postedBody = body
                return IngestResponse(true, 200, """{"ok":true}""")
            }

            override fun get(path: String, sessionToken: String): IngestResponse {
                assertTrue(path.startsWith("/api/notification/pending-summary?event_ids="))
                return IngestResponse(
                    true,
                    200,
                    """{"ok":true,"records":[{"kind":"hint","id":"hint:cloud-1","event_id":"evt-ignore","event_ids":["evt-ignore"],"state":"pending"}]}""",
                )
            }
        }
        val sync = PaymentHintSync(
            RuntimeEnvironment.getApplication(),
            hintedTransport = transport,
            hintedStore = paymentStore,
            archiveSink = sink(),
            accountOverride = {
                NotificationCaptureCoordinator.CaptureAccount(
                    accountId = account,
                    deviceId = "device-a",
                    sessionToken = "token-a",
                    financeEntitled = true,
                )
            },
        )

        val result = sync.dismissRemote(account, "evt-ignore")
        assertTrue(result.ok)
        assertTrue(result.changed)
        assertEquals("/api/notification/hints/ignore", postedPath)
        assertEquals("hint:cloud-1", org.json.JSONObject(postedBody).getString("hint_id"))
    }


    @Test fun confirmedCloudReviewCannotBeLocallyIgnored() {
        var postCalls = 0
        val transport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String): IngestResponse {
                postCalls += 1
                return IngestResponse(true, 200, """{"ok":true}""")
            }

            override fun get(path: String, sessionToken: String): IngestResponse =
                IngestResponse(
                    true,
                    200,
                    """{"ok":true,"records":[{"kind":"hint","id":"hint:confirmed","event_id":"evt-confirmed","event_ids":["evt-confirmed"],"state":"confirmed","transaction_id":"txn-1"}]}""",
                )
        }
        val sync = PaymentHintSync(
            RuntimeEnvironment.getApplication(),
            hintedTransport = transport,
            hintedStore = paymentStore,
            archiveSink = sink(),
            accountOverride = {
                NotificationCaptureCoordinator.CaptureAccount(
                    accountId = account,
                    deviceId = "device-a",
                    sessionToken = "token-a",
                    financeEntitled = true,
                )
            },
        )

        val result = sync.dismissRemote(account, "evt-confirmed")
        assertFalse(result.ok)
        assertTrue(result.message.contains("已在财务账本中确认"))
        assertEquals(0, postCalls)
    }

    private fun savePendingUploadedCandidate(recognitionId: String, candidateId: String, eventId: String) {
        paymentStore.saveRecognition(
            PaymentRecognitionRecord(
                recognitionId = recognitionId,
                accountId = account,
                state = PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
                notificationId = 21,
                sourcePackage = "com.tencent.mm",
                sourceType = "notification",
                sourceEventId = "notification#wechat#$recognitionId",
                uploadEventId = eventId,
                paymentChannel = "wechat",
                amountMinor = 1,
                currency = "CNY",
                direction = "EXPENSE",
                merchant = "",
                providerReference = "",
                createdAtMs = 3_000L,
                updatedAtMs = 3_000L,
            ),
        )
        paymentStore.saveCandidate(
            PaymentCandidate(
                candidateId = candidateId,
                accountId = account,
                recognitionId = recognitionId,
                status = "pending",
                amountMinor = 1,
                direction = "EXPENSE",
                category = "",
                merchant = "",
                occurredAtMs = 3_000L,
                channel = "wechat",
                confidence = 900,
                reason = "notification_candidate",
                createdAtMs = 3_000L,
                updatedAtMs = 3_000L,
            ),
        )
    }

    @Test fun webConfirmedCandidateClosesAndroidRecognitionOnPull() {
        archivePayment("evt-candidate-confirmed")
        store.markFinanceOutcome(account, "evt-candidate-confirmed", "pending")
        savePendingUploadedCandidate("rec-candidate-confirmed", "cand-local-confirmed", "evt-candidate-confirmed")

        val transport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String) =
                IngestResponse(true, 200, """{"ok":true}""")

            override fun get(path: String, sessionToken: String): IngestResponse = when {
                path.startsWith("/api/notification/hints") ->
                    IngestResponse(true, 200, """{"ok":true,"hints":[]}""")
                path.contains("status=confirmed") ->
                    IngestResponse(
                        true,
                        200,
                        """{"ok":true,"candidates":[{"id":"cand-cloud","event_id":"evt-candidate-confirmed","status":"confirmed","finance_transaction_id":"txn-cloud-1","evidence":[{"event_id":"evt-candidate-confirmed"}]}]}""",
                    )
                path.contains("status=rejected") ->
                    IngestResponse(true, 200, """{"ok":true,"candidates":[]}""")
                else -> IngestResponse(false, 404, "{}")
            }
        }
        val sync = PaymentHintSync(
            RuntimeEnvironment.getApplication(),
            hintedTransport = transport,
            hintedStore = paymentStore,
            archiveSink = sink(),
            accountOverride = {
                NotificationCaptureCoordinator.CaptureAccount(
                    accountId = account,
                    deviceId = "device-a",
                    sessionToken = "token-a",
                    financeEntitled = true,
                )
            },
        )

        assertTrue(sync.sync().ok)
        assertEquals(
            PaymentRecognitionState.FINANCE_RECORDED.name,
            paymentStore.recognition(account, "rec-candidate-confirmed")?.state,
        )
        assertEquals(
            "txn-cloud-1",
            paymentStore.candidateForRecognition(account, "rec-candidate-confirmed")?.financeTransactionId,
        )
        assertEquals("confirmed" to "txn-cloud-1", financeState("evt-candidate-confirmed"))
    }

    @Test fun webRejectedCandidateClosesAndroidRecognitionOnPull() {
        archivePayment("evt-candidate-rejected")
        store.markFinanceOutcome(account, "evt-candidate-rejected", "pending")
        savePendingUploadedCandidate("rec-candidate-rejected", "cand-local-rejected", "evt-candidate-rejected")

        val transport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String) =
                IngestResponse(true, 200, """{"ok":true}""")

            override fun get(path: String, sessionToken: String): IngestResponse = when {
                path.startsWith("/api/notification/hints") ->
                    IngestResponse(true, 200, """{"ok":true,"hints":[]}""")
                path.contains("status=confirmed") ->
                    IngestResponse(true, 200, """{"ok":true,"candidates":[]}""")
                path.contains("status=rejected") ->
                    IngestResponse(
                        true,
                        200,
                        """{"ok":true,"candidates":[{"id":"cand-cloud","event_id":"evt-candidate-rejected","status":"rejected","finance_transaction_id":"","evidence":[{"event_id":"evt-candidate-rejected"}]}]}""",
                    )
                else -> IngestResponse(false, 404, "{}")
            }
        }
        val sync = PaymentHintSync(
            RuntimeEnvironment.getApplication(),
            hintedTransport = transport,
            hintedStore = paymentStore,
            archiveSink = sink(),
            accountOverride = {
                NotificationCaptureCoordinator.CaptureAccount(
                    accountId = account,
                    deviceId = "device-a",
                    sessionToken = "token-a",
                    financeEntitled = true,
                )
            },
        )

        assertTrue(sync.sync().ok)
        assertEquals(
            PaymentRecognitionState.IGNORED.name,
            paymentStore.recognition(account, "rec-candidate-rejected")?.state,
        )
        assertEquals(
            "rejected",
            paymentStore.candidateForRecognition(account, "rec-candidate-rejected")?.status,
        )
        assertEquals("ignored" to "", financeState("evt-candidate-rejected"))
    }

}
