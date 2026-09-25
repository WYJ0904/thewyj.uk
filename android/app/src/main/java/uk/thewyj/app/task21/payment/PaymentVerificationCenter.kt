package uk.thewyj.app.task21.payment

import android.content.Context
import kotlinx.coroutines.runBlocking
import uk.thewyj.app.core.auth.SecureCredentialStore
import uk.thewyj.app.core.network.ApiCall
import uk.thewyj.app.core.network.ThewyjApiClient
import uk.thewyj.app.task21.FinanceDirection
import uk.thewyj.app.task21.NotificationCapturePipeline
import uk.thewyj.app.task21.NotificationEventType
import uk.thewyj.app.task21.NotificationFingerprint
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.ParseStatus
import uk.thewyj.app.task21.StructuredEventJson
import uk.thewyj.app.task21.StructuredNotificationEvent
import uk.thewyj.app.task21.QueuedNotificationRequest
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.PaymentRecognitionStoreContract
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import uk.thewyj.app.task21.store.RoomNotificationStore

/**
 * Everything the in-app "待核实 / 待确认交易" surface needs, shared by the
 * notification action and the Compose screen.
 *
 * Booking rules (single ledger, no second bookkeeping system):
 *  - A recognition whose structured event was uploaded (amount known at capture)
 *    is confirmed on the Finance page through the existing Task 16/17 candidate
 *    API. This screen only deep links to it.
 *  - A local-only recognition (amount unknown at capture, then verified by the
 *    90 second Accessibility ticket or typed by the user) is booked by this
 *    device: the structured event is uploaded once, under a deterministic event
 *    id, and the server creates the canonical transaction.
 */
class PaymentVerificationCenter(
    context: Context,
    hintedStore: PaymentRecognitionStoreContract? = null,
    hintedArchive: RoomNotificationStore? = null,
    private val hintedQueuedRequests: (() -> List<QueuedNotificationRequest>)? = null,
    hintedHintSync: PaymentHintSync? = null,
) {
    private val app = context.applicationContext
    private val sessions = NotificationSessionProvider(app)
    private val pipeline = NotificationCapturePipeline.create(app, sessions)
    private val store: PaymentRecognitionStoreContract =
        hintedStore ?: RoomPaymentRecognitionStore(NotificationDatabase.get(app))
    private val hook = AndroidPaymentRecognitionHook.get(app)
    private val tickets = PaymentTicketEngine()
    private val hintSync = hintedHintSync ?: PaymentHintSync(app)
    private val api = ThewyjApiClient()
    private val archive by lazy { hintedArchive ?: RoomNotificationStore(NotificationDatabase.get(app)) }

    data class Item(
        val recognitionId: String,
        val candidateId: String,
        val sourcePackage: String,
        val appLabel: String,
        val state: String,
        val amountMinor: Long?,
        val direction: FinanceDirection,
        val merchant: String,
        val hasEdits: Boolean,
        val ocrSuggested: Boolean,
        val uploaded: Boolean,
        val ticketActive: Boolean,
        val remainingMs: Long,
        val occurredAtMs: Long,
        val financeTransactionId: String,
        val syncState: SyncState,
        val authority: Authority,
        val notice: String,
        /** Local queued recovery, displayed separately from canonical pending. */
        val recoveryOnly: Boolean = false,
    ) {
        val needsAmount: Boolean get() = amountMinor == null || amountMinor <= 0
        val needsVerification: Boolean get() = needsAmount || direction == FinanceDirection.UNKNOWN
        /** This device may create the canonical transaction for the item. */
        val deviceBooks: Boolean get() = authority == Authority.DEVICE
    }

    enum class SyncState { NONE, LOCAL_ONLY, PENDING_SYNC, SYNCED, SYNC_FAILED, SYNC_REJECTED, UNRESOLVED_REMOTE }

    /**
     * Which side owns the booking. A recognition that captured an amount was
     * uploaded and becomes a server candidate (the Finance page confirms it).
     * An amount-unknown hint that this device later verifies remains device
     * owned even though it already has an upload event id: confirmAndBook uses
     * that same id, so the server creates one transaction and atomically closes
     * the pending hint instead of asking the user to type the amount again.
     */
    enum class Authority { NEEDS_AMOUNT, DEVICE, SERVER }

    data class BookResult(
        val ok: Boolean,
        val message: String,
        val transactionId: String = "",
        val syncState: SyncState = SyncState.NONE,
    )

    data class IgnoreResult(
        val ok: Boolean,
        val message: String,
    )

    data class FlushOutcome(val uploaded: Int, val rejected: List<String>)

    /** Creates a fresh 90 second ticket for a recognition the user asked for. */
    fun startVerification(recognitionId: String): PaymentTicket? {
        val account = sessions.currentAccount() ?: return null
        if (!account.financeEntitled) return null
        return runCatching { hook.coordinator().restartVerification(account.accountId, recognitionId) }.getOrNull()
    }

    /** Finance deep link: only an exact pending server event may reopen a ticket. */
    fun startVerificationForEvent(eventId: String): PaymentTicket? {
        val account = sessions.currentAccount() ?: return null
        if (!account.financeEntitled || eventId.isBlank()) return null
        val credentials = SecureCredentialStore(app).loadActive() ?: return null
        val summary = runBlocking { api.pendingReviewSummary(credentials.accessToken, listOf(eventId)) }
        if (summary !is ApiCall.Success) return null
        val pending = summary.value.records.firstOrNull {
            it.state == "pending" && eventId in (it.eventIds + it.eventId)
        } ?: return null
        val archive = RoomNotificationStore(NotificationDatabase.get(app))
        val recognition = (pending.eventIds + pending.eventId).firstNotNullOfOrNull { id ->
            val sourceIds = archive.recognitionSourceEventIds(account.accountId, id)
            sourceIds.firstNotNullOfOrNull { store.recognitionBySourceEvent(account.accountId, it) }
                ?: store.recognitionByUploadEvent(account.accountId, id)
        } ?: return null
        if (recognition.state !in ATTENTION_STATES) return null
        return startVerification(recognition.recognitionId)
    }

    fun account() = runCatching { sessions.currentAccount() }.getOrNull()

    /** The first paint reads only Room, tickets and the local upload queue. */
    fun localItems(accountId: String): List<Item> = buildItems(accountId, null, includeAllLocal = true)

    /** Called only from a background IO coroutine after the first local paint. */
    suspend fun reconcile(accountId: String): PaymentHintSync.Result? {
        // Retry enrichment and pull terminal state after the local first paint.
        val pulled = runCatching { hintSync.sync() }.getOrNull()
        val credentials = runCatching { SecureCredentialStore(app).loadActive() }.getOrNull()
        val localBefore = store.recognitionsByState(accountId, ATTENTION_STATES, 200)
        val requested = localBefore.flatMap { recognition ->
            listOf(recognition.uploadEventId) + archive.structuredEventIdsForRecognition(accountId, recognition.sourceEventId)
        }.filter(String::isNotBlank).distinct()
        val summary = if (credentials != null && credentials.accessToken.isNotBlank()) {
            api.pendingReviewSummary(credentials.accessToken, requested)
        } else null
        return when (summary) {
            is ApiCall.Success -> hintSync.applySummary(accountId, summary.value)
            else -> pulled
        }
    }

    /** Re-read Room after cloud terminal outcomes have been persisted. */
    fun reconciledItems(accountId: String, observation: PaymentHintSync.Result?): List<Item> =
        buildItems(accountId, observation, includeAllLocal = observation?.completeObservation != true)

    private fun buildItems(
        accountId: String,
        observation: PaymentHintSync.Result?,
        includeAllLocal: Boolean,
    ): List<Item> {
        val queued = hintedQueuedRequests?.invoke() ?: pipeline.queuedRequests()
        val queue = queued.map { it.operationId }.toSet()
        val rejections = queued.filter { it.lastError.isNotBlank() }.associate { it.operationId to it.lastError }
        val visible = store.recognitionsByState(accountId, ATTENTION_STATES, 200)
            .distinctBy(::reviewIdentity)
            .mapNotNull { recognition ->
                val identities = listOf(recognition.uploadEventId) +
                    archive.structuredEventIdsForRecognition(accountId, recognition.sourceEventId)
                if (includeAllLocal) {
                    recognition to true
                } else when (PendingReviewVisibility.classify(
                    identities.filter(String::isNotBlank).toSet(),
                    bookingEventId(recognition),
                    observation?.takeIf { it.completeObservation }?.pendingEventIds,
                    queue,
                )) {
                    PendingReviewVisibility.Placement.CANONICAL -> recognition to false
                    PendingReviewVisibility.Placement.RECOVERY -> recognition to true
                    PendingReviewVisibility.Placement.HIDDEN -> null
                }
            }.sortedBy { it.second }
        return visible.map { (recognition, recoveryOnly) ->
            val candidate = store.candidateForRecognition(accountId, recognition.recognitionId)
            val ticket = store.ticketsForRecognition(accountId, recognition.recognitionId)
                .maxByOrNull { it.createdAtMs }
            val active = ticket != null && tickets.isActive(ticket)
            val uploaded = recognition.uploadEventId.isNotBlank()
            val transactionId = candidate?.financeTransactionId.orEmpty()
            val bookingId = bookingEventId(recognition)
            val bookingAttempted = recognition.uploadEventId == bookingId
            val eventIds = listOf(recognition.uploadEventId) +
                archive.structuredEventIdsForRecognition(accountId, recognition.sourceEventId)
            val queuedId = (eventIds + bookingId).firstOrNull { it in queue || "hint:$it" in queue }.orEmpty()
            val queuedOperation = if (queuedId in queue) queuedId else "hint:$queuedId"
            Item(
                recognitionId = recognition.recognitionId,
                candidateId = candidate?.candidateId.orEmpty(),
                sourcePackage = recognition.sourcePackage,
                appLabel = appLabelOf(recognition.sourcePackage),
                state = recognition.state,
                amountMinor = candidate?.effectiveAmountMinor ?: recognition.amountMinor,
                direction = directionOf(candidate?.effectiveDirection ?: recognition.direction),
                merchant = candidate?.effectiveMerchant.orEmpty().ifBlank { recognition.merchant },
                hasEdits = candidate?.hasEdits == true,
                ocrSuggested = candidate?.let(::requiresManualOcrReview) == true,
                uploaded = uploaded,
                ticketActive = active,
                remainingMs = if (active) (ticket!!.expiresAtMs - System.currentTimeMillis()).coerceAtLeast(0) else 0,
                occurredAtMs = candidate?.effectiveOccurredAtMs ?: recognition.createdAtMs,
                financeTransactionId = transactionId,
                syncState = paymentSyncStateFor(
                    recognition.uploadEventId,
                    transactionId,
                    rejections.containsKey(queuedOperation),
                    queuedOperation in queue,
                    bookingAttempted,
                    observation,
                ),
                authority = authorityOf(recognition),
                notice = rejections[queuedOperation].orEmpty(),
                recoveryOnly = recoveryOnly,
            )
        }
    }

    /**
     * Where an already uploaded candidate is confirmed: the Finance page, which
     * owns the Task 16/17 candidate API. The event id lets the page focus the
     * exact candidate instead of dropping the user on an unfiltered list.
     */
    fun financeCandidateRoute(recognition: PaymentRecognitionRecord): String =
        "/finance?notification_event=" + recognition.uploadEventId.ifBlank { recognition.sourceEventId }

    /**
     * Saves the user's correction. Machine evidence (`amountMinor`, `direction`,
     * `merchant`) is never overwritten; only the `edited*` fields change.
     */
    fun saveCorrection(
        accountId: String,
        candidateId: String,
        recognitionId: String = "",
        amountMinor: Long?,
        direction: String,
        merchant: String,
    ): Boolean {
        return runCatching {
            if (candidateId.isNotBlank()) {
                hook.coordinator().editCandidate(
                    accountId = accountId,
                    candidateId = candidateId,
                    amountMinor = amountMinor,
                    direction = direction,
                    merchant = merchant,
                )
            } else if (recognitionId.isNotBlank()) {
                // Amount-unknown captures have no candidate yet; the user's
                // manual amount is what creates it (P0: the flow used to answer
                // 「修改没有保存，请重试」because there was nothing to edit).
                hook.coordinator().ensureCandidateForRecognition(
                    accountId = accountId,
                    recognitionId = recognitionId,
                    amountMinor = amountMinor,
                    direction = direction,
                    merchant = merchant,
                )
            } else {
                null
            }
        }.getOrNull() != null
    }

    /**
     * Confirms the candidate and books it into the real Task 16/17 ledger.
     *
     * The booking payload is derived from the user's values, is idempotent per
     * recognition (stable event id) and is only ever sent once; a queue failure
     * leaves the payload queued and reports PENDING_SYNC instead of pretending
     * the transaction exists.
     */
    fun confirmAndBook(accountId: String, recognitionId: String): BookResult {
        val recognition = store.recognition(accountId, recognitionId)
            ?: return BookResult(false, "找不到这笔交易记录")
        if (authorityOf(recognition) == Authority.SERVER) {
            // Captured with an amount, so the server already owns the candidate.
            // Booking again here would create a second transaction for one
            // payment.
            return BookResult(false, "这笔交易请在财务页确认，thewyj 不会重复记账")
        }
        var candidate = store.candidateForRecognition(accountId, recognitionId)
        if (candidate == null) {
            return BookResult(false, "这笔交易还没有可确认的金额")
        }
        if (requiresManualOcrReview(candidate)) {
            return BookResult(false, "OCR 金额尚未经人工核对，请先打开编辑器确认实际金额")
        }
        if (recognition.uploadEventId.isNotBlank()) {
            val observation = runCatching { hintSync.sync() }.getOrNull()
            if (observation?.completeObservation == true &&
                observation.observedStates[recognition.uploadEventId] != "pending"
            ) {
                return BookResult(false, "云端待处理状态已变化，已保留本机记录；请先核对，不能重复记账")
            }
        }
        val draft = runCatching {
            hook.coordinator().confirmCandidate(accountId, candidate.candidateId)
        }.getOrNull() ?: return BookResult(false, "确认失败，请重试")
        candidate = store.candidateForRecognition(accountId, recognitionId) ?: candidate
        if (draft.amountMinor <= 0) return BookResult(false, "请先填写金额")
        if (draft.direction.isBlank() || draft.direction == FinanceDirection.UNKNOWN.name) {
            return BookResult(false, "请先选择收入或支出")
        }

        val eventId = recognition.uploadEventId.ifBlank { bookingEventId(recognition) }
        val direction = runCatching { FinanceDirection.valueOf(draft.direction) }
            .getOrDefault(FinanceDirection.EXPENSE)
        val event = StructuredNotificationEvent(
            eventId = eventId,
            // Content fingerprint of the verified values, not of the raw
            // notification: this event carries the user-confirmed booking and is
            // identified by the stable event id.
            fingerprint = runCatching {
                NotificationFingerprint.fingerprint(
                    recognition.sourcePackage,
                    eventId,
                    draft.direction,
                    draft.amountMinor.toString(),
                    draft.merchant,
                )
            }
                .getOrDefault(eventId),
            sourcePackage = recognition.sourcePackage,
            eventType = if (direction == FinanceDirection.REFUND) NotificationEventType.REFUND else NotificationEventType.TRANSACTION,
            parserVersion = "verified-on-device",
            parseStatus = ParseStatus.PARSED,
            direction = direction,
            amountMinor = draft.amountMinor,
            currency = "CNY",
            paymentChannel = recognition.paymentChannel,
            merchant = draft.merchant,
            counterparty = draft.merchant,
            // The user explicitly confirmed the amount, so this is a real
            // booking rather than a guess; the raw evidence rows still record
            // what the machine originally saw.
            confidence = 950,
            occurredAtMs = draft.occurredAtMs,
            receivedAtMs = draft.occurredAtMs,
        )
        val enqueued = runCatching {
            pipeline.enqueue(eventId, StructuredEventJson.ingestPayload("1", accountDeviceId(), eventId, event))
        }.isSuccess
        if (!enqueued) return BookResult(false, "记账请求保存失败，请重试")

        if (recognition.uploadEventId.isBlank()) {
            // Remember the identity this local payment was booked under so a
            // second confirm can never create a second transaction.
            runCatching {
                store.saveRecognition(recognition.copy(uploadEventId = eventId, updatedAtMs = System.currentTimeMillis()))
            }
        }

        val flush = runCatching { pipeline.flushDetailed() }.getOrNull()
        val outcome = flush?.outcomes?.firstOrNull { it.operationId == eventId }
        if (outcome?.transactionId?.isNotBlank() == true) {
            runCatching {
                hook.coordinator().markFinanceRecorded(accountId, candidate.candidateId, outcome.transactionId)
            }
            return BookResult(true, "已记录到财务", outcome.transactionId, SyncState.SYNCED)
        }
        // The server refused the payload: report the real reason instead of an
        // endless "waiting to sync" that never completes.
        val rejection = flush?.rejected?.firstOrNull { it.operationId == eventId }
        if (rejection != null) {
            return BookResult(
                ok = false,
                message = "云端拒绝这笔记账（${rejection.reason}），已保留在本机，请联系管理员处理",
                syncState = SyncState.SYNC_REJECTED,
            )
        }
        val stillQueued = pipeline.queuedOperationIds().contains(eventId)
        return if (stillQueued) {
            BookResult(
                true,
                "已保存在本机，等待同步到云端账本",
                "",
                if (flush?.authenticationRequired == true) SyncState.SYNC_FAILED else SyncState.PENDING_SYNC,
            )
        } else {
            BookResult(true, "已提交到财务账本", "", SyncState.PENDING_SYNC)
        }
    }

    fun ignore(accountId: String, candidateId: String, recognitionId: String): IgnoreResult {
        val recognition = store.recognition(accountId, recognitionId)
            ?: return IgnoreResult(false, "找不到这笔待处理交易")
        val archiveIds = RoomNotificationStore(NotificationDatabase.get(app))
            .structuredEventIdsForRecognition(accountId, recognition.sourceEventId).distinct()
        val eventId = when {
            archiveIds.size == 1 -> archiveIds.single()
            recognition.sourceEventId.startsWith("notification#event#") ->
                recognition.sourceEventId.removePrefix("notification#event#")
            else -> recognition.uploadEventId.trim()
        }
        if (eventId.isBlank()) {
            return IgnoreResult(false, "旧记录缺少精确事件关联，已保留本机记录；请先同步核对")
        }

        // If this review exists in the shared server set, make the remote state
        // terminal first. Never tell the user it was deleted only to let the
        // next Finance refresh resurrect it.
        val remote = hintSync.dismissRemote(accountId, eventId)
        if (!remote.ok) {
            return IgnoreResult(false, remote.message.ifBlank { "云端待处理状态没有删除，请重试" })
        }

        if (candidateId.isNotBlank()) {
            runCatching { hook.coordinator().rejectCandidate(accountId, candidateId) }
        }
        return runCatching {
            store.saveRecognition(
                recognition.copy(state = PaymentRecognitionState.IGNORED.name, updatedAtMs = System.currentTimeMillis()),
            )
            pipeline.cancelQueuedPayment(eventId)
            PaymentReviewSignals.publish()
            IgnoreResult(true, "已忽略这笔交易，通知与财务待处理状态已同步")
        }.getOrElse {
            IgnoreResult(false, "本机待处理状态没有保存，请重试")
        }
    }

    /** Flushes queued bookings so the cloud ledger catches up. */
    fun flush(): FlushOutcome = runCatching {
        val result = pipeline.flushDetailed()
        FlushOutcome(result.uploaded, result.rejected.map { it.reason }.distinct())
    }.getOrDefault(FlushOutcome(0, emptyList()))

    private fun accountDeviceId(): String = sessions.currentAccount()?.deviceId.orEmpty()

    private fun appLabelOf(sourcePackage: String): String = PaymentAppLabels.resolve(app, sourcePackage)

    private fun directionOf(value: String): FinanceDirection =
        runCatching { FinanceDirection.valueOf(value) }.getOrDefault(FinanceDirection.UNKNOWN)

    companion object {
        fun requiresManualOcrReview(candidate: PaymentCandidate): Boolean =
            candidate.reason == "ocr_amount_suggestion" && candidate.editedAmountMinor == null

        val ATTENTION_STATES = listOf(
            PaymentRecognitionState.DETECTED_AMOUNT_UNKNOWN.name,
            PaymentRecognitionState.WAITING_FOR_ENRICHMENT.name,
            PaymentRecognitionState.ENRICHMENT_EXPIRED.name,
            PaymentRecognitionState.ENRICHMENT_VERIFIED.name,
            PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
            PaymentRecognitionState.VERIFICATION_FAILED.name,
        )

        /**
         * Canonical UI/review identity. Two local rows are folded only when
         * they already prove the same structured event; amount/time proximity
         * is deliberately never used as a dedupe heuristic.
         */
        fun reviewIdentity(recognition: PaymentRecognitionRecord): String =
            recognition.uploadEventId.ifBlank { recognition.sourceEventId }.ifBlank { recognition.recognitionId }

        /** Deterministic so a retry can never book the same payment twice. */
        fun bookingEventId(recognition: PaymentRecognitionRecord): String =
            "pay-verify:" + recognition.recognitionId

        /**
         * Amount-unknown captures stay local until this device verifies them;
         * amount-known captures were uploaded and are confirmed on the Finance
         * page. Legacy rows (created before upload identity was persisted) have
         * a candidate for an amount-known capture, so they are treated as
         * server-owned as well.
         */
        fun authorityOf(recognition: PaymentRecognitionRecord): Authority = when (recognition.state) {
            PaymentRecognitionState.DETECTED_AMOUNT_UNKNOWN.name,
            PaymentRecognitionState.WAITING_FOR_ENRICHMENT.name,
            PaymentRecognitionState.ENRICHMENT_EXPIRED.name,
            PaymentRecognitionState.VERIFICATION_FAILED.name,
            -> Authority.NEEDS_AMOUNT
            PaymentRecognitionState.ENRICHMENT_VERIFIED.name -> Authority.DEVICE
            else -> Authority.SERVER
        }
    }
}

internal fun paymentSyncStateFor(
    uploadEventId: String,
    transactionId: String,
    rejected: Boolean,
    queued: Boolean,
    bookingAttempted: Boolean,
    observation: PaymentHintSync.Result?,
): PaymentVerificationCenter.SyncState = when {
    transactionId.isNotBlank() -> PaymentVerificationCenter.SyncState.SYNCED
    rejected -> PaymentVerificationCenter.SyncState.SYNC_REJECTED
    queued -> PaymentVerificationCenter.SyncState.PENDING_SYNC
    uploadEventId.isNotBlank() && observation?.completeObservation == true &&
        observation.observedStates[uploadEventId] != "pending" -> PaymentVerificationCenter.SyncState.UNRESOLVED_REMOTE
    bookingAttempted -> PaymentVerificationCenter.SyncState.SYNC_FAILED
    uploadEventId.isNotBlank() -> PaymentVerificationCenter.SyncState.PENDING_SYNC
    else -> PaymentVerificationCenter.SyncState.LOCAL_ONLY
}
