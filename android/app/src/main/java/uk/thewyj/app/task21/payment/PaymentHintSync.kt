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
    data class RemoteDismissResult(
        val ok: Boolean,
        val changed: Boolean = false,
        val message: String = "",
    )

    /**
     * Pushes the fields learned by an explicit Accessibility/OCR ticket back to
     * the already-existing server hint. The server keeps the same event/hint id
     * and only fills fields that were previously missing.
     */
    fun publishEnrichment(accountId: String, recognitionId: String): Boolean {
        val account = (accountOverride?.invoke()
            ?: runCatching { sessions.currentAccount() }.getOrNull()) ?: return false
        if (!account.financeEntitled || account.accountId != accountId) return false
        val recognition = runCatching { store.recognition(accountId, recognitionId) }.getOrNull() ?: return false
        val eventId = recognition.uploadEventId.trim()
        if (eventId.isBlank()) return false
        val candidate = runCatching {
            store.candidateForRecognition(accountId, recognitionId)
        }.getOrNull() ?: return false
        val amountMinor = candidate.effectiveAmountMinor ?: recognition.amountMinor ?: return false
        val direction = candidate.effectiveDirection.ifBlank { recognition.direction }
        if (amountMinor <= 0L || direction.isBlank() || direction == "UNKNOWN") return false

        val body = uk.thewyj.app.task21.StructuredEventJson.hintPayload(
            deviceId = account.deviceId,
            sourceEventId = eventId,
            sourceType = "accessibility",
            sourcePackage = recognition.sourcePackage,
            appLabel = PaymentAppLabels.resolve(app, recognition.sourcePackage),
            amountMinor = amountMinor,
            direction = direction,
            merchant = candidate.effectiveMerchant.ifBlank { recognition.merchant },
            currency = recognition.currency.ifBlank { "CNY" },
            confidence = candidate.confidence.coerceIn(0, 1000),
            recognitionStatus = "CONFIRMED_PAYMENT",
            reasons = listOf("accessibility_verified_amount"),
            parserVersion = "verified-on-device",
        )
        return runCatching {
            transport.post("/api/notification/hints", account.sessionToken, body).ok
        }.getOrDefault(false)
    }

    /**
     * Explicit user dismissal is terminal on both clients. Resolve the canonical
     * server review identity by stable event id, then ignore a hint or reject a
     * candidate before changing local Room state.
     */
    fun dismissRemote(accountId: String, eventId: String): RemoteDismissResult {
        if (eventId.isBlank()) return RemoteDismissResult(ok = true)
        val account = (accountOverride?.invoke()
            ?: runCatching { sessions.currentAccount() }.getOrNull())
            ?: return RemoteDismissResult(false, message = "当前没有可用的登录会话")
        if (!account.financeEntitled || account.accountId != accountId) {
            return RemoteDismissResult(false, message = "当前账户无法同步待处理状态")
        }
        val encoded = java.net.URLEncoder.encode(eventId, Charsets.UTF_8.name())
        val summary = runCatching {
            transport.get("/api/notification/pending-summary?event_ids=$encoded", account.sessionToken)
        }.getOrNull() ?: return RemoteDismissResult(false, message = "读取云端待处理状态失败")
        if (!summary.ok) return RemoteDismissResult(false, message = "读取云端待处理状态失败")

        val records = runCatching { JSONObject(summary.body).optJSONArray("records") }.getOrNull()
            ?: return RemoteDismissResult(true)
        var matchedId = ""
        var matchedKind = ""
        for (index in 0 until records.length()) {
            val row = records.optJSONObject(index) ?: continue
            val ids = buildSet {
                add(row.optString("event_id"))
                val aliases = row.optJSONArray("event_ids")
                if (aliases != null) for (aliasIndex in 0 until aliases.length()) add(aliases.optString(aliasIndex))
            }
            if (eventId !in ids) continue
            when (row.optString("state")) {
                "confirmed" -> return RemoteDismissResult(
                    false,
                    message = "这笔交易已在财务账本中确认，不能再从待处理中忽略",
                )
                "pending" -> {
                    matchedId = row.optString("id")
                    matchedKind = row.optString("kind")
                }
                else -> return RemoteDismissResult(ok = true)
            }
            break
        }
        if (matchedId.isBlank()) return RemoteDismissResult(ok = true)

        val path: String
        val body: String
        when (matchedKind) {
            "hint" -> {
                path = "/api/notification/hints/ignore"
                body = JSONObject().put("hint_id", matchedId).toString()
            }
            "candidate" -> {
                path = "/api/notification/candidates/reject"
                body = JSONObject().put("candidate_id", matchedId).toString()
            }
            else -> return RemoteDismissResult(false, message = "云端待处理类型无法识别")
        }
        val response = runCatching { transport.post(path, account.sessionToken, body) }.getOrNull()
            ?: return RemoteDismissResult(false, message = "云端忽略请求失败")
        if (!response.ok) {
            val code = runCatching { JSONObject(response.body).optString("code") }.getOrDefault("")
            return RemoteDismissResult(
                false,
                message = if (code.isBlank()) "云端忽略请求失败" else "云端忽略请求失败（$code）",
            )
        }
        return RemoteDismissResult(ok = true, changed = true)
    }

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
        val candidatesOk = syncCandidateTerminals(account)
        return Result(hints.length(), confirmed, ignored, candidatesOk)
    }

    /**
     * Older Production builds already expose candidate status endpoints even
     * though they do not have /pending-summary yet. Pull terminal candidate
     * states too, otherwise a Web-side confirm/reject leaves the Android local
     * recognition stuck in FINANCE_PENDING_CONFIRMATION forever.
     */
    private fun syncCandidateTerminals(
        account: NotificationCaptureCoordinator.CaptureAccount,
    ): Boolean {
        for (status in listOf("confirmed", "rejected")) {
            val response = runCatching {
                transport.get("/api/notification/candidates?status=$status&limit=200", account.sessionToken)
            }.getOrNull() ?: return false
            if (!response.ok) return false
            val candidates = runCatching {
                JSONObject(response.body).optJSONArray("candidates")
            }.getOrNull() ?: continue
            for (index in 0 until candidates.length()) {
                val remote = candidates.optJSONObject(index) ?: continue
                val eventIds = buildSet {
                    add(remote.optString("event_id"))
                    val evidence = remote.optJSONArray("evidence")
                    if (evidence != null) {
                        for (evidenceIndex in 0 until evidence.length()) {
                            add(evidence.optJSONObject(evidenceIndex)?.optString("event_id").orEmpty())
                        }
                    }
                }.filter(String::isNotBlank).toSet()
                if (eventIds.isEmpty()) continue
                val recognition = recognitionForCandidate(account, eventIds) ?: continue
                when (status) {
                    "confirmed" -> applyCandidateConfirmed(
                        account = account,
                        recognition = recognition,
                        eventIds = eventIds,
                        financeEntryId = remote.optString("finance_transaction_id"),
                    )
                    "rejected" -> applyCandidateRejected(
                        account = account,
                        recognition = recognition,
                        eventIds = eventIds,
                    )
                }
            }
        }
        return true
    }

    private fun recognitionForCandidate(
        account: NotificationCaptureCoordinator.CaptureAccount,
        eventIds: Set<String>,
    ): PaymentRecognitionRecord? {
        val accountId = account.accountId
        for (eventId in eventIds) {
            runCatching { store.recognitionByUploadEvent(accountId, eventId) }.getOrNull()?.let { return it }
            val sourceEventId = runCatching {
                (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                    .recognitionSourceEventId(accountId, eventId)
            }.getOrNull().orEmpty()
            if (sourceEventId.isNotBlank()) {
                runCatching { store.recognitionBySourceEvent(accountId, sourceEventId) }.getOrNull()?.let { return it }
            }
        }
        return null
    }

    private fun applyCandidateConfirmed(
        account: NotificationCaptureCoordinator.CaptureAccount,
        recognition: PaymentRecognitionRecord,
        eventIds: Set<String>,
        financeEntryId: String,
    ) {
        val accountId = account.accountId
        eventIds.forEach { eventId ->
            runCatching {
                (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                    .markFinanceOutcome(accountId, eventId, "confirmed", financeEntryId)
            }
        }
        val candidate = runCatching {
            store.candidateForRecognition(accountId, recognition.recognitionId)
        }.getOrNull()
        if (candidate != null && financeEntryId.isNotBlank()) {
            // Keep the production notifier/status-machine side effect, but never
            // rely on the process-global hook for persistence: tests and callers
            // may inject a different store, and that store is the sync contract.
            runCatching {
                hook.coordinator().markFinanceRecorded(accountId, candidate.candidateId, financeEntryId)
            }
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
                store.saveCandidate(
                    candidate.copy(
                        status = "confirmed",
                        financeTransactionId = financeEntryId.ifBlank { candidate.financeTransactionId },
                        updatedAtMs = System.currentTimeMillis(),
                    ),
                )
            }
        }
    }

    private fun applyCandidateRejected(
        account: NotificationCaptureCoordinator.CaptureAccount,
        recognition: PaymentRecognitionRecord,
        eventIds: Set<String>,
    ) {
        val accountId = account.accountId
        eventIds.forEach { eventId ->
            runCatching {
                (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                    .markFinanceOutcome(accountId, eventId, "ignored")
            }
        }
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
                store.saveCandidate(
                    candidate.copy(
                        status = "confirmed",
                        financeTransactionId = financeEntryId.ifBlank { candidate.financeTransactionId },
                        updatedAtMs = System.currentTimeMillis(),
                    ),
                )
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
