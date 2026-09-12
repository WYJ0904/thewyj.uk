package uk.thewyj.app.task21.payment

import android.content.Context
import org.json.JSONObject
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.task21.HttpNotificationIngestTransport
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
                    applyConfirmed(account.accountId, eventId, entryId)
                    confirmed += 1
                }
                "ignored" -> {
                    applyIgnored(account.accountId, eventId)
                    ignored += 1
                }
                else -> Unit
            }
        }
        return Result(hints.length(), confirmed, ignored, true)
    }

    private fun applyConfirmed(accountId: String, eventId: String, financeEntryId: String) {
        // The archive link is canonical and independent of the local recognition
        // row: a Web/Android confirm must close the notification-side state even
        // when this device never created a local candidate for that event.
        runCatching {
            (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                .markFinanceOutcome(accountId, eventId, "confirmed", financeEntryId)
        }
        val recognition = runCatching { store.recognitionByUploadEvent(accountId, eventId) }.getOrNull() ?: return
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

    private fun applyIgnored(accountId: String, eventId: String) {
        runCatching {
            (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                .markFinanceOutcome(accountId, eventId, "ignored")
        }
        val recognition = runCatching { store.recognitionByUploadEvent(accountId, eventId) }.getOrNull() ?: return
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
}
