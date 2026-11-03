package uk.thewyj.app.task21.payment

import androidx.room.Room
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.core.network.PendingReviewIdentity
import uk.thewyj.app.core.network.PendingReviewSummary
import uk.thewyj.app.task21.store.*
import uk.thewyj.app.ui.PaymentVerificationState

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PaymentDisplayConsistencyTest {
    private val account = "display-account"
    private lateinit var db: NotificationDatabase
    private lateinit var store: RoomPaymentRecognitionStore
    @Before fun before() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), NotificationDatabase::class.java).allowMainThreadQueries().build()
        store = RoomPaymentRecognitionStore(db)
    }
    @After fun after() { db.close() }
    private fun record(id: String = "event-a", pkg: String = "com.tencent.mm", amount: Long = 123) = PaymentRecognitionRecord(
        "rec-$id", account, PaymentRecognitionState.ENRICHMENT_VERIFIED.name, 1, pkg, "notification",
        "notification#event#$id", id, if (pkg == "com.tencent.mm") "wechat" else "alipay", amount, "CNY", "UNKNOWN", "", "", 1000, 1000)
    private fun remote(id: String = "event-a", amount: Long? = null, pkg: String = "com.tencent.mm", label: String = "微信") =
        PendingReviewIdentity("hint", "hint-$id", id, "synthetic-device", sourcePackage = pkg, appLabel = label, amountMinor = amount)
    private fun observation(vararg records: PendingReviewIdentity) = PaymentHintSync.Result(records.size, 0, 0, true,
        completeObservation = true, pendingCount = records.size, pendingEventIds = records.flatMap { it.eventIds + it.eventId }.toSet(),
        pendingRecords = records.toList(), accountId = account)
    private fun center(source: PaymentRecognitionStoreContract = store) = PaymentVerificationCenter(RuntimeEnvironment.getApplication(),
        hintedStore = source, hintedArchive = RoomNotificationStore(db), hintedQueuedRequests = { emptyList() })

    @Test fun exactLocalEvidenceIsVisibleAndConvergesWithoutPromotingServerMoney() {
        store.saveRecognition(record())
        val c = center()
        val pending = c.reconciledItems(account, observation(remote())).single()
        assertNull(pending.amountMinor)
        assertEquals(123L, pending.displayAmountMinor)
        assertTrue(pending.localEvidencePending)
        assertTrue(pending.needsVerification)
        assertEquals(PaymentVerificationCenter.SyncState.PENDING_SYNC, pending.syncState)
        val fresh = c.reconciledItems(account, observation(remote(amount = 123))).single()
        assertFalse(fresh.localEvidencePending)
        assertEquals(123L, fresh.displayAmountMinor)
    }

    @Test fun equalAmountsDifferentEventsSourcesAndAccountsCannotCrossMatch() {
        store.saveRecognition(record())
        val c = center()
        val rows = c.reconciledItems(account, observation(remote(), remote("event-b"), remote("event-clone")))
        assertEquals(3, rows.count { !it.recoveryOnly })
        assertEquals(listOf(123L, null, null), rows.map { it.displayAmountMinor })
        val otherSource = c.reconciledItems(account, observation(remote(pkg = "com.eg.android.AlipayGphone"))).first { !it.recoveryOnly }
        assertNull(otherSource.localAmountMinor)
        assertNull(otherSource.displayAmountMinor)
        assertTrue(c.reconciledItems(account, observation(remote()).copy(accountId = "another-account")).isEmpty())
    }

    @Test fun conflictsRemainVisibleAndDirectConfirmationIsBlocked() = runBlocking {
        store.saveRecognition(record())
        val c = center()
        val item = c.reconciledItems(account, observation(remote(amount = 999))).single()
        assertTrue(item.evidenceConflict)
        assertEquals(999L, item.amountMinor)
        assertEquals(123L, item.localAmountMinor)
        val state = PaymentVerificationState(RuntimeEnvironment.getApplication(), account, c)
        state.confirm(item)
        assertTrue(state.message.contains("不一致"))
        assertTrue(store.localBookings(account).isEmpty())
    }

    @Test fun trustedSourcePackageWinsOverContradictoryNativeLabel() {
        assertEquals("微信", center().reconciledItems(account, observation(remote(label = "支付宝"))).single().appLabel)
        assertEquals("支付宝", center().reconciledItems(account,
            observation(remote(pkg = "com.eg.android.AlipayGphone", label = "微信"))).single().appLabel)
    }

    @Test fun acknowledgedTerminalStateDoesNotReturnAsLocalRecovery() {
        store.saveRecognition(record())
        val observed = observation().copy(observedStates = mapOf("event-a" to "ignored"))
        assertTrue(center().reconciledItems(account, observed).isEmpty())
    }

    @Test fun slowLocalRefreshCannotOverwriteNewReconciliation() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val cache = CanonicalPendingCache(app, account)
        cache.save(PendingReviewSummary("old", 1, 1, 0, false, listOf(remote())))
        val entered = CompletableDeferred<Unit>(); val release = CountDownLatch(1); val armed = AtomicBoolean(true)
        val gated = object : PaymentRecognitionStoreContract by store {
            override fun recognitionsByState(accountId: String, states: List<String>, limit: Int): List<PaymentRecognitionRecord> {
                val result = store.recognitionsByState(accountId, states, limit)
                if (armed.compareAndSet(true, false)) { entered.complete(Unit); check(release.await(5, TimeUnit.SECONDS)) }
                return result
            }
        }
        val state = PaymentVerificationState(app, account, center(gated), reconcileOverride = { observation(remote(amount = 456)) })
        val old = async(start = CoroutineStart.UNDISPATCHED) { state.refresh() }
        try {
            withTimeout(3_000) { entered.await() }
            state.reconcile()
            assertEquals(456L, state.items.single().amountMinor)
        } finally { release.countDown() }
        old.await()
        assertEquals(456L, state.items.single().amountMinor)
    }

    @Test fun pausedRequestCannotPaintAfterResumeAndWaitingResumeGetsFreshPull() = runBlocking {
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>(); var calls = 0
        val state = PaymentVerificationState(RuntimeEnvironment.getApplication(), account, center(), reconcileOverride = {
            calls++
            if (calls == 1) { entered.complete(Unit); release.await(); observation(remote()) }
            else observation(remote(amount = 456))
        })
        val old = async(start = CoroutineStart.UNDISPATCHED) { state.reconcile() }
        entered.await()
        state.deactivate(); state.activate()
        val resumed = async(start = CoroutineStart.UNDISPATCHED) { state.reconcile() }
        release.complete(Unit); old.await(); resumed.await()
        assertEquals(2, calls)
        assertEquals(456L, state.items.single().amountMinor)
    }

    @Test fun wrongAccountResponseCannotPaintAndOfflineFailurePreservesLastEvidence() = runBlocking {
        var response: PaymentHintSync.Result? = observation(remote(amount = 123))
        val state = PaymentVerificationState(RuntimeEnvironment.getApplication(), account, center(), reconcileOverride = { response })
        state.reconcile()
        response = null; state.reconcile()
        assertFalse(state.canonicalCurrent)
        assertEquals(123L, state.items.single().amountMinor)
        response = observation(remote(amount = 999)).copy(accountId = "another-account"); state.reconcile()
        assertEquals(123L, state.items.single().amountMinor)
        response = observation(remote(amount = 456)); state.reconcile()
        assertTrue(state.canonicalCurrent)
        assertEquals(456L, state.items.single().amountMinor)
    }

    @Test fun stalePendingAfterTerminalDoesNotEmitAnEndlessSelfInvalidation() {
        val app = RuntimeEnvironment.getApplication()
        val cache = CanonicalPendingCache(app, account)
        cache.save(PendingReviewSummary("old", 1, 1, 0, false, listOf(remote())))
        cache.terminalize(setOf("event-a"), "ignored")
        val sync = PaymentHintSync(app, hintedStore = store,
            accountOverride = { uk.thewyj.app.task21.NotificationCaptureCoordinator.CaptureAccount(
                account, "synthetic-device", "synthetic-token", true) },
            hintedTransport = object : uk.thewyj.app.task21.NotificationIngestTransport {
                override fun post(path: String, sessionToken: String, body: String) = error("No writes expected")
                override fun get(path: String, sessionToken: String) = uk.thewyj.app.task21.IngestResponse(true, 200,
                    if (path.startsWith("/api/notification/pending-summary"))
                        """{"total_count":1,"hint_count":1,"candidate_count":0,"records":[{"kind":"hint","id":"hint-event-a","event_id":"event-a","source_package":"com.tencent.mm","state":"pending"}]}"""
                    else """{"hints":[],"candidates":[]}""")
            })
        val generation = PaymentReviewSignals.changes.value
        repeat(3) { assertEquals(0, sync.sync().pendingCount) }
        assertEquals(generation, PaymentReviewSignals.changes.value)
    }
}
