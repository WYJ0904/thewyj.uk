package uk.thewyj.app.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import uk.thewyj.app.task21.payment.PaymentVerificationCenter
import uk.thewyj.app.task21.payment.PaymentHintSync
import uk.thewyj.app.task21.payment.PendingReconciliationPolicy
import uk.thewyj.app.task21.payment.PaymentCountdown

/**
 * Screen state for "待核实 / 待确认交易". All work happens off the main thread:
 * Room, Keystore and the network are never touched from a Compose frame.
 */
class PaymentVerificationState(
    context: Context,
    val accountId: String,
    private val center: PaymentVerificationCenter = PaymentVerificationCenter(context.applicationContext),
    private val reconcileOverride: (suspend (String) -> PaymentHintSync.Result?)? = null,
    private val aiOverride: uk.thewyj.app.finance.FinanceAiCoordinator? = null,
) {
    private val ai by lazy { aiOverride ?: uk.thewyj.app.finance.FinanceAiCoordinator.get(context.applicationContext) }
    var aiRows by mutableStateOf<Map<String,uk.thewyj.app.finance.FinanceAiObservation>>(emptyMap())
    var aiConsent by mutableStateOf(false)
    var aiConsentGranted by mutableStateOf(false)
    private var aiModelVersion by mutableStateOf("")
    private var aiConsentRevision by mutableStateOf(-1L)
    var aiBusy by mutableStateOf<Set<String>>(emptySet())
    private var editBaseline:List<String>?=null
    private val reconciliationMutex = Mutex()
    @Volatile private var reconciliationRequested = false
    private var lastCompleteObservation: PaymentHintSync.Result? = null
    private var canonicalMutation = 0L
    private var displayGeneration = 0L
    private var lifecycleGeneration = 0L
    private var active = true
    private val countdown = PaymentCountdown()
    var observationAtMs by mutableStateOf(0L)
    var canonicalObserved by mutableStateOf(false)
    var canonicalCurrent by mutableStateOf(false)
    var reconciling by mutableStateOf(false)

    var items by mutableStateOf<List<PaymentVerificationCenter.Item>>(emptyList())
    var loading by mutableStateOf(true)
    var error by mutableStateOf("")
    var message by mutableStateOf("")
    var editingRecognitionId by mutableStateOf("")
    var amountText by mutableStateOf("")
    var direction by mutableStateOf("EXPENSE")
    var currency by mutableStateOf("")
    var merchantText by mutableStateOf("")
    var busyRecognitionId by mutableStateOf("")
    var busyAction by mutableStateOf("")
    private var refreshGeneration = 0

    fun activate() { active = true; lifecycleGeneration += 1 }
    fun deactivate() { active = false; lifecycleGeneration += 1; displayGeneration += 1 }
    fun remainingMs(item: PaymentVerificationCenter.Item, wallMs: Long = System.currentTimeMillis(),
        elapsedMs: Long = android.os.SystemClock.elapsedRealtime()): Long =
        countdown.remainingMs(item.ticketId, item.ticketExpiresAtMs, wallMs, elapsedMs)

    private fun current(lifecycle: Long, observation: PaymentHintSync.Result? = null): Boolean =
        active && lifecycle == lifecycleGeneration && (observation == null || center.observationIsCurrent(accountId, observation))

    suspend fun refresh() {
        if (!active) return
        val generation = ++refreshGeneration
        val lifecycle = lifecycleGeneration
        val display = displayGeneration
        loading = items.isEmpty()
        error = ""
        try {
            val cached = withContext(Dispatchers.IO) { center.cachedObservation(accountId) }
            val snapshot = cached ?: lastCompleteObservation
            val refreshed = withContext(Dispatchers.IO) {
                if (snapshot != null) center.reconciledItems(accountId, snapshot)
                else center.localItems(accountId)
            }
            val assistance = withContext(Dispatchers.IO) {
                ai.observationsForUi(accountId,refreshed.map{it.recognitionId}.toSet()) to ai.accountState(accountId)
            }
            if (generation == refreshGeneration && display == displayGeneration && current(lifecycle, snapshot)) {
                // A local signal must not repaint a stale server snapshot over
                // a card that this UI just terminalized. The cloud set changes
                // only when a fresh summary arrives through reconcile().
                val retained = items.filterNot { it.recoveryOnly }.map { it.canonicalIdentity }.toSet()
                items = if (cached != null || snapshot == null) refreshed else
                    refreshed.filter { it.recoveryOnly || it.canonicalIdentity in retained }
                aiRows=assistance.first
                aiConsent=assistance.second?.let{it.available&&it.consent&&!it.localRevokePending}==true
                aiConsentGranted=assistance.second?.let{it.consent&&!it.localRevokePending}==true
                aiModelVersion=assistance.second?.modelVersion.orEmpty()
                aiConsentRevision=assistance.second?.consentRevision?:-1L
                if (snapshot != null) {
                    lastCompleteObservation = snapshot; canonicalObserved = true
                    observationAtMs = snapshot.observedAtMs
                    if (snapshot.fromCache) canonicalCurrent = false
                }
            }
        } catch (cancellation: CancellationException) {
            // Leaving this Compose surface (for example opening WeChat) is a
            // normal lifecycle cancellation, never a user-facing error.
            throw cancellation
        } catch (failure: Throwable) {
            if (generation == refreshGeneration && current(lifecycle)) error = failure.message ?: "读取待确认交易失败"
        } finally {
            if (generation == refreshGeneration && current(lifecycle)) loading = false
        }
    }

    /** Cloud work starts only after the local list has been returned to Compose. */
    suspend fun reconcile() {
        if (!active) return
        val lifecycle = lifecycleGeneration
        reconciliationRequested = true
        reconciliationMutex.withLock {
            if (!current(lifecycle) || !reconciliationRequested) return
            try {
                reconciling = true
                var attempt = 0
                do {
                    reconciliationRequested = false
                    val generation = canonicalMutation
                    val observation = withContext(Dispatchers.IO) {
                        if (reconcileOverride != null) reconcileOverride.invoke(accountId) else center.reconcile(accountId)
                    }
                    if (!current(lifecycle)) return
                    if (generation != canonicalMutation || (observation != null && !current(lifecycle, observation))) {
                        reconciliationRequested = true
                    } else if (observation?.completeObservation == true) {
                        val display = ++displayGeneration
                        val refreshed = withContext(Dispatchers.IO) { center.reconciledItems(accountId, observation) }
                        if (generation == canonicalMutation && display == displayGeneration && current(lifecycle, observation)) {
                            lastCompleteObservation = observation
                            items = refreshed
                            displayGeneration += 1
                            canonicalObserved = true
                            canonicalCurrent = !observation.fromCache
                            observationAtMs = observation.observedAtMs
                            error = ""
                        } else reconciliationRequested = true
                    } else {
                        canonicalCurrent = false
                        error = "暂未取得完整云端待处理列表，请刷新重试"
                    }
                    attempt += 1
                } while (reconciliationRequested && attempt < 2)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (_: Throwable) {
                if (current(lifecycle)) {
                    canonicalCurrent = false
                    error = "云端待处理状态暂时无法核对，请刷新重试"
                }
                // Keep the already rendered local Room result when cloud is slow,
                // unauthorized or unavailable. The next explicit/bounded pull retries.
            } finally {
                reconciling = false
            }
        }
    }

    /** Starts a fresh 90 second enrichment ticket for one recognition. */
    suspend fun startVerification(item: PaymentVerificationCenter.Item) {
        val ticket = withContext(Dispatchers.IO) { center.startVerification(item.recognitionId) }
        message = if (ticket == null) {
            "无法开始核实，请确认账户权益与登录状态后重试"
        } else {
            "已在 90 秒内监听「${item.appLabel}」，请打开这笔转账、付款或收款页面并停留"
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
        currency = item.displayCurrency.takeIf { it in uk.thewyj.app.finance.CurrencyMoney.digits }.orEmpty()
        amountText = item.amountMinor?.takeUnless { item.moneyUnitReview }?.let { runCatching { formatMinor(it, currency) }.getOrNull() }.orEmpty()
        direction = item.direction.name.ifBlank { "EXPENSE" }
        merchantText = item.merchant
        editBaseline=listOf(currency,amountText,direction,merchantText)
    }

    suspend fun requestAi(item:PaymentVerificationCenter.Item,enable:Boolean=false){
        val lifecycle=lifecycleGeneration
        if(item.hasEdits||item.recognitionId.isBlank()||item.recognitionId in aiBusy)return
        aiBusy=aiBusy+item.recognitionId
        try{
            val result=withContext(Dispatchers.IO){if(enable&&!ai.setConsent(accountId,true))false else ai.flush(accountId)}
            if(current(lifecycle)){message=if(result)"AI建议仍须核对后人工确认" else "AI暂不可用或尚未授权，原交易保留，可继续人工核实";refresh()}
        }finally{aiBusy=aiBusy-item.recognitionId}
    }
    fun aiSummary(item:PaymentVerificationCenter.Item):String=runCatching {
        if(!aiConsent)return ""
        val row=aiRows[item.recognitionId]?:return ""
        if(System.currentTimeMillis()>=row.expiresAtMs)return ""
        val response=org.json.JSONObject(row.responseJson)
        if(response.optString("model_version")!=aiModelVersion||response.optLong("consent_revision",-1)!=aiConsentRevision)return ""
        val advice=uk.thewyj.app.finance.FinanceAiEvidence.validatedSuggestion(response,org.json.JSONObject(row.packetJson))?:return ""
        val id=advice.optString("selected_candidate_id");val values=advice.getJSONArray("amount_candidates")
        val selected=(0 until values.length()).map(values::getJSONObject).singleOrNull{it.getString("candidate_id")==id}?:return ""
        val category=mapOf("food" to "餐饮","transport" to "交通","shopping" to "购物","housing" to "居住","health" to "医疗","education" to "教育","entertainment" to "娱乐","income" to "收入","transfer" to "转账","refund" to "退款","other" to "其他")[advice.optString("category")]
        "建议原币金额："+uk.thewyj.app.finance.CurrencyMoney.format(selected.getLong("amount_minor"),selected.getString("currency"))+
            (category?.let{" · 分类建议：$it"}?:"")+(advice.optString("merchant_normalized").takeUnless{it.isBlank()||it=="null"}?.let{" · 商户建议：$it"}?:"")
    }.getOrDefault("")
    suspend fun disableAi(){
        val lifecycle=lifecycleGeneration
        withContext(Dispatchers.IO){ai.setConsent(accountId,false)}
        if(current(lifecycle)){aiConsent=false;message="已在本机停用AI建议，联网后同步撤销授权";refresh()}
    }
    suspend fun adoptAi(item:PaymentVerificationCenter.Item){
        val lifecycle=lifecycleGeneration
        if(item.hasEdits){message="保留你的人工修改，AI建议不会覆盖";return}
        fun dirty()=editingRecognitionId==item.recognitionId&&editBaseline!=listOf(currency,amountText,direction,merchantText)
        if(dirty()){message="保留尚未保存的人工修改，AI建议不会覆盖";return}
        val advice=withContext(Dispatchers.IO){ai.advice(accountId,item.recognitionId)}
        if(!current(lifecycle))return
        if(dirty()){message="保留尚未保存的人工修改，AI建议不会覆盖";return}
        if(advice==null){message="建议已失效或依据不足，请人工核实";return}
        val id=advice.optString("selected_candidate_id")
        val candidates=advice.optJSONArray("amount_candidates")
        val selected=candidates?.let{list->(0 until list.length()).mapNotNull(list::optJSONObject).singleOrNull{it.optString("candidate_id")==id}}
        if(selected==null){message="建议已失效或依据不足，请人工核实";return}
        beginEdit(item)
        currency=selected.getString("currency")
        amountText=java.math.BigDecimal.valueOf(selected.getLong("amount_minor"),uk.thewyj.app.finance.CurrencyMoney.exponent(currency)).toPlainString()
        direction=advice.getString("direction").uppercase()
        if(merchantText.isBlank())advice.optString("merchant_normalized").takeUnless{it.isBlank()||it=="null"}?.let{merchantText=it}
        message="已填入建议，请核对原证据后再保存并确认；尚未写账"
    }

    fun cancelEdit() {
        editingRecognitionId = ""
    }

    /** Saves the user's values and, when they are complete, books the payment. */
    suspend fun saveAndConfirm(item: PaymentVerificationCenter.Item, confirm: Boolean) {
        if (currency !in uk.thewyj.app.finance.CurrencyMoney.digits) { message = "请先核实并选择原币币种"; return }
        val amount = parseMinor(amountText, currency)
        if (confirm && (amount == null || amount <= 0)) {
            message = "请输入正确的金额"
            return
        }
        if (confirm && direction == "UNKNOWN") {
            message = "请先选择收入、支出或退款方向"
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
                currency = currency,
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
        // A successful explicit edit is the user's conflict resolution. The
        // display annotation alone must never authorize one-click booking.
        confirm(item.copy(evidenceConflict = false))
    }

    suspend fun confirm(item: PaymentVerificationCenter.Item) {
        if (item.evidenceConflict) { message = "本机与云端证据不一致，请核对并编辑后确认"; return }
        canonicalMutation += 1
        displayGeneration += 1
        val result = withContext(Dispatchers.IO) { center.confirmAndBook(accountId, item.recognitionId) }
        message = result.message
        if (result.ok && result.syncState == PaymentVerificationCenter.SyncState.SYNCED)
            items = items.filterNot { it.recognitionId == item.recognitionId }
        refresh()
        if (result.ok) reconcile()
    }

    suspend fun ignore(item: PaymentVerificationCenter.Item) {
        if (busyRecognitionId.isNotBlank()) return
        busyRecognitionId = item.recognitionId
        canonicalMutation += 1
        displayGeneration += 1
        busyAction = "ignore"
        error = ""
        message = "正在同步忽略状态…"
        try {
            val result = withContext(Dispatchers.IO) {
                center.ignore(accountId, item.candidateId, item.recognitionId)
            }
            if (result.ok) {
                error = ""
                message = result.message
                // The terminal local state is already persisted by center.ignore().
                // Remove the card immediately instead of making the user wait for
                // the follow-up network reconciliation before the UI reacts.
                items = items.filterNot { it.recognitionId == item.recognitionId }
            } else {
                message = ""
                error = result.message
            }
            refresh()
            if (result.ok) reconcile()
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (failure: Throwable) {
            message = ""
            error = failure.message ?: "忽略这笔交易失败，请重试"
        } finally {
            busyRecognitionId = ""
            busyAction = ""
        }
    }

    fun reportOpenAppFailure(appLabel: String) {
        message = ""
        error = "无法打开「$appLabel」。请确认应用已安装且未被系统停用。"
    }

    fun reportOpenAppStarted() {
        error = ""
    }

    fun isBusy(item: PaymentVerificationCenter.Item, action: String): Boolean =
        busyRecognitionId == item.recognitionId && busyAction == action

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
            reconcile()
            attempt += 1
        }
    }

    /** Server-owned states of the records currently on screen. */
    fun syncStates(): List<String> = if (!canonicalCurrent) listOf("UNRESOLVED_REMOTE") else items.map { it.syncState.name }

    companion object {
        fun formatMinor(amountMinor: Long, currency: String = "CNY"): String = uk.thewyj.app.finance.CurrencyMoney.decimalText(amountMinor, currency)
        fun parseMinor(text: String, currency: String = "CNY"): Long? = runCatching {
            uk.thewyj.app.finance.CurrencyMoney.parse(text, currency).takeIf { it in -10_000_000_000_000L..10_000_000_000_000L }
        }.getOrNull()
    }
}
