package uk.thewyj.app.task21.payment

import java.util.concurrent.atomic.AtomicLong
import uk.thewyj.app.task21.FinanceDirection

/** Page interpretation is not proof of a provider identity or permission to book. */
enum class PaymentPageState { DETAIL, COMPLETED, PENDING, FAILED, LIST, HISTORY, BALANCE, PROMOTION, LOADING, SENSITIVE, CHAT, UNKNOWN }

object PaymentPageEvidence {
    private val settledTerms=(PaymentText.completionTerms.filterNot { it in setOf("扣款","到账","到賬","入账","入賬") }+
        listOf("到账成功","到賬成功","入账成功","入賬成功","入帳成功","轉出成功","轉入成功")).distinct()
    private const val unit="CNY|RMB|USD|EUR|HKD|GBP|JPY|US\\$|HK\\$|JP[¥￥]|[¥￥$€£]|元"
    private val settledStatus=Regex("^(?:"+settledTerms.joinToString("|"){Regex.escape(it)}+")(?:\\s*[:：]?\\s*(?:(?:$unit)\\s*)?[0-9][0-9,.]*(?:\\s*(?:$unit))?)?$",RegexOption.IGNORE_CASE)
    private val labelledStatus=Regex("^(?:付款|支付|交易|退款|转账|收款)状态\\s*[:：]\\s*(?:成功|完成|已完成)$")
    fun settledAmountLine(line:String):Boolean = settledStatus.matches(line.trim())
    private val transferTitles = setOf("转账详情", "轉賬詳情", "轉帳詳情", "转帐详情")
    private val timeLabel = Regex("(?:转账|转帐|轉帳|轉賬)(?:时间|時間)")
    private val receivedByOther = Regex("^(?:已被(?!(?:你|您|本人)(?:领取|領取)).{1,30}(?:领取|領取)|(?:对方|對方)已(?:收款|领取|領取))$")
    fun transferReceipt(lines: List<String>): Boolean = lines.any { it.trim() in transferTitles } && lines.any(timeLabel::containsMatchIn)
    fun transferDirection(lines: List<String>): FinanceDirection? {
        if (!transferReceipt(lines)) return null
        if (lines.any { line->PaymentText.refundTerms.any(line::contains) }) return null
        val outgoing = lines.any { receivedByOther.matches(it.trim()) }
        val incoming = lines.any { it.trim() in setOf("你已收款", "您已收款", "你已领取", "您已领取", "已存入零钱", "已存入零錢") }
        return when { outgoing && !incoming -> FinanceDirection.EXPENSE; incoming && !outgoing -> FinanceDirection.INCOME; else -> null }
    }
    fun completed(lines: List<String>): Boolean {
        val text=lines.joinToString(" ")
        return !PaymentText.hasIncompleteStatus(text) &&
            (lines.any {settledStatus.matches(it.trim()) || labelledStatus.matches(it.trim())} || transferDirection(lines) != null)
    }
    fun direction(lines:List<String>): FinanceDirection? {
        PaymentPageContext.pendingDirection(lines)?.let {return it}
        val statuses=lines.filter {settledStatus.matches(it.trim()) || labelledStatus.matches(it.trim())}
        if (statuses.isNotEmpty()) {
            val explicit=statuses.mapNotNull(PaymentText::direction).distinct()
            // A specific other-party acceptance resolves generic receiver wording; refund status stays refund.
            if (explicit==listOf(FinanceDirection.REFUND)) return FinanceDirection.REFUND
            transferDirection(lines)?.let {return it}
            return explicit.singleOrNull()
        }
        return transferDirection(lines) ?: PaymentText.direction(lines.joinToString(" "))
    }
    fun classify(lines: List<String>): PaymentPageState {
        val text=lines.joinToString(" ");val heading=lines.take(3)
        return when {
            listOf("密码","密碼","验证码","驗證碼","身份证","身份證","银行卡号","銀行卡號").any(text::contains) -> PaymentPageState.SENSITIVE
            heading.any { it in setOf("聊天","聊天记录","聊天記錄") } -> PaymentPageState.CHAT
            heading.any { it in setOf("加载中","加载中…","加载中...","正在加载","正在跳转","正在跳轉") } -> PaymentPageState.LOADING
            heading.any { it in setOf("交易记录","交易记录列表","账单列表","交易列表") } -> PaymentPageState.LIST
            heading.any { it in setOf("历史账单","歷史賬單","历史交易") } -> PaymentPageState.HISTORY
            heading.any { it in setOf("账户余额","账户资产","我的资产","账户總資產","总资产") } -> PaymentPageState.BALANCE
            heading.any { it in setOf("优惠活动","優惠活動","优惠券","限时优惠","商品推广") } -> PaymentPageState.PROMOTION
            Regex("(?:支付|付款|交易|转账|轉賬)(?:失败|失敗|取消|关闭|關閉|已取消|已关闭)").containsMatchIn(text) -> PaymentPageState.FAILED
            PaymentText.hasIncompleteStatus(text) -> PaymentPageState.PENDING
            completed(lines) -> PaymentPageState.COMPLETED
            PaymentPageContext.isDetail(lines) -> PaymentPageState.DETAIL
            else -> PaymentPageState.UNKNOWN
        }
    }
    fun blocked(lines: List<String>) = classify(lines) in setOf(PaymentPageState.LIST,PaymentPageState.HISTORY,PaymentPageState.BALANCE,
        PaymentPageState.PROMOTION,PaymentPageState.LOADING,PaymentPageState.SENSITIVE,PaymentPageState.CHAT)
}

/** An in-flight screenshot/OCR must observe the same content revision, even in one window. */
class PaymentPageEvidenceEpoch {
    private val revision=AtomicLong()
    fun capture(): Long = revision.get()
    fun invalidate() { revision.incrementAndGet() }
    fun current(token: Long): Boolean = token==revision.get()
}

/** One Room transaction fences concurrent callers and process restarts before any page read. */
object PaymentPersistedScanBudget {
    fun reserve(store: uk.thewyj.app.task21.store.PaymentRecognitionStoreContract, accountId: String, ticketId: String, nowMs: Long): Boolean = store.transaction {
        val ticket=store.ticket(accountId,ticketId) ?: return@transaction false
        if (store.activeTicketForPackage(accountId,ticket.sourcePackage)?.ticketId!=ticketId ||
            !ticket.state.active || nowMs !in ticket.createdAtMs..ticket.expiresAtMs || ticket.scanAttempts !in 0 until PaymentPageRetry.MAX_ATTEMPTS) return@transaction false
        store.saveTicket(ticket.copy(scanAttempts=ticket.scanAttempts+1))
        true
    }
}
