package uk.thewyj.app.task21.payment

import android.content.Context
import org.json.JSONObject
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.task21.HttpNotificationIngestTransport
import uk.thewyj.app.task21.NotificationCaptureCoordinator
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.NotificationArchiveSinkFactory
import uk.thewyj.app.task21.store.PaymentRecognitionStoreContract
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

/**
 * Task 24.1 P0-2/P0-3: pulls the shared pending-hint state and writes it back to
 * the local recognition/candidate rows.
 *
 * This is what makes Web /finance and Android agree: a hint confirmed (or
 * ignored) on the web page disappears from the app's 待核实 list on the next
 * sync, and a confirmed hint records the real finance entry id.
 */
class PaymentHintSync(
    context: Context,
    // Injectable for the Phase 1 cross-client test: Web confirm must reach the
    // Android archive through exactly this pull path.
    hintedTransport: uk.thewyj.app.task21.NotificationIngestTransport? = null,
    hintedStore: PaymentRecognitionStoreContract? = null,
    private val archiveSink: uk.thewyj.app.task21.NotificationArchiveSink? = null,
    private val accountOverride: (() -> uk.thewyj.app.task21.NotificationCaptureCoordinator.CaptureAccount?)? = null,
) {
    private val app = context.applicationContext
    private val sessions = NotificationSessionProvider(app)
    private val store: PaymentRecognitionStoreContract =
        hintedStore ?: RoomPaymentRecognitionStore(NotificationDatabase.get(app))
    private val transport = hintedTransport ?: HttpNotificationIngestTransport(BuildConfig.THEWYJ_BASE_URL)
    private val hook = AndroidPaymentRecognitionHook.get(app)

    data class Result(val refreshed: Int, val confirmed: Int, val ignored: Int, val ok: Boolean)

    /** Pulls every hint state for the current account. Safe to call often. */
    fun sync(): Result {
        val account = (accountOverride?.invoke()
            ?: runCatching { sessions.currentAccount() }.getOrNull()) ?: return Result(0, 0, 0, false)
        if (!account.financeEntitled) return Result(0, 0, 0, false)
        val response = runCatching {
            transport.get("/api/notification/hints?state=&limit=200", account.sessionToken)
        }.getOrNull() ?: return Result(0, 0, 0, false)
        if (!response.ok) return Result(0, 0, 0, false)
        val hints = runCatching {
            JSONObject(response.body).optJSONArray("hints")
        }.getOrNull() ?: return Result(0, 0, 0, true)

        var confirmed = 0
        var ignored = 0
        for (index in 0 until hints.length()) {
            val hint = hints.optJSONObject(index) ?: continue
            val eventId = hint.optString("source_event_id").orEmpty()
            if (eventId.isBlank()) continue
            when (hint.optString("state")) {
                "confirmed" -> {
                    val entryId = hint.optString("finance_entry_id").orEmpty()
                    applyConfirmed(account, eventId, entryId, hint)
                    confirmed += 1
                }
                "ignored" -> {
                    applyIgnored(account, eventId, hint)
                    ignored += 1
                }
                else -> Unit
            }
        }
        return Result(hints.length(), confirmed, ignored, true)
    }

    private fun applyConfirmed(
        account: NotificationCaptureCoordinator.CaptureAccount,
        eventId: String,
        financeEntryId: String,
        hint: JSONObject,
    ) {
        val accountId = account.accountId
        // The archive link is canonical and independent of the local recognition
        // row: a Web/Android confirm must close the notification-side state even
        // when this device never created a local candidate for that event.
        runCatching {
            (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                .markFinanceOutcome(accountId, eventId, "confirmed", financeEntryId)
        }
        val recognition = recognitionForHint(account, eventId, hint) ?: return
        val candidate = runCatching {
            store.candidateForRecognition(accountId, recognition.recognitionId)
        }.getOrNull()
        if (candidate != null && financeEntryId.isNotBlank()) {
            runCatching { hook.coordinator().markFinanceRecorded(accountId, candidate.candidateId, financeEntryId) }
            return
        }
        runCatching {
            store.saveRecognition(
                recognition.copy(
                    state = PaymentRecognitionState.FINANCE_RECORDED.name,
                    updatedAtMs = System.currentTimeMillis(),
                ),
            )
        }
        if (candidate != null) {
            runCatching {
                store.saveCandidate(candidate.copy(status = "confirmed", updatedAtMs = System.currentTimeMillis()))
            }
        }
    }

    private fun applyIgnored(
        account: NotificationCaptureCoordinator.CaptureAccount,
        eventId: String,
        hint: JSONObject,
    ) {
        val accountId = account.accountId
        runCatching {
            (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                .markFinanceOutcome(accountId, eventId, "ignored")
        }
        val recognition = recognitionForHint(account, eventId, hint) ?: return
        runCatching {
            store.saveRecognition(
                recognition.copy(
                    state = PaymentRecognitionState.IGNORED.name,
                    updatedAtMs = System.currentTimeMillis(),
                ),
            )
        }
        runCatching {
            store.candidateForRecognition(accountId, recognition.recognitionId)?.let { candidate ->
                store.saveCandidate(candidate.copy(status = "rejected", updatedAtMs = System.currentTimeMillis()))
            }
        }
    }

    /**
     * Local recognition row behind a server hint.
     *
     * Rows captured after Task 24.4 carry the hint event id in `uploadEventId`.
     * Rows captured earlier (real device evidence: ¥104.49 / 招商银行 on
     * 2026-09-12) kept `uploadEventId = ""`, so the pull has to reach them
     * through the archive identity of the same event id — otherwise a payment
     * confirmed on Web /finance stays pending in the Android list forever.
     */
    private fun recognitionForHint(
        account: NotificationCaptureCoordinator.CaptureAccount,
        eventId: String,
        hint: JSONObject,
    ): PaymentRecognitionRecord? {
        val accountId = account.accountId
        runCatching { store.recognitionByUploadEvent(accountId, eventId) }.getOrNull()?.let { return it }
        val sourceEventId = runCatching {
            (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                .recognitionSourceEventId(accountId, eventId)
        }.getOrNull().orEmpty()
        if (sourceEventId.isNotBlank()) {
            runCatching { store.recognitionBySourceEvent(accountId, sourceEventId) }.getOrNull()?.let { return it }
        }
        // Last resort for rows whose archive entry is gone and which never stored
        // the hint id: the same device, package and amount inside the hint's own
        // capture window. Never used when the hint came from another device, and
        // never used when more than one local row matches.
        val hintDevice = hint.optString("device_id").orEmpty()
        if (hintDevice.isBlank() || hintDevice != account.deviceId) return null
        val sourcePackage = hint.optString("source_package").orEmpty()
        val amountMinor = hint.optLong("amount_minor", 0L)
        val anchorMs = runCatching {
            java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US).apply {
                timeZone = java.util.TimeZone.getTimeZone("UTC")
            }.parse(hint.optString("created_at").orEmpty())?.time ?: 0L
        }.getOrDefault(0L)
        if (anchorMs <= 0L) return null
        return runCatching {
            store.legacyRecognitionForHint(accountId, sourcePackage, amountMinor, anchorMs)
        }.getOrNull()
    }
}
