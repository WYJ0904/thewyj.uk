package uk.thewyj.app.task21.payment

/**
 * User facing payment recognition state. Every state has a plain Chinese
 * message; nothing here exposes database names, account ids, hashes or tokens.
 */
enum class PaymentRecognitionState {
    DETECTED_AMOUNT_KNOWN,
    DETECTED_AMOUNT_UNKNOWN,
    WAITING_FOR_ENRICHMENT,
    ENRICHMENT_VERIFIED,
    ENRICHMENT_EXPIRED,
    FINANCE_PENDING_CONFIRMATION,
    FINANCE_RECORDED,
    FINANCE_MANUALLY_CONFIRMED,
    FINANCE_CORRECTED,
    DUPLICATE_IGNORED,
    IGNORED,
    VERIFICATION_FAILED,
    ;

    val terminal: Boolean
        get() = this in setOf(
            // FINANCE_RECORDED is intentionally not terminal: a recorded
            // transaction can still be corrected by the user.
            FINANCE_MANUALLY_CONFIRMED, FINANCE_CORRECTED,
            DUPLICATE_IGNORED, IGNORED, VERIFICATION_FAILED,
        )
}

data class PaymentStatusRecord(
    val recognitionId: String,
    val state: PaymentRecognitionState,
    val updatedAtMs: Long,
    val notificationId: Int,
)

data class PaymentStatusNotificationMessage(
    val notificationId: Int,
    val title: String,
    val body: String,
    /** Package of the app the user should open, empty when there is none. */
    val openPackage: String = "",
    /** True when the notification should offer 核实交易金额. */
    val offerManualVerification: Boolean = false,
)

sealed interface PaymentStatusTransition {
    /** State changed; the caller should post/replace the notification. */
    data class Updated(
        val record: PaymentStatusRecord,
        val message: PaymentStatusNotificationMessage,
    ) : PaymentStatusTransition

    /** Illegal or already-applied transition: no notification is emitted. */
    data class Ignored(val record: PaymentStatusRecord?, val reason: String) : PaymentStatusTransition
}

/**
 * State machine for the payment recognition notifications.
 *
 * Guarantees:
 *  - one notification id per recognition, so updates replace instead of piling up;
 *  - identical replays (listener reconnect, WorkManager retry) never re-notify;
 *  - terminal states can never be re-opened by late evidence.
 */
class PaymentStatusStateMachine(private val now: () -> Long = System::currentTimeMillis) {
    fun initialState(recognitionId: String, amountKnown: Boolean): PaymentRecognitionState =
        if (amountKnown) PaymentRecognitionState.DETECTED_AMOUNT_KNOWN else PaymentRecognitionState.DETECTED_AMOUNT_UNKNOWN

    fun transition(
        current: PaymentStatusRecord?,
        next: PaymentRecognitionState,
        recognitionId: String,
        sourceAppLabel: String,
        amountLabel: String = "",
        directionLabel: String = "",
    ): PaymentStatusTransition {
        val existing = current
        if (existing != null && existing.state == next) {
            return PaymentStatusTransition.Ignored(existing, "state_unchanged")
        }
        if (existing != null && existing.state.terminal) {
            return PaymentStatusTransition.Ignored(existing, "terminal_state")
        }
        if (!isLegal(existing?.state, next)) {
            return PaymentStatusTransition.Ignored(existing, "illegal_transition")
        }
        val record = PaymentStatusRecord(
            recognitionId = recognitionId,
            state = next,
            updatedAtMs = now(),
            notificationId = existing?.notificationId ?: stableNotificationId(recognitionId),
        )
        return PaymentStatusTransition.Updated(record, messageFor(record, sourceAppLabel, amountLabel, directionLabel))
    }

    private fun isLegal(from: PaymentRecognitionState?, to: PaymentRecognitionState): Boolean {
        if (from == null) return true
        return when (from) {
            PaymentRecognitionState.DETECTED_AMOUNT_KNOWN ->
                to in setOf(
                    PaymentRecognitionState.FINANCE_RECORDED,
                    PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION,
                    PaymentRecognitionState.FINANCE_MANUALLY_CONFIRMED,
                    PaymentRecognitionState.DUPLICATE_IGNORED,
                    PaymentRecognitionState.IGNORED,
                    PaymentRecognitionState.VERIFICATION_FAILED,
                )
            PaymentRecognitionState.DETECTED_AMOUNT_UNKNOWN ->
                to in setOf(
                    PaymentRecognitionState.WAITING_FOR_ENRICHMENT,
                    PaymentRecognitionState.ENRICHMENT_EXPIRED,
                    PaymentRecognitionState.IGNORED,
                    PaymentRecognitionState.VERIFICATION_FAILED,
                )
            PaymentRecognitionState.WAITING_FOR_ENRICHMENT ->
                to in setOf(
                    PaymentRecognitionState.ENRICHMENT_VERIFIED,
                    PaymentRecognitionState.ENRICHMENT_EXPIRED,
                    PaymentRecognitionState.VERIFICATION_FAILED,
                )
            PaymentRecognitionState.ENRICHMENT_VERIFIED ->
                to in setOf(
                    PaymentRecognitionState.FINANCE_RECORDED,
                    PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION,
                    PaymentRecognitionState.FINANCE_MANUALLY_CONFIRMED,
                    PaymentRecognitionState.DUPLICATE_IGNORED,
                    PaymentRecognitionState.IGNORED,
                    PaymentRecognitionState.VERIFICATION_FAILED,
                )
            PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION ->
                to in setOf(
                    PaymentRecognitionState.FINANCE_RECORDED,
                    PaymentRecognitionState.FINANCE_MANUALLY_CONFIRMED,
                    PaymentRecognitionState.IGNORED,
                    PaymentRecognitionState.DUPLICATE_IGNORED,
                )
            PaymentRecognitionState.FINANCE_RECORDED ->
                to == PaymentRecognitionState.FINANCE_CORRECTED
            PaymentRecognitionState.ENRICHMENT_EXPIRED ->
                // Manual "核实交易金额" restarts the enrichment window.
                to in setOf(
                    PaymentRecognitionState.WAITING_FOR_ENRICHMENT,
                    PaymentRecognitionState.ENRICHMENT_VERIFIED,
                    PaymentRecognitionState.VERIFICATION_FAILED,
                    PaymentRecognitionState.IGNORED,
                )
            else -> false
        }
    }

    private fun messageFor(
        record: PaymentStatusRecord,
        sourceAppLabel: String,
        amountLabel: String,
        directionLabel: String,
    ): PaymentStatusNotificationMessage {
        val app = sourceAppLabel.ifBlank { "该应用" }
        return when (record.state) {
            PaymentRecognitionState.DETECTED_AMOUNT_KNOWN -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 已识别交易",
                body = if (directionLabel.isBlank()) "$app：已识别金额 $amountLabel" else "$app：识别到$directionLabel $amountLabel",
            )
            PaymentRecognitionState.DETECTED_AMOUNT_UNKNOWN -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 发现疑似交易",
                body = "暂未识别到金额。请在 90 秒内打开「$app」查看这笔交易，thewyj 将尝试自动核实金额。",
                openPackage = "",
                offerManualVerification = false,
            )
            PaymentRecognitionState.WAITING_FOR_ENRICHMENT -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 等待核实金额",
                body = "请在 90 秒内打开「$app」对应交易页面，thewyj 将尝试自动核实金额。",
            )
            PaymentRecognitionState.ENRICHMENT_VERIFIED -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 金额核实成功",
                body = "$app：已识别金额 $amountLabel",
            )
            PaymentRecognitionState.ENRICHMENT_EXPIRED -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 交易金额尚未核实",
                body = "未能识别这笔交易的金额。请打开 thewyj，点击「核实交易金额」，然后打开「$app」对应交易页面。",
                offerManualVerification = true,
            )
            PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 等待确认记账",
                body = "$app：识别到 $amountLabel，等待确认记账",
            )
            PaymentRecognitionState.FINANCE_RECORDED -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 已记录到财务",
                body = if (directionLabel.isBlank()) "$app：$amountLabel 已记录到财务" else "$app：$directionLabel $amountLabel 已记录到财务",
            )
            PaymentRecognitionState.FINANCE_MANUALLY_CONFIRMED -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 已确认记账",
                body = "$app：$amountLabel 已按你的确认记录",
            )
            PaymentRecognitionState.FINANCE_CORRECTED -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 已更新财务记录",
                body = "$app：$amountLabel 已按你的修改更新",
            )
            PaymentRecognitionState.DUPLICATE_IGNORED -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 已识别为重复",
                body = "这笔交易已经记录过，未重复记账。",
            )
            PaymentRecognitionState.IGNORED -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 已忽略",
                body = "该提醒未计入财务。",
            )
            PaymentRecognitionState.VERIFICATION_FAILED -> PaymentStatusNotificationMessage(
                notificationId = record.notificationId,
                title = "thewyj · 暂未找到可靠的交易金额",
                body = "请确认已经打开对应交易详情页面后重试。",
                offerManualVerification = true,
            )
        }
    }

    companion object {
        /** Stable per recognition so updates replace the previous notification. */
        fun stableNotificationId(recognitionId: String): Int {
            var hash = 0x811c9dc5.toInt()
            for (char in recognitionId) {
                hash = hash xor char.code
                hash *= 16777619
            }
            // Keep the id inside a dedicated band so it never collides with the
            // upload foreground notification (2201).
            return 2300 + (hash and 0x0FFFFFFF) % 100_000
        }
    }
}
