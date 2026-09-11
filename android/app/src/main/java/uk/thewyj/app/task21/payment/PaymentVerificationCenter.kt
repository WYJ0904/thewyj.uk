package uk.thewyj.app.task21.payment

import android.content.Context
import uk.thewyj.app.task21.FinanceDirection
import uk.thewyj.app.task21.NotificationCapturePipeline
import uk.thewyj.app.task21.NotificationEventType
import uk.thewyj.app.task21.NotificationFingerprint
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.ParseStatus
import uk.thewyj.app.task21.StructuredEventJson
import uk.thewyj.app.task21.StructuredNotificationEvent
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.PaymentRecognitionStoreContract
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

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
class PaymentVerificationCenter(context: Context) {
    private val app = context.applicationContext
    private val sessions = NotificationSessionProvider(app)
    private val pipeline = NotificationCapturePipeline.create(app, sessions)
    private val store: PaymentRecognitionStoreContract =
        RoomPaymentRecognitionStore(NotificationDatabase.get(app))
    private val hook = AndroidPaymentRecognitionHook.get(app)
    private val tickets = PaymentTicketEngine()

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
        val uploaded: Boolean,
        val ticketActive: Boolean,
        val remainingMs: Long,
        val occurredAtMs: Long,
        val financeTransactionId: String,
        val syncState: SyncState,
        val authority: Authority,
        val notice: String,
    ) {
        val needsAmount: Boolean get() = amountMinor == null || amountMinor <= 0
        /** This device may create the canonical transaction for the item. */
        val deviceBooks: Boolean get() = authority == Authority.DEVICE
    }

    enum class SyncState { NONE, LOCAL_ONLY, PENDING_SYNC, SYNCED, SYNC_FAILED, SYNC_REJECTED }

    /**
     * Which side owns the booking. A recognition that captured an amount was
     * uploaded and becomes a server candidate (the Finance page confirms it);
     * only an amount-unknown payment that this device later verified is booked
     * here. This is the guard that makes a double booking impossible.
     */
    enum class Authority { NEEDS_AMOUNT, DEVICE, SERVER }

    data class BookResult(
        val ok: Boolean,
        val message: String,
        val transactionId: String = "",
        val syncState: SyncState = SyncState.NONE,
    )

    data class FlushOutcome(val uploaded: Int, val rejected: List<String>)

    /** Creates a fresh 90 second ticket for a recognition the user asked for. */
    fun startVerification(recognitionId: String): PaymentTicket? {
        val account = sessions.currentAccount() ?: return null
        if (!account.financeEntitled) return null
        return runCatching { hook.coordinator().restartVerification(account.accountId, recognitionId) }.getOrNull()
    }

    fun account() = runCatching { sessions.currentAccount() }.getOrNull()

    /** Items that still need the user, newest first. */
    fun items(accountId: String): List<Item> {
        val recognitions = store.recognitionsByState(accountId, ATTENTION_STATES, 60)
        val queued = pipeline.queuedRequests()
        val queue = queued.map { it.operationId }.toSet()
        val rejections = queued.filter { it.lastError.isNotBlank() }.associate { it.operationId to it.lastError }
        return recognitions.map { recognition ->
            val candidate = store.candidateForRecognition(accountId, recognition.recognitionId)
            val ticket = store.ticketsForRecognition(accountId, recognition.recognitionId)
                .maxByOrNull { it.createdAtMs }
            val active = ticket != null && tickets.isActive(ticket)
            val uploaded = recognition.uploadEventId.isNotBlank()
            val transactionId = candidate?.financeTransactionId.orEmpty()
            val bookingId = bookingEventId(recognition)
            val bookingAttempted = recognition.uploadEventId == bookingId
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
                uploaded = uploaded,
                ticketActive = active,
                remainingMs = if (active) (ticket!!.expiresAtMs - System.currentTimeMillis()).coerceAtLeast(0) else 0,
                occurredAtMs = candidate?.effectiveOccurredAtMs ?: recognition.createdAtMs,
                financeTransactionId = transactionId,
                syncState = when {
                    transactionId.isNotBlank() -> SyncState.SYNCED
                    rejections.containsKey(bookingId) -> SyncState.SYNC_REJECTED
                    queue.contains(bookingId) -> SyncState.PENDING_SYNC
                    bookingAttempted -> SyncState.SYNC_FAILED
                    uploaded -> SyncState.PENDING_SYNC
                    else -> SyncState.LOCAL_ONLY
                },
                authority = authorityOf(recognition),
                notice = rejections[bookingId].orEmpty(),
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
        amountMinor: Long?,
        direction: String,
        merchant: String,
    ): Boolean {
        if (candidateId.isBlank()) return false
        return runCatching {
            hook.coordinator().editCandidate(
                accountId = accountId,
                candidateId = candidateId,
                amountMinor = amountMinor,
                direction = direction,
                merchant = merchant,
            )
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

    fun ignore(accountId: String, candidateId: String, recognitionId: String): Boolean {
        if (candidateId.isNotBlank()) runCatching { hook.coordinator().rejectCandidate(accountId, candidateId) }
        return runCatching {
            val recognition = store.recognition(accountId, recognitionId)
            if (recognition != null) {
                store.saveRecognition(
                    recognition.copy(state = "IGNORED", updatedAtMs = System.currentTimeMillis()),
                )
            }
        }.isSuccess
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
        val ATTENTION_STATES = listOf(
            PaymentRecognitionState.DETECTED_AMOUNT_UNKNOWN.name,
            PaymentRecognitionState.WAITING_FOR_ENRICHMENT.name,
            PaymentRecognitionState.ENRICHMENT_EXPIRED.name,
            PaymentRecognitionState.ENRICHMENT_VERIFIED.name,
            PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
            PaymentRecognitionState.VERIFICATION_FAILED.name,
        )

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
            PaymentRecognitionState.ENRICHMENT_VERIFIED.name ->
                if (recognition.uploadEventId.isNotBlank()) Authority.SERVER else Authority.DEVICE
            else -> Authority.SERVER
        }
    }
}
