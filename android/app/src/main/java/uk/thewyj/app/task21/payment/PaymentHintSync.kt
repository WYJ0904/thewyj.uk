package uk.thewyj.app.task21.payment

import android.content.Context
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.core.network.PendingReviewSummary
import uk.thewyj.app.core.network.PendingReviewIdentity
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

    data class Result(
        val refreshed: Int,
        val confirmed: Int,
        val ignored: Int,
        val ok: Boolean,
        val observedStates: Map<String, String> = emptyMap(),
        val completeObservation: Boolean = false,
        val pendingEventIds: Set<String> = emptySet(),
        val pendingCount: Int = 0,
        val pendingRecords: List<PendingReviewIdentity> = emptyList(),
    )
    private data class Observation(
        val states: Map<String, String> = emptyMap(),
        val complete: Boolean = false,
        val pendingEventIds: Set<String> = emptySet(),
        val pendingCount: Int = 0,
        val pendingRecords: List<PendingReviewIdentity> = emptyList(),
    )
    data class RemoteDismissResult(
        val ok: Boolean,
        val changed: Boolean = false,
        val message: String = "",
    )

    /** Apply the same account-scoped summary used by the Finance page. */
    fun applySummary(accountId: String, summary: PendingReviewSummary): Result {
        val account = (accountOverride?.invoke()
            ?: runCatching { sessions.currentAccount() }.getOrNull()) ?: return Result(0, 0, 0, false)
        if (!account.financeEntitled || account.accountId != accountId) return Result(0, 0, 0, false)
        val states = mutableMapOf<String, String>()
        val pendingIds = mutableSetOf<String>()
        var confirmed = 0
        var ignored = 0
        for (record in summary.records) {
            val ids = (record.eventIds + record.eventId).filter(String::isNotBlank).toSet()
            ids.forEach { states[it] = record.state }
            if (record.state == "pending") {
                pendingIds.addAll(ids)
                val match = recognitionForCandidate(account, ids)
                if (match != null && record.eventId.isNotBlank() && match.uploadEventId !in ids) {
                    store.saveRecognition(match.copy(uploadEventId = record.eventId))
                }
                continue
            }
            if (record.kind == "hint") {
                ids.forEach { eventId ->
                    if (record.state == "confirmed" && record.transactionId.isNotBlank()) {
                        applyConfirmed(account, eventId, record.transactionId, JSONObject())
                        confirmed += 1
                    } else if (record.state in setOf("ignored", "rejected", "superseded", "expired")) {
                        applyIgnored(account, eventId, JSONObject())
                        ignored += 1
                    }
                }
            } else if (record.kind == "candidate") {
                val match = recognitionForCandidate(account, ids) ?: continue
                if (record.state == "confirmed" && record.transactionId.isNotBlank()) {
                    applyCandidateConfirmed(account, match, ids, record.transactionId)
                    confirmed += 1
                } else if (record.state in setOf("ignored", "rejected", "superseded", "expired")) {
                    applyCandidateRejected(account, match, ids)
                    ignored += 1
                }
            }
        }
        return Result(
            refreshed = summary.records.size,
            confirmed = confirmed,
            ignored = ignored,
            ok = true,
            observedStates = states,
            completeObservation = !summary.truncated && summary.records.count { it.state == "pending" } == summary.totalCount,
            pendingEventIds = pendingIds,
            pendingCount = summary.totalCount,
            pendingRecords = summary.records.filter { it.state == "pending" },
        )
    }

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
        val archivedIds = runCatching {
            (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                .structuredEventIdsForRecognition(accountId, recognition.sourceEventId)
        }.getOrDefault(emptyList()).distinct()
        val eventId = if (archivedIds.size == 1) archivedIds.single() else recognition.uploadEventId.trim()
        if (eventId.isBlank()) return false
        if (eventId != recognition.uploadEventId) {
            // Exact archive linkage repairs legacy blank/stale upload ids before
            // this enrichment is published under the existing server identity.
            runCatching { store.saveRecognition(recognition.copy(uploadEventId = eventId)) }
        }
        val candidate = runCatching {
            store.candidateForRecognition(accountId, recognitionId)
        }.getOrNull() ?: return false
        val amountMinor = candidate.effectiveAmountMinor ?: recognition.amountMinor
        val direction = candidate.effectiveDirection
            .takeIf { it.isNotBlank() && it != "UNKNOWN" }
            ?: recognition.direction
        val hasAmount = amountMinor != null && amountMinor > 0L
        val hasDirection = direction.isNotBlank() && direction != "UNKNOWN"
        // Amount and direction are independently useful enrichment. In
        // particular, WeChat can expose a verified amount while leaving the
        // direction unknown. Publish that amount into the existing hint now;
        // the server will keep the review pending until both money fields are
        // complete, and will never create a second hint/event identity.
        if (!hasAmount && !hasDirection) return false

        val body = uk.thewyj.app.task21.StructuredEventJson.hintPayload(
            deviceId = account.deviceId,
            sourceEventId = eventId,
            sourceType = "accessibility",
            sourcePackage = recognition.sourcePackage,
            appLabel = PaymentAppLabels.resolve(app, recognition.sourcePackage),
            amountMinor = amountMinor?.takeIf { it > 0L },
            direction = direction.takeIf { hasDirection }.orEmpty(),
            merchant = candidate.effectiveMerchant.ifBlank { recognition.merchant },
            currency = recognition.currency.ifBlank { "CNY" },
            confidence = candidate.confidence.coerceIn(0, 1000),
            recognitionStatus = if (hasAmount && hasDirection) "CONFIRMED_PAYMENT" else "PAYMENT_LIKELY",
            reasons = listOf(if (hasAmount && hasDirection) "accessibility_verified_payment" else "accessibility_partial_enrichment"),
            parserVersion = "verified-on-device",
            providerReference = recognition.providerReference,
            paymentChannel = recognition.paymentChannel,
            occurredAtMs = recognition.createdAtMs,
        )
        val publishKey = "$accountId|$eventId"
        if (!PUBLISHING.add(publishKey)) return false
        try {
            val response = runCatching {
                transport.post("/api/notification/hints", account.sessionToken, body)
            }.getOrNull() ?: return false
            if (!response.ok) return false
            // The enrichment POST can synchronously auto-book this same hint.
            val booked = runCatching {
                JSONObject(response.body).optJSONArray("hints")?.optJSONObject(0)
            }.getOrNull()
            if (booked?.optString("state") == "confirmed" && booked.optString("finance_entry_id").isNotBlank()) {
                applyConfirmed(account, eventId, booked.optString("finance_entry_id"), booked)
            }
            return true
        } finally {
            PUBLISHING.remove(publishKey)
        }
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
        val records = when {
            summary.ok -> runCatching { JSONObject(summary.body).optJSONArray("records") }.getOrNull()
            summary.status == 404 -> legacyReviewRecords(account)
            else -> null
        } ?: return RemoteDismissResult(false, message = "读取云端待处理状态失败")
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

    /** Compatibility for the current Production API before pending-summary ships. */
    private fun legacyReviewRecords(account: NotificationCaptureCoordinator.CaptureAccount): JSONArray? {
        val records = JSONArray()
        val hints = runCatching {
            transport.get("/api/notification/hints?state=&limit=200", account.sessionToken)
        }.getOrNull() ?: return null
        if (!hints.ok) return null
        val hintRows = runCatching { JSONObject(hints.body).optJSONArray("hints") }.getOrNull() ?: return null
        if (hintRows.length() >= 200) return null
        for (index in 0 until hintRows.length()) {
            val hint = hintRows.optJSONObject(index) ?: continue
            records.put(JSONObject()
                .put("kind", "hint")
                .put("id", hint.optString("id"))
                .put("event_id", hint.optString("source_event_id"))
                .put("event_ids", JSONArray().put(hint.optString("source_event_id")))
                .put("state", hint.optString("state")))
        }
        for (status in listOf("pending", "confirmed", "rejected")) {
            val response = runCatching {
                transport.get("/api/notification/candidates?status=$status&limit=200", account.sessionToken)
            }.getOrNull() ?: return null
            if (!response.ok) return null
            val rows = runCatching { JSONObject(response.body).optJSONArray("candidates") }.getOrNull() ?: return null
            if (rows.length() >= 200) return null
            for (index in 0 until rows.length()) {
                val candidate = rows.optJSONObject(index) ?: continue
                val ids = linkedSetOf(candidate.optString("event_id"))
                val evidence = candidate.optJSONArray("evidence")
                if (evidence != null) for (evidenceIndex in 0 until evidence.length()) {
                    ids.add(evidence.optJSONObject(evidenceIndex)?.optString("event_id").orEmpty())
                }
                val aliases = JSONArray()
                ids.filter(String::isNotBlank).forEach { aliases.put(it) }
                records.put(JSONObject()
                    .put("kind", "candidate")
                    .put("id", candidate.optString("id"))
                    .put("event_id", candidate.optString("event_id"))
                    .put("event_ids", aliases)
                    .put("state", status))
            }
        }
        return records
    }

    /** Pulls every hint state for the current account. Safe to call often. */
    fun sync(): Result {
        val account = (accountOverride?.invoke()
            ?: runCatching { sessions.currentAccount() }.getOrNull()) ?: return Result(0, 0, 0, false)
        if (!account.financeEntitled) return Result(0, 0, 0, false)
        // Startup and later syncs retry locally saved enrichment even when the
        // verification screen was never opened. Limit each pull's POST work.
        runCatching {
            val verified = store.recognitionsByState(
                account.accountId,
                listOf(PaymentRecognitionState.ENRICHMENT_VERIFIED.name),
                200,
            )
            if (verified.isNotEmpty()) {
                val start = Math.floorMod(RETRY_CURSOR.getAndAdd(2), verified.size)
                repeat(minOf(2, verified.size)) { index ->
                    publishEnrichment(account.accountId, verified[(start + index) % verified.size].recognitionId)
                }
            }
        }
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
        val observation = reconcileExactReviewIdentities(account)
        return Result(
            hints.length(), confirmed, ignored, candidatesOk,
            observation.states, observation.complete, observation.pendingEventIds, observation.pendingCount,
            observation.pendingRecords,
        )
    }

    /** The exact server identity closes old local rows beyond the list endpoints' 200-row window. */
    private fun reconcileExactReviewIdentities(
        account: NotificationCaptureCoordinator.CaptureAccount,
        allowArchiveRepair: Boolean = true,
    ): Observation {
        val local = runCatching {
            store.recognitionsByState(account.accountId, PaymentVerificationCenter.ATTENTION_STATES, 200)
        }.getOrDefault(emptyList())
        val archive = archiveSink ?: NotificationArchiveSinkFactory.forContext(app)
        val allRequested = local.flatMap { recognition ->
            listOf(recognition.uploadEventId.trim()) +
                runCatching { archive.structuredEventIdsForRecognition(account.accountId, recognition.sourceEventId) }
                    .getOrDefault(emptyList())
        }.filter(String::isNotBlank).distinct()
        val query = allRequested.take(200).joinToString(",") {
            java.net.URLEncoder.encode(it, Charsets.UTF_8.name())
        }
        val response = runCatching {
            transport.get("/api/notification/pending-summary" + if (query.isBlank()) "" else "?event_ids=$query", account.sessionToken)
        }.getOrNull() ?: return Observation()
        if (!response.ok) return Observation()
        val payload = runCatching { JSONObject(response.body) }.getOrNull()
            ?: return Observation()
        val records = payload.optJSONArray("records") ?: return Observation()
        if (allowArchiveRepair && repairArchivedReviewAliases(account, records)) {
            return reconcileExactReviewIdentities(account, allowArchiveRepair = false)
        }
        val states = mutableMapOf<String, String>()
        val pendingIds = mutableSetOf<String>()
        val pendingRecords = mutableListOf<PendingReviewIdentity>()
        for (index in 0 until records.length()) {
            val row = records.optJSONObject(index) ?: continue
            val eventIds = buildSet {
                add(row.optString("event_id"))
                val aliases = row.optJSONArray("event_ids")
                if (aliases != null) for (aliasIndex in 0 until aliases.length()) add(aliases.optString(aliasIndex))
            }.filter(String::isNotBlank).toSet()
            val state = row.optString("state")
            eventIds.forEach { states[it] = state }
            if (state == "pending") {
                pendingIds.addAll(eventIds)
                PendingReviewIdentity.fromJson(row)?.let(pendingRecords::add)
                continue
            }
            when (row.optString("kind")) {
                "hint" -> eventIds.forEach { eventId ->
                    if (state == "confirmed" && row.optString("transaction_id").isNotBlank()) {
                        applyConfirmed(account, eventId, row.optString("transaction_id"), row)
                    } else if (state in setOf("ignored", "rejected", "superseded", "expired")) {
                        applyIgnored(account, eventId, row)
                    }
                }
                "candidate" -> {
                    val recognition = recognitionForCandidate(account, eventIds) ?: continue
                    if (state == "confirmed" && row.optString("transaction_id").isNotBlank()) {
                        applyCandidateConfirmed(account, recognition, eventIds, row.optString("transaction_id"))
                    } else if (state in setOf("ignored", "rejected", "superseded", "expired")) {
                        applyCandidateRejected(account, recognition, eventIds)
                    }
                }
            }
        }
        // Backfill only an exact archive alias that the server itself returned;
        // a blank/stale upload id is never repaired by amount or time proximity.
        local.forEach { recognition ->
            val aliases = runCatching { archive.structuredEventIdsForRecognition(account.accountId, recognition.sourceEventId) }
                .getOrDefault(emptyList()).filter(states::containsKey).distinct()
            if (aliases.size == 1 && recognition.uploadEventId !in states) {
                runCatching {
                    store.recognition(account.accountId, recognition.recognitionId)?.takeIf {
                        it.state in PaymentVerificationCenter.ATTENTION_STATES
                    }?.let { store.saveRecognition(it.copy(uploadEventId = aliases.single())) }
                }
            }
        }
        return Observation(
            states = states,
            complete = !payload.optBoolean("truncated", false) && allRequested.size <= 200 &&
                pendingRecords.size == payload.optInt("total_count", pendingIds.size),
            pendingEventIds = pendingIds,
            pendingCount = payload.optInt("total_count", pendingIds.size),
            pendingRecords = pendingRecords,
        )
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
            val sourceEventIds = runCatching {
                (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                    .recognitionSourceEventIds(accountId, eventId)
            }.getOrDefault(emptyList())
            for (sourceEventId in sourceEventIds) {
                runCatching { store.recognitionBySourceEvent(accountId, sourceEventId) }.getOrNull()?.let { return it }
            }
            // Prefer an exact archive recognition. An upload id remains the
            // fallback when that archive has no local recognition to conflict.
            runCatching { store.recognitionByUploadEvent(accountId, eventId) }.getOrNull()?.let { return it }
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
                store.saveCandidate(candidate.copy(
                    status = "rejected",
                    financeTransactionId = "",
                    updatedAtMs = System.currentTimeMillis(),
                ))
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
                store.saveCandidate(candidate.copy(
                    status = "rejected",
                    financeTransactionId = "",
                    updatedAtMs = System.currentTimeMillis(),
                ))
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
        val sourceEventIds = runCatching {
            (archiveSink ?: NotificationArchiveSinkFactory.forContext(app))
                .recognitionSourceEventIds(accountId, eventId)
        }.getOrDefault(emptyList())
        for (sourceEventId in sourceEventIds) {
            runCatching { store.recognitionBySourceEvent(accountId, sourceEventId) }.getOrNull()?.let { return it }
        }
        runCatching { store.recognitionByUploadEvent(accountId, eventId) }.getOrNull()?.let { return it }
        return null
    }

    /** Reconcile only split reviews proved to share one archived notification instance. */
    private fun repairArchivedReviewAliases(
        account: NotificationCaptureCoordinator.CaptureAccount,
        records: JSONArray,
    ): Boolean {
        if (!REPAIRING.add(account.accountId)) return false
        try {
            val archive = archiveSink ?: NotificationArchiveSinkFactory.forContext(app)
            val rows = (0 until records.length()).mapNotNull { records.optJSONObject(it) }
                .filter { it.optString("kind") == "hint" && it.optString("state") == "pending" }
            val grouped = rows.groupBy { row ->
                runCatching { archive.archivedLifecycleIdentity(account.accountId, row.optString("event_id")) }
                    .getOrDefault("")
            }.filterKeys(String::isNotBlank).values.filter { it.size > 1 }
            var posted = 0
            for (group in grouped.take(4)) {
                val amounts = group.map { it.optLong("amount_minor") }.filter { it > 0L }.distinct()
                val directions = group.map { it.optString("direction") }
                    .filter { it in setOf("income", "expense", "refund") }.distinct()
                val references = group.mapNotNull { row ->
                    runCatching { store.recognitionByUploadEvent(account.accountId, row.optString("event_id"))
                        ?.providerReference?.takeIf(String::isNotBlank) }.getOrNull()
                }.distinct()
                val times = group.map { it.optLong("occurred_at_ms") }
                if (amounts.size != 1 || group.none { it.optLong("amount_minor") <= 0L } ||
                    directions.size > 1 || references.size > 1 ||
                    group.map { it.optString("source_package") }.distinct().size != 1 ||
                    times.any { it <= 0L } ||
                    (times.maxOrNull()!! - times.minOrNull()!!) > ARCHIVE_CONTINUITY_MS) continue
                val lifecycleIdentity = archive.archivedLifecycleIdentity(account.accountId,
                    group.first().optString("event_id"))
                for (row in group.sortedBy { it.optLong("occurred_at_ms") }) {
                    if (posted >= MAX_ARCHIVE_REPAIR_POSTS) return posted > 0
                    val packageName = row.optString("source_package")
                    val channel = when (packageName) {
                        "com.tencent.mm" -> "wechat"
                        "com.eg.android.AlipayGphone" -> "alipay"
                        else -> "bank_card"
                    }
                    val amount = row.optLong("amount_minor").takeIf { it > 0L }
                    val direction = row.optString("direction")
                    val body = uk.thewyj.app.task21.StructuredEventJson.hintPayload(
                        deviceId = account.deviceId, sourceEventId = row.optString("event_id"),
                        sourceType = "notification", sourcePackage = packageName,
                        appLabel = row.optString("app_label"), amountMinor = amount,
                        direction = direction, merchant = row.optString("merchant"), currency = "CNY",
                        confidence = row.optInt("confidence"),
                        recognitionStatus = if (amount != null && direction in setOf("income", "expense", "refund"))
                            "CONFIRMED_PAYMENT" else "PAYMENT_LIKELY",
                        reasons = listOf("archive_lifecycle_reconciliation"), parserVersion = "archive-link-v1",
                        paymentChannel = channel, lifecycleIdentity = lifecycleIdentity,
                        providerReference = references.singleOrNull().orEmpty(),
                        occurredAtMs = row.optLong("occurred_at_ms"),
                    )
                    val response = runCatching { transport.post("/api/notification/hints", account.sessionToken, body) }
                        .getOrNull()
                    if (response?.ok == true) posted += 1
                }
            }
            return posted > 0
        } finally {
            REPAIRING.remove(account.accountId)
        }
    }

    companion object {
        private val PUBLISHING = ConcurrentHashMap.newKeySet<String>()
        private val REPAIRING = ConcurrentHashMap.newKeySet<String>()
        private val RETRY_CURSOR = AtomicInteger(0)
        private const val ARCHIVE_CONTINUITY_MS = 15_000L
        private const val MAX_ARCHIVE_REPAIR_POSTS = 20
    }
}
