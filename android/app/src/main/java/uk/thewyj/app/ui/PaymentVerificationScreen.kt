package uk.thewyj.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.AlertDialog
import uk.thewyj.app.core.design.ThewyjOutlinedButton as OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import uk.thewyj.app.core.design.ThewyjTextButton as TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import kotlinx.coroutines.launch
import uk.thewyj.app.core.design.ThewyjCard
import uk.thewyj.app.core.design.ThewyjPrimaryButton
import uk.thewyj.app.core.design.ThewyjRadius
import uk.thewyj.app.core.design.ThewyjSpacing
import uk.thewyj.app.core.design.statusContainerColor
import uk.thewyj.app.core.design.statusContentColor
import uk.thewyj.app.task21.payment.PaymentVerificationCenter
import uk.thewyj.app.task21.payment.PaymentReviewSignals

/**
 * In-app "待核实 / 待确认交易" surface.
 *
 * Everything the user was promised by the payment status notification lives
 * here: the pending record itself, the target app, the remaining 90 second
 * window, editing before booking, and the real booking state (本机 / 待同步 /
 * 已记录到财务). It never shows a success state that the ledger did not report.
 */
@Composable
fun PaymentVerificationScreen(
    state: PaymentVerificationState,
    onBack: () -> Unit,
    onOpenFinance: () -> Unit,
    onOpenApp: suspend (PaymentVerificationCenter.Item) -> Boolean,
) {
    val scope = rememberCoroutineScope()
    var tick by remember { mutableStateOf(0) }
    var resumed by remember { mutableStateOf(false) }
    var aiConsentItem by remember(state) { mutableStateOf<PaymentVerificationCenter.Item?>(null) }
    LifecycleResumeEffect(state) {
        state.activate()
        resumed = true
        onPauseOrDispose { resumed = false; state.deactivate() }
    }
    LaunchedEffect(state, resumed) {
        // StateFlow emits the latest invalidation on every resume, including
        // changes that happened with no subscriber or while a pull was slow.
        if (resumed) PaymentReviewSignals.changes.collect { state.refresh(); state.reconcile() }
    }
    // #4: bounded catch-up for records the server still owns (Web confirm → this
    // screen). It restarts when the set of pending records changes and stops by
    // itself after PendingReconciliationPolicy.windowMs.
    val pendingKey = "${state.canonicalObserved}:${state.canonicalCurrent}:" + state.items.joinToString("|") { "${it.canonicalIdentity.ifBlank { it.recognitionId }}:${it.syncState}" }
    LaunchedEffect(pendingKey, resumed) { if (resumed) state.catchUpReconciliation() }
    // Countdown display only; no background polling of Room or the network.
    LaunchedEffect(tick, state.items, resumed) {
        if (resumed && state.items.any { it.ticketActive && state.remainingMs(it) > 0 }) {
            kotlinx.coroutines.delay(1_000)
            tick += 1
        }
    }

    BackHandler(enabled = true) { onBack() }
    aiConsentItem?.let { item ->
        AlertDialog(onDismissRequest={aiConsentItem=null},title={Text("启用脱敏AI建议")},
            text={Text("仅发送这笔交易的脱敏金额候选和角色词，不发送聊天、姓名或订单号。AI结果仅供核对，仍需你人工确认。")},
            confirmButton={TextButton(onClick={aiConsentItem=null;scope.launch{state.requestAi(item,enable=true)}}){Text("同意并分析")}},
            dismissButton={TextButton(onClick={aiConsentItem=null}){Text("暂不启用")}})
    }
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(ThewyjSpacing.Lg),
            verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Md),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(onClick = onBack, shape = ThewyjRadius.Medium) { Text("返回") }
                Spacer(Modifier.width(ThewyjSpacing.Md))
                Text("待核实 / 待确认交易", style = MaterialTheme.typography.titleLarge)
            }
            Text(
                "缺金额或方向时，可在 90 秒内打开来源应用核实；金额和方向完整后会自动记账。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (state.message.isNotBlank()) {
                Surface(
                    color = statusContainerColor(MaterialTheme.colorScheme, "info"),
                    contentColor = statusContentColor(MaterialTheme.colorScheme, "info"),
                    shape = ThewyjRadius.Medium,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(state.message, Modifier.padding(ThewyjSpacing.Md), style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (state.error.isNotBlank()) {
                Surface(
                    color = statusContainerColor(MaterialTheme.colorScheme, "error"),
                    contentColor = statusContentColor(MaterialTheme.colorScheme, "error"),
                    shape = ThewyjRadius.Medium,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(state.error, Modifier.padding(ThewyjSpacing.Md), style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (!state.canonicalCurrent && state.observationAtMs > 0) {
                Text("显示上次云端核对结果（${java.text.SimpleDateFormat("MM-dd HH:mm:ss", java.util.Locale.CHINA).format(java.util.Date(state.observationAtMs))}）；本机证据另行标注。",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                TextButton(onClick = { scope.launch { state.refresh(); state.reconcile() } }) { Text("刷新") }
                TextButton(onClick = { scope.launch { state.flush() } }) { Text("同步记账") }
                TextButton(onClick = onOpenFinance) { Text("打开财务") }
            }
            if (state.loading && state.items.isEmpty()) {
                Text("正在读取待确认交易…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (!state.canonicalObserved) {
                Text(if (state.reconciling) "正在核对云端待处理交易…" else "云端待处理状态尚未核对，请刷新重试",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (state.items.isEmpty()) {
                ThewyjCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(ThewyjSpacing.Lg), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Xs)) {
                        Text("云端暂无待核实交易", fontWeight = FontWeight.SemiBold)
                        Text(
                            if (state.canonicalCurrent) "本次云端核对没有待处理交易。" else "这是上次核对结果，正在更新云端状态。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            val canonicalCount = state.items.count { !it.recoveryOnly }
            if (canonicalCount > 0) {
                Text("云端待确认 · $canonicalCount", style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold)
            }
            state.items.forEachIndexed { index, item ->
                val remainingMs = state.remainingMs(item)
                val ticketActive = item.ticketActive && remainingMs > 0
                if (item.recoveryOnly && (index == 0 || !state.items[index - 1].recoveryOnly)) {
                    Text(
                        "本机恢复 / 未同步（不计入云端待确认）",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                ThewyjCard(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.padding(ThewyjSpacing.Lg),
                        verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Xs),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(item.appLabel, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            Text(
                                stateLabel(item),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(
                            amountLine(item),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            sourceLine(item),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (item.canonicalIdentity.isNotBlank()) {
                            Text("核实标识：${item.canonicalIdentity}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (item.ocrSuggested) {
                            Text(
                                "OCR 金额仅供参考，请对照这笔付款或收款页面核实后手动确认；不会自动记账。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                        if (item.evidenceConflict) {
                            Text("本机与云端金额或方向不一致，请核对后编辑确认。" +
                                (item.localAmountMinor?.let { " 本机金额 ${uk.thewyj.app.finance.CurrencyMoney.format(it, item.localCurrency)}" } ?: ""),
                                color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        } else if (item.localEvidencePending) {
                            Text("本机已识别，等待同步；云端尚未确认。", style = MaterialTheme.typography.bodySmall)
                        }
                        if (ticketActive) {
                            Text(
                                "核实中：请打开「${item.appLabel}」中这笔转账、付款或收款页面并停留（剩余 ${(remainingMs / 1000).coerceAtLeast(0)} 秒）",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                        if (item.ticketActive && !ticketActive) Text("核实窗口已到期，可重新开始核实。", style = MaterialTheme.typography.bodySmall)
                        if (item.authority == PaymentVerificationCenter.Authority.NEEDS_AMOUNT && !ticketActive) {
                            Text(
                                "请停留在这笔交易的付款或收款页面；聊天中有多笔收款时不会选择其中一笔记账。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        syncLine(item)?.let { line ->
                            Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if(!item.hasEdits&&!item.remoteOnly&&state.aiRows.containsKey(item.recognitionId)){
                            val assistance=state.aiRows.getValue(item.recognitionId)
                            val ready=state.aiConsent&&assistance.status=="suggestion"
                            Text(when(assistance.status){"suggestion"->"AI已给出建议，仍须核对原证据";"review"->"AI仍无法确定，请人工核实";"timed_out","failed"->"AI暂不可用，原交易未改变";else->"可选AI辅助核对，不会自动写账"},style=MaterialTheme.typography.bodySmall)
                            state.aiSummary(item).takeIf(String::isNotBlank)?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
                            Row(horizontalArrangement=Arrangement.spacedBy(ThewyjSpacing.Sm)){
                                OutlinedButton(enabled=item.recognitionId !in state.aiBusy,onClick={if(state.aiConsent)scope.launch{state.requestAi(item)}else aiConsentItem=item}){Text(if(item.recognitionId in state.aiBusy)"分析中…" else if(state.aiConsent)"分析候选金额" else "启用AI建议")}
                                if(ready)OutlinedButton(onClick={scope.launch{state.adoptAi(item)}}){Text("核对建议")}
                            }
                            if(state.aiConsentGranted)TextButton(onClick={scope.launch{state.disableAi()}}){Text("停用AI建议")}
                        }
                        if (item.remoteOnly) {
                            Text(
                                "这笔云端待核实交易在本机没有对应识别记录，请在财务页处理。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            ThewyjPrimaryButton(text = { Text("在财务中处理") }, onClick = onOpenFinance)
                        } else if (state.editingRecognitionId == item.recognitionId) {
                            OutlinedTextField(
                                value = state.amountText,
                                onValueChange = { state.amountText = it.take(12) },
                                label = { Text("金额（${state.currency.ifBlank { "币种待核实" }}）") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                shape = ThewyjRadius.Medium,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text("原币币种：${state.currency.ifBlank { "待核实" }}")
                            if (item.currency !in uk.thewyj.app.finance.CurrencyMoney.digits) {
                                Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Xs)) {
                                    uk.thewyj.app.finance.CurrencyMoney.digits.keys.forEach { code ->
                                        TextButton(onClick = { state.currency = code; state.amountText = "" }) { Text(code) }
                                    }
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                                DirectionChoice("支出", state.direction == "EXPENSE") { state.direction = "EXPENSE" }
                                DirectionChoice("收入", state.direction == "INCOME") { state.direction = "INCOME" }
                                DirectionChoice("退款", state.direction == "REFUND") { state.direction = "REFUND" }
                            }
                            OutlinedTextField(
                                value = state.merchantText,
                                onValueChange = { state.merchantText = it.take(60) },
                                label = { Text("商户 / 对方") },
                                singleLine = true,
                                shape = ThewyjRadius.Medium,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                                ThewyjPrimaryButton(
                                    text = { Text("保存并记账") },
                                    onClick = { scope.launch { state.saveAndConfirm(item, confirm = true) } },
                                )
                                TextButton(onClick = { state.cancelEdit() }) { Text("取消") }
                            }
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                                if (item.ocrSuggested || item.evidenceConflict) {
                                    ThewyjPrimaryButton(
                                        text = { Text("核对金额并确认") },
                                        onClick = { state.beginEdit(item) },
                                    )
                                } else if (item.needsVerification) {
                                    ThewyjPrimaryButton(
                                        text = { Text(if (ticketActive) "重新核实" else "核实交易") },
                                        onClick = { scope.launch { state.startVerification(item) } },
                                    )
                                } else if (item.deviceBooks) {
                                    ThewyjPrimaryButton(
                                        text = { Text("确认记账") },
                                        onClick = { scope.launch { state.confirm(item) } },
                                    )
                                } else {
                                    // Amount-known captures were uploaded: the
                                    // Finance page owns confirmation, so this
                                    // never books a second transaction.
                                    ThewyjPrimaryButton(text = { Text("在财务中确认") }, onClick = onOpenFinance)
                                }
                                TextButton(onClick = { state.beginEdit(item) }) {
                                    Text(if (item.needsAmount) "填写金额" else "修改")
                                }
                                if (ticketActive) {
                                    TextButton(
                                        onClick = { scope.launch {
                                            if (onOpenApp(item)) {
                                                state.reportOpenAppStarted()
                                            } else {
                                                state.reportOpenAppFailure(item.appLabel)
                                            }
                                        } },
                                    ) { Text("打开应用") }
                                }
                            }
                            val ignoring = state.isBusy(item, "ignore")
                            TextButton(
                                onClick = { scope.launch { state.ignore(item) } },
                                enabled = !ignoring,
                            ) {
                                Text(if (ignoring) "正在忽略…" else "忽略这笔")
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(ThewyjSpacing.Xl))
        }
    }
}

@Composable
private fun DirectionChoice(label: String, selected: Boolean, onClick: () -> Unit) {
    if (selected) {
        ThewyjPrimaryButton(text = { Text(label) }, onClick = onClick)
    } else {
        OutlinedButton(onClick = onClick, shape = ThewyjRadius.Medium) { Text(label) }
    }
}

private fun stateLabel(item: PaymentVerificationCenter.Item): String = when {
    item.evidenceConflict -> "金额或方向待核对"
    item.localEvidencePending -> "本机已识别 · 待同步"
    item.canonicalIdentity.isNotBlank() && item.needsAmount -> "金额待核实"
    item.canonicalIdentity.isNotBlank() && item.direction == uk.thewyj.app.task21.FinanceDirection.UNKNOWN -> "方向待核实"
    item.canonicalIdentity.isNotBlank() -> "云端待确认"
    item.syncState == PaymentVerificationCenter.SyncState.SYNCED -> "已记录到财务"
    item.syncState == PaymentVerificationCenter.SyncState.UNRESOLVED_REMOTE -> "云端关联待核对"
    item.ocrSuggested -> "OCR 建议金额待核对"
    item.direction == uk.thewyj.app.task21.FinanceDirection.UNKNOWN && !item.needsAmount -> "方向待核实"
    item.needsAmount -> "金额待核实"
    item.syncState == PaymentVerificationCenter.SyncState.LOCAL_ONLY -> "仅本机待核对"
    item.authority == PaymentVerificationCenter.Authority.SERVER -> "等待在财务中确认"
    item.state == "ENRICHMENT_EXPIRED" -> "金额待核实"
    item.state == "ENRICHMENT_VERIFIED" -> "已核实金额"
    item.state == "VERIFICATION_FAILED" -> "核实失败"
    else -> "等待确认记账"
}

private fun amountLine(item: PaymentVerificationCenter.Item): String {
    if (item.moneyUnitReview) return item.observedAmountDecimal?.let { "候选金额 $it · 币种与单位待确认" } ?: "原币金额单位待核实，请重新填写"
    val amount = item.displayAmountMinor
    if (amount == null || amount <= 0) return item.observedAmountDecimal?.let { "候选金额 $it · 币种与单位待确认" } ?: "暂未识别到金额"
    val direction = when (item.displayDirection.name) {
        "INCOME" -> "收入"
        "REFUND" -> "退款"
        "EXPENSE" -> "支出"
        else -> ""
    }
    return "$direction ${uk.thewyj.app.finance.CurrencyMoney.format(amount, item.displayCurrency)}".trim() +
        if (item.currencyReviewRequired) " · 默认币种待核实" else ""
}

private fun sourceLine(item: PaymentVerificationCenter.Item): String {
    val time = if (item.occurredAtMs > 0L) java.text.SimpleDateFormat("MM-dd HH:mm:ss", java.util.Locale.CHINA)
        .format(java.util.Date(item.occurredAtMs)) else "时间待核对"
    val merchant = item.merchant.ifBlank { "未识别商户" }
    val edited = if (item.hasEdits) " · 已人工修正" else ""
    return "$time · $merchant$edited"
}

private fun syncLine(item: PaymentVerificationCenter.Item): String? = if (item.canonicalIdentity.isNotBlank()) null else when (item.syncState) {
    PaymentVerificationCenter.SyncState.SYNCED ->
        if (item.financeTransactionId.isNotBlank()) "财务流水号 ${item.financeTransactionId.take(18)}…" else "已记录到财务"
    PaymentVerificationCenter.SyncState.PENDING_SYNC -> "已保存在本机，等待同步到云端账本"
    PaymentVerificationCenter.SyncState.SYNC_FAILED -> "云端同步失败，数据仍保留在本机，可点击「同步记账」重试"
    PaymentVerificationCenter.SyncState.SYNC_REJECTED ->
        "云端拒绝这笔记账${if (item.notice.isNotBlank()) "（${item.notice}）" else ""}，数据仍保留在本机"
    PaymentVerificationCenter.SyncState.UNRESOLVED_REMOTE ->
        "云端没有对应的待确认记录，已保留本机原始记录；请核对来源，不会自动重复记账"
    PaymentVerificationCenter.SyncState.LOCAL_ONLY ->
        "仅保存在本机，尚未与云端候选关联；旧记录需核对后再确认，不会自动丢弃"
    PaymentVerificationCenter.SyncState.NONE -> null
}
