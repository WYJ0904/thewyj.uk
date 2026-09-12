package uk.thewyj.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import uk.thewyj.app.core.design.ThewyjCard
import uk.thewyj.app.core.design.ThewyjPrimaryButton
import uk.thewyj.app.core.design.ThewyjRadius
import uk.thewyj.app.core.design.ThewyjSpacing
import uk.thewyj.app.core.permission.AppPermissionId
import uk.thewyj.app.core.permission.AppPermissionState
import uk.thewyj.app.core.permission.PermissionCenter
import uk.thewyj.app.core.permission.PermissionKind

/**
 * One place that explains every device capability, what is missing, why the
 * app needs it and which system screen fixes it. States are re-read on resume
 * and after each settings round trip, and granted entries never nag again.
 */
@Composable
fun PermissionCenterScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    var states by remember { mutableStateOf(PermissionCenter.states(context)) }
    fun refresh() {
        states = PermissionCenter.states(context)
    }
    val runtimeLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        refresh()
    }
    val settingsLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        refresh()
    }
    LifecycleResumeEffect(Unit) {
        refresh()
        onPauseOrDispose { }
    }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(ThewyjSpacing.Lg),
            verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Md),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Md)) {
                    OutlinedButton(onClick = onBack, shape = ThewyjRadius.Medium) { Text("返回") }
                    Column {
                        Text("权限中心", style = MaterialTheme.typography.headlineMedium)
                        Text(
                            "逐项说明缺什么、为什么需要、点哪里处理。",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            item { PermissionSummary(states) }
            items(states, key = { it.id.name }) { state ->
                PermissionCard(
                    state = state,
                    onRequestRuntime = {
                        val permissions = PermissionCenter.runtimePermissionsFor(state.id)
                        if (permissions.isNotEmpty()) runtimeLauncher.launch(permissions) else refresh()
                    },
                    onOpenSettings = {
                        PermissionCenter.settingsIntent(context, state.id)?.let { settingsLauncher.launch(it) } ?: refresh()
                    },
                    onOpenAppInfo = { settingsLauncher.launch(PermissionCenter.appDetailsIntent(context)) },
                )
            }
            item {
                Text(
                    "thewyj 不会绕过 Android 安全机制：通知访问、无障碍和安装未知应用都必须由你在系统界面中确认。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            item { Spacer(Modifier.height(ThewyjSpacing.Lg)) }
        }
    }
}

@Composable
private fun PermissionSummary(states: List<AppPermissionState>) {
    val missing = states.filter { !it.granted && it.kind != PermissionKind.OPTIONAL_SETTINGS }
    ThewyjCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(ThewyjSpacing.Lg), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Xs)) {
            Text(
                if (missing.isEmpty()) "所有必需权限都已开启" else "还有 ${missing.size} 项需要处理",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                if (missing.isEmpty()) {
                    "通知保存与财务识别可以完整运行。返回应用后会自动重新检查。"
                } else {
                    "缺少：" + missing.joinToString("、") { it.title }
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun PermissionCard(
    state: AppPermissionState,
    onRequestRuntime: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenAppInfo: () -> Unit,
) {
    ThewyjCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(ThewyjSpacing.Lg), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    state.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                StatusPill(state)
            }
            Text(state.purpose, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (state.restrictedHint.isNotBlank()) {
                Text(
                    state.restrictedHint,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                if (state.granted) {
                    OutlinedButton(onClick = onOpenSettings, shape = ThewyjRadius.Medium) { Text("查看系统设置") }
                } else if (state.kind == PermissionKind.RUNTIME) {
                    ThewyjPrimaryButton(text = { Text(state.actionLabel) }, onClick = onRequestRuntime)
                } else {
                    ThewyjPrimaryButton(text = { Text(state.actionLabel) }, onClick = onOpenSettings)
                }
                if (state.restrictedSettingsRisk && !state.granted) {
                    OutlinedButton(onClick = onOpenAppInfo, shape = ThewyjRadius.Medium) { Text("允许受限设置") }
                }
            }
        }
    }
}

@Composable
private fun StatusPill(state: AppPermissionState) {
    val (container, content) = when {
        state.granted -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        state.kind == PermissionKind.OPTIONAL_SETTINGS ->
            MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
    }
    Surface(color = container, contentColor = content, shape = ThewyjRadius.Large) {
        Text(
            state.statusText,
            modifier = Modifier.padding(horizontal = ThewyjSpacing.Md, vertical = ThewyjSpacing.Xs),
            style = MaterialTheme.typography.labelLarge,
            maxLines = 1,
            softWrap = false,
        )
    }
}
