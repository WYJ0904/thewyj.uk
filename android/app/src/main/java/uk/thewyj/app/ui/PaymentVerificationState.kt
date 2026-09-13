package uk.thewyj.app.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uk.thewyj.app.task21.payment.PaymentVerificationCenter
import uk.thewyj.app.task21.payment.PendingReconciliationPolicy

/**
 * Screen state for "待核实 / 待确认交易". All work happens off the main thread:
 * Room, Keystore and the network are never touched from a Compose frame.
 */
class PaymentVerificationState(
    context: Context,
    val accountId: String,
) {
    private val center = PaymentVerificationCenter(context.applicationContext)

    var items by mutableStateOf<List<PaymentVerificationCenter.Item>>(emptyList())
    var loading by mutableStateOf(true)
    var error by mutableStateOf("")
    var message by mutableStateOf("")
    var editingRecognitionId by mutableStateOf("")
    var amountText by mutableStateOf("")
    var direction by mutableStateOf("EXPENSE")
    var merchantText by mutableStateOf("")

    suspend fun refresh() {
        loading = true
        error = ""
        try {
            items = withContext(Dispatchers.IO) { center.items(accountId) }
        } catch (failure: Throwable) {
            error = failure.message ?: "读取待确认交易失败"
        } finally {
            loading = false
        }
    }

    /** Starts a fresh 90 second enrichment ticket for one recognition. */
    suspend fun startVerification(item: PaymentVerificationCenter.Item) {
        val ticket = withContext(Dispatchers.IO) { center.startVerification(item.recognitionId) }
        message = if (ticket == null) {
            "无法开始核实，请确认账户权益与登录状态后重试"
        } else {
            "已在 90 秒内监听「${item.appLabel}」，请现在打开它并进入这笔交易的详情页"
        }
        refresh()
    }

    suspend fun flush() {
        val outcome = withContext(Dispatchers.IO) { center.flush() }
        message = when {
            outcome.rejected.isNotEmpty() ->
                "有 ${outcome.rejected.size} 笔记账被云端拒绝（${outcome.rejected.first()}），已保留在本机"
            outcome.uploaded > 0 -> "已同步 ${outcome.uploaded} 条记账结果"
            else -> "没有需要同步的记账结果"
        }
        refresh()
    }

    fun beginEdit(item: PaymentVerificationCenter.Item) {
        editingRecognitionId = item.recognitionId
        amountText = item.amountMinor?.let { formatMinor(it) }.orEmpty()
        direction = item.direction.name.ifBlank { "EXPENSE" }
        merchantText = item.merchant
    }

    fun cancelEdit() {
        editingRecognitionId = ""
    }

    /** Saves the user's values and, when they are complete, books the payment. */
    suspend fun saveAndConfirm(item: PaymentVerificationCenter.Item, confirm: Boolean) {
        val amount = parseMinor(amountText)
        if (confirm && (amount == null || amount <= 0)) {
            message = "请输入正确的金额"
            return
        }
        val saved = withContext(Dispatchers.IO) {
            center.saveCorrection(
                accountId = accountId,
                candidateId = item.candidateId,
                recognitionId = item.recognitionId,
                amountMinor = amount,
                direction = direction,
                merchant = merchantText.trim(),
            )
        }
        if (!saved) {
            message = "修改没有保存，请重试"
            return
        }
        editingRecognitionId = ""
        if (!confirm) {
            message = "已保存修改，确认后会写入财务账本"
            refresh()
            return
        }
        confirm(item)
    }

    suspend fun confirm(item: PaymentVerificationCenter.Item) {
        val result = withContext(Dispatchers.IO) { center.confirmAndBook(accountId, item.recognitionId) }
        message = result.message
        refresh()
    }

    suspend fun ignore(item: PaymentVerificationCenter.Item) {
        withContext(Dispatchers.IO) { center.ignore(accountId, item.candidateId, item.recognitionId) }
        message = "已忽略这笔交易，不会写入财务账本"
        refresh()
    }

    /**
     * Task 24 reopen #4: bounded catch-up while records that the server owns stay
     * on screen. A Web-side confirm reaches the device on the next pull; without
     * this, "next pull" only happened when the user left and reopened the screen.
     *
     * The loop stops by itself ([PendingReconciliationPolicy]) and is cancelled
     * with the screen, so it can never become a background poll.
     */
    suspend fun catchUpReconciliation() {
        var attempt = 0
        while (true) {
            val delayMs = PendingReconciliationPolicy.nextDelayMs(attempt, syncStates())
                ?: return
            kotlinx.coroutines.delay(delayMs)
            refresh()
            attempt += 1
        }
    }

    /** Server-owned states of the records currently on screen. */
    fun syncStates(): List<String> = items.map { it.syncState.name }

    companion object {
        fun formatMinor(amountMinor: Long): String {
            val sign = if (amountMinor < 0) "-" else ""
            val value = kotlin.math.abs(amountMinor)
            return "$sign${value / 100}.${(value % 100).toString().padStart(2, '0')}"
        }

        fun parseMinor(text: String): Long? {
            val trimmed = text.trim()
            if (trimmed.isEmpty()) return null
            val match = Regex("""^-?\d{1,9}(\.\d{1,2})?$""").find(trimmed) ?: return null
            val negative = match.value.startsWith("-")
            val parts = match.value.removePrefix("-").split(".")
            val major = parts[0].toLongOrNull() ?: return null
            val minor = if (parts.size > 1) parts[1].padEnd(2, '0').toLongOrNull() ?: 0L else 0L
            val total = major * 100 + minor
            return if (negative) -total else total
        }
    }
}
