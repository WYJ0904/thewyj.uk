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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import kotlinx.coroutines.launch
import uk.thewyj.app.core.design.ThewyjCard
import uk.thewyj.app.core.design.ThewyjPrimaryButton
import uk.thewyj.app.core.design.ThewyjRadius
import uk.thewyj.app.core.design.ThewyjSpacing
import uk.thewyj.app.core.design.statusContainerColor
import uk.thewyj.app.core.design.statusContentColor
import uk.thewyj.app.task21.payment.PaymentVerificationCenter

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
    onOpenApp: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) { state.refresh() }
    // Countdown display only; no background polling of Room or the network.
    LaunchedEffect(tick, state.items.size) {
        if (state.items.any { it.ticketActive }) {
            kotlinx.coroutines.delay(1_000)
            tick += 1
        }
    }

    BackHandler(enabled = true) { onBack() }
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
                "识别到的支付会先到这里。金额不足时可在 90 秒内打开来源应用自动核实，也可以直接填写金额后记账。",
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
            Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                TextButton(onClick = { scope.launch { state.refresh() } }) { Text("刷新") }
                TextButton(onClick = { scope.launch { state.flush() } }) { Text("同步记账") }
                TextButton(onClick = onOpenFinance) { Text("打开财务") }
            }
            if (state.loading && state.items.isEmpty()) {
                Text("正在读取待确认交易…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (state.items.isEmpty()) {
                ThewyjCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(ThewyjSpacing.Lg), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Xs)) {
                        Text("没有待确认的交易", fontWeight = FontWeight.SemiBold)
                        Text(
                            "识别到的支付确认后会直接写入财务账本；这里为空说明没有遗漏。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            state.items.forEach { item ->
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
                        if (item.ticketActive) {
                            Text(
                                "核实中：请现在打开「${item.appLabel}」并停留在这笔交易的详情页（剩余 ${(item.remainingMs / 1000).coerceAtLeast(0)} 秒）",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                        if (item.authority == PaymentVerificationCenter.Authority.NEEDS_AMOUNT && !item.ticketActive) {
                            Text(
                                "若「${item.appLabel}」不向系统提供页面文字（例如微信），自动核实会失败，请用「填写金额」手动记账。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        syncLine(item)?.let { line ->
                            Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (state.editingRecognitionId == item.recognitionId) {
                            OutlinedTextField(
                                value = state.amountText,
                                onValueChange = { state.amountText = it.take(12) },
                                label = { Text("金额（元）") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                shape = ThewyjRadius.Medium,
                                modifier = Modifier.fillMaxWidth(),
                            )
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
                                if (item.needsAmount) {
                                    ThewyjPrimaryButton(
                                        text = { Text(if (item.ticketActive) "重新核实" else "核实交易金额") },
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
                                if (item.ticketActive) {
                                    TextButton(onClick = { onOpenApp(item.sourcePackage) }) { Text("打开应用") }
                                }
                            }
                            TextButton(onClick = { scope.launch { state.ignore(item) } }) { Text("忽略这笔") }
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
    item.syncState == PaymentVerificationCenter.SyncState.SYNCED -> "已记录到财务"
    item.authority == PaymentVerificationCenter.Authority.SERVER -> "等待在财务中确认"
    item.state == "ENRICHMENT_EXPIRED" -> "金额待核实"
    item.state == "ENRICHMENT_VERIFIED" -> "已核实金额"
    item.state == "VERIFICATION_FAILED" -> "核实失败"
    item.needsAmount -> "金额待核实"
    else -> "等待确认记账"
}

private fun amountLine(item: PaymentVerificationCenter.Item): String {
    val amount = item.amountMinor
    if (amount == null || amount <= 0) return "暂未识别到金额"
    val direction = when (item.direction.name) {
        "INCOME" -> "收入"
        "REFUND" -> "退款"
        "EXPENSE" -> "支出"
        else -> ""
    }
    return "$direction ¥${PaymentVerificationState.formatMinor(amount)}".trim()
}

private fun sourceLine(item: PaymentVerificationCenter.Item): String {
    val time = java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.CHINA)
        .format(java.util.Date(item.occurredAtMs))
    val merchant = item.merchant.ifBlank { "未识别商户" }
    val edited = if (item.hasEdits) " · 已人工修正" else ""
    return "$time · $merchant$edited"
}

private fun syncLine(item: PaymentVerificationCenter.Item): String? = when (item.syncState) {
    PaymentVerificationCenter.SyncState.SYNCED ->
        if (item.financeTransactionId.isNotBlank()) "财务流水号 ${item.financeTransactionId.take(18)}…" else "已记录到财务"
    PaymentVerificationCenter.SyncState.PENDING_SYNC -> "已保存在本机，等待同步到云端账本"
    PaymentVerificationCenter.SyncState.SYNC_FAILED -> "云端同步失败，数据仍保留在本机，可点击「同步记账」重试"
    PaymentVerificationCenter.SyncState.LOCAL_ONLY -> null
    PaymentVerificationCenter.SyncState.NONE -> null
}
