package uk.thewyj.app.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleResumeEffect
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.R
import uk.thewyj.app.core.auth.AccountSnapshot
import uk.thewyj.app.core.auth.AuthInputPolicy
import uk.thewyj.app.core.design.ThewyjCard
import uk.thewyj.app.core.design.ThewyjPrimaryButton
import uk.thewyj.app.core.design.ThewyjRadius
import uk.thewyj.app.core.design.ThewyjSpacing
import uk.thewyj.app.core.design.ThewyjTouch
import uk.thewyj.app.core.design.statusContainerColor
import uk.thewyj.app.core.design.statusContentColor
import uk.thewyj.app.core.session.ConnectionMode
import uk.thewyj.app.core.session.SessionState
import uk.thewyj.app.core.update.UpdateUiState
import uk.thewyj.app.core.web.ThewyjWebView

@Composable
fun ThewyjApp(viewModel: AppViewModel) {
    val session by viewModel.session.collectAsStateWithLifecycle()
    val destination by viewModel.destination.collectAsStateWithLifecycle()
    val webRoute by viewModel.webRoute.collectAsStateWithLifecycle()
    val webEpoch by viewModel.webEpoch.collectAsStateWithLifecycle()
    val navigationEpoch by viewModel.navigationEpoch.collectAsStateWithLifecycle()
    val notice by viewModel.notice.collectAsStateWithLifecycle()
    val updateState by viewModel.updateState.collectAsStateWithLifecycle()
    val authBusy by viewModel.authBusy.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val context = androidx.compose.ui.platform.LocalContext.current

    LifecycleResumeEffect(Unit) {
        viewModel.refreshUpdatePermission()
        onPauseOrDispose { }
    }

    LaunchedEffect(notice) {
        if (notice.isNotBlank()) {
            snackbar.showSnackbar(notice)
            viewModel.clearNotice()
        }
    }

    Box(Modifier.fillMaxSize()) {
        when (val current = session) {
            SessionState.Initializing -> LoadingScreen()
            is SessionState.StorageUnavailable -> Surface(Modifier.fillMaxSize()) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.Center) {
                    Text(current.message)
                    ThewyjPrimaryButton(text = { Text("重试恢复会话") }, onClick = viewModel::retryRestore)
                }
            }
            is SessionState.SignedOut -> AuthScreen(
                message = current.message,
                busy = authBusy,
                onLogin = viewModel::login,
                onRegister = viewModel::register,
            )
            is SessionState.Authenticated -> AuthenticatedShell(
                state = current,
                destination = destination,
                webRoute = webRoute,
                webEpoch = webEpoch,
                navigationEpoch = navigationEpoch,
                updateState = updateState,
                onDestination = viewModel::select,
                onOpenRoute = viewModel::openRoute,
                onWebRouteChanged = viewModel::onWebRouteChanged,
                onRefresh = viewModel::refreshSession,
                onLogout = viewModel::logout,
                onCheckUpdate = viewModel::checkForUpdate,
                onStartUpdate = viewModel::startUpdate,
                onInstallUpdate = {
                    viewModel.prepareInstall()?.let { intent ->
                        runCatching { context.startActivity(intent) }
                    }
                },
                onWebError = viewModel::setNotice,
            )
        }
        SnackbarHost(hostState = snackbar, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun LoadingScreen() {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(painterResource(R.drawable.ic_launcher), contentDescription = null, modifier = Modifier.size(72.dp))
            Spacer(Modifier.height(ThewyjSpacing.Lg))
            Text("thewyj", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(ThewyjSpacing.Lg))
            CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
            Spacer(Modifier.height(ThewyjSpacing.Md))
            Text("正在安全恢复会话", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun AuthScreen(
    message: String,
    busy: Boolean,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String) -> Unit,
) {
    var username by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }
    var registerMode by remember { mutableStateOf(false) }
    val valid = AuthInputPolicy.canSubmit(username, secret, registerMode)

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp, vertical = 40.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Image(painterResource(R.drawable.ic_launcher), contentDescription = null, modifier = Modifier.size(64.dp))
            Spacer(Modifier.height(ThewyjSpacing.Lg))
            Text("thewyj", style = MaterialTheme.typography.displaySmall)
            if (BuildConfig.DEBUG) {
                Text("测试环境：${Uri.parse(BuildConfig.THEWYJ_BASE_URL).host}", style = MaterialTheme.typography.bodySmall)
            }
            Text(
                "学习、工具、财务与分享，一个账户自然衔接。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyLarge,
            )
            Spacer(Modifier.height(ThewyjSpacing.Xl))
            ThewyjCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(ThewyjSpacing.Xl)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                        AuthModeButton("登录", !registerMode) { registerMode = false }
                        AuthModeButton("注册", registerMode) { registerMode = true }
                    }
                    Spacer(Modifier.height(ThewyjSpacing.Xl))
                    Text(
                        if (registerMode) "创建同一个 thewyj 账户" else "欢迎回来",
                        style = MaterialTheme.typography.titleLarge,
                    )
                    Spacer(Modifier.height(ThewyjSpacing.Lg))
                    OutlinedTextField(
                        value = username,
                        onValueChange = { if (it.length <= 40) username = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("用户名") },
                        singleLine = true,
                        shape = ThewyjRadius.Medium,
                    )
                    Spacer(Modifier.height(ThewyjSpacing.Md))
                    OutlinedTextField(
                        value = secret,
                        onValueChange = { if (it.length <= 128 && '\n' !in it && '\r' !in it) secret = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("登录密钥") },
                        supportingText = { Text(if (registerMode) "新密钥至少 7 个字符" else "输入现有密钥，仅用于本次验证") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                        shape = ThewyjRadius.Medium,
                    )
                    if (message.isNotBlank()) {
                        Spacer(Modifier.height(ThewyjSpacing.Md))
                        StatusPanel(message, "error")
                    }
                    Spacer(Modifier.height(ThewyjSpacing.Xl))
                    ThewyjPrimaryButton(
                        text = { Text(if (registerMode) "注册并登录" else "安全登录") },
                        onClick = {
                            if (registerMode) onRegister(username, secret) else onLogin(username, secret)
                        },
                        modifier = Modifier.fillMaxWidth().height(ThewyjTouch.Minimum),
                        enabled = valid && !busy,
                    )
                    Spacer(Modifier.height(ThewyjSpacing.Md))
                    Text(
                        "长期会话由 Android Keystore 保护。网络变化或短暂离线不会清除登录。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun AuthModeButton(label: String, selected: Boolean, onClick: () -> Unit) {
    if (selected) {
        ThewyjPrimaryButton(text = { Text(label) }, onClick = onClick)
    } else {
        OutlinedButton(onClick = onClick, shape = ThewyjRadius.Medium) { Text(label) }
    }
}

@Composable
private fun AuthenticatedShell(
    state: SessionState.Authenticated,
    destination: AppDestination,
    webRoute: String,
    webEpoch: Int,
    navigationEpoch: Int,
    updateState: UpdateUiState,
    onDestination: (AppDestination) -> Unit,
    onOpenRoute: (String) -> Unit,
    onWebRouteChanged: (String) -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    onCheckUpdate: () -> Unit,
    onStartUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onWebError: (String) -> Unit,
) {
    val activity = LocalActivity.current
    var backNavigationRequest by remember { mutableIntStateOf(0) }
    var overlays by remember { mutableStateOf(ShellOverlayState()) }
    BackHandler {
        if (overlays.anyVisible) overlays = ShellOverlayState()
        else if (destination == AppDestination.MY) onDestination(AppDestination.HOME)
        else backNavigationRequest += 1
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                AppDestination.entries.forEach { item ->
                    NavigationBarItem(
                        selected = destination == item,
                        onClick = {
                            val selection = bottomNavigationSelection(item, overlays)
                            overlays = selection.overlays
                            onDestination(selection.destination)
                        },
                        icon = { Icon(destinationIcon(item), contentDescription = null) },
                        label = { Text(item.label) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            ThewyjWebView(
                route = webRoute,
                navigationEpoch = navigationEpoch,
                sessionEpoch = webEpoch,
                backNavigationRequest = backNavigationRequest,
                onRefreshSession = onRefresh,
                onLogout = onLogout,
                onRouteChanged = onWebRouteChanged,
                onCanGoBackChanged = {},
                onMainFrameError = onWebError,
                onUnhandledBack = {
                    if (destination != AppDestination.HOME) onDestination(AppDestination.HOME)
                    else activity?.moveTaskToBack(true)
                },
            )
            if (destination == AppDestination.MY) {
                MyScreen(
                    account = state.account,
                    mode = state.mode,
                    message = state.message,
                    updateState = updateState,
                    onOpenRoute = onOpenRoute,
                    onOpenNotifications = { onDestination(AppDestination.NOTIFICATIONS) },
                    onOpenTransfer = { overlays = overlays.copy(transfer = true) },
                    onOpenPermissions = { overlays = overlays.copy(permissions = true) },
                    onRefresh = onRefresh,
                    onCheckUpdate = onCheckUpdate,
                    onStartUpdate = onStartUpdate,
                    onInstallUpdate = onInstallUpdate,
                    onLogout = onLogout,
                )
            } else if (destination == AppDestination.NOTIFICATIONS) {
                NotificationHubScreen(
                    account = state.account,
                    onOpenPermissions = { overlays = overlays.copy(permissions = true) },
                    onOpenFinance = { onOpenRoute("/finance") },
                    modifier = Modifier.fillMaxSize(),
                )
            } else if (state.mode != ConnectionMode.ONLINE) {
                StatusPanel(
                    text = state.message.ifBlank { "当前离线，本地功能仍可使用" },
                    kind = "warning",
                    modifier = Modifier.fillMaxWidth().padding(ThewyjSpacing.Md),
                )
            }
            if (overlays.archive) {
                NotificationArchiveScreen(
                    account = state.account,
                    onBack = { overlays = overlays.copy(archive = false) },
                )
            }
            if (overlays.transfer) {
                TransferScreen(
                    account = state.account,
                    onBack = { overlays = overlays.copy(transfer = false) },
                )
            }
            if (overlays.permissions) {
                PermissionCenterScreen(onBack = { overlays = overlays.copy(permissions = false) })
            }
        }
    }
}

@Composable
private fun MyScreen(
    account: AccountSnapshot,
    mode: ConnectionMode,
    message: String,
    updateState: UpdateUiState,
    onOpenRoute: (String) -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenTransfer: () -> Unit,
    onOpenPermissions: () -> Unit,
    onRefresh: () -> Unit,
    onCheckUpdate: () -> Unit,
    onStartUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onLogout: () -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(ThewyjSpacing.Lg),
            verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Lg),
        ) {
            Column {
                Text("我的", style = MaterialTheme.typography.headlineMedium)
                Text("同一个账户，连接 thewyj.uk 的全部服务", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            ThewyjCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(ThewyjSpacing.Xl)) {
                    Text(account.username, style = MaterialTheme.typography.titleLarge)
                    Text(
                        account.membershipLabel.ifBlank { "普通用户" },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(ThewyjSpacing.Md))
                    StatusPanel(
                        text = when (mode) {
                            ConnectionMode.ONLINE -> "账户与云端已连接"
                            ConnectionMode.OFFLINE -> message.ifBlank { "离线模式，登录状态已保留" }
                            ConnectionMode.RECOVERING -> "正在恢复连接"
                        },
                        kind = if (mode == ConnectionMode.ONLINE) "success" else "warning",
                    )
                }
            }
            ThewyjCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(ThewyjSpacing.Lg)) {
                    SettingsAction("账户设置", "修改密钥、会话与账户资料") { onOpenRoute("/account") }
                    HorizontalDivider()
                    SettingsAction("会员与充值", "查看合并权益与服务端套餐") { onOpenRoute("/recharge") }
                    if (account.isAdmin) {
                        HorizontalDivider()
                        SettingsAction("管理后台", "角色、消息、订单与审计") { onOpenRoute("/admin") }
                    }
                }
            }
            ThewyjCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(ThewyjSpacing.Lg)) {
                    Text("Android 能力", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "后台会话维护已启用，低频运行且仅在联网时执行。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    SettingsAction("通知保存", "通知权限、本机历史与自动记账候选") { onOpenNotifications() }
                    HorizontalDivider()
                    SettingsAction("文件传输", "SAF 大文件分片上传、续传与链接分享") { onOpenTransfer() }
                    HorizontalDivider()
                    SettingsAction("权限中心", "通知访问、无障碍、短信与安装权限的逐项说明") { onOpenPermissions() }
                }
            }
            AppUpdateCard(
                updateState = updateState,
                onCheckUpdate = onCheckUpdate,
                onStartUpdate = onStartUpdate,
                onInstallUpdate = onInstallUpdate,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                OutlinedButton(onClick = onRefresh, shape = ThewyjRadius.Medium) { Text("立即同步会话") }
                OutlinedButton(
                    onClick = onLogout,
                    shape = ThewyjRadius.Medium,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("退出登录") }
            }
            Spacer(Modifier.height(ThewyjSpacing.Lg))
        }
    }
}

@Composable
private fun SettingsAction(title: String, subtitle: String, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(vertical = ThewyjSpacing.Md),
    ) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.Start) {
            Text(title, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
            Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/**
 * Real in-app update flow: check, download with progress, SHA-256 verification,
 * then the official Android package installer (or the "install unknown apps"
 * settings screen when that permission is missing).
 */
@Composable
private fun AppUpdateCard(
    updateState: UpdateUiState,
    onCheckUpdate: () -> Unit,
    onStartUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
) {
    val busy = updateState is UpdateUiState.Checking ||
        updateState is UpdateUiState.Downloading ||
        updateState is UpdateUiState.Verifying
    ThewyjCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(ThewyjSpacing.Xl), verticalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
            Text("App 更新", style = MaterialTheme.typography.titleMedium)
            Text(
                "当前 ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val detail = when (updateState) {
                is UpdateUiState.UpToDate -> "当前已是最新版。"
                is UpdateUiState.Available ->
                    "新版本 v${updateState.versionName} (${updateState.versionCode})" +
                        if (updateState.notes.isNotBlank()) "\n更新说明：${updateState.notes}" else ""
                is UpdateUiState.NeedsInstallPermission ->
                    "请先允许 thewyj 安装应用；返回应用后继续更新流程。"
                is UpdateUiState.ReadyToInstall -> "安装包已通过 SHA-256 校验，即将打开系统安装器。"
                is UpdateUiState.Failed -> updateState.message
                else -> "更新使用官网正式地址，下载完成后由 Android 系统安装器确认安装。"
            }
            Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
            when (updateState) {
                is UpdateUiState.Downloading -> LinearProgressIndicator(
                    progress = { updateState.percent / 100f },
                    modifier = Modifier.fillMaxWidth(),
                )
                is UpdateUiState.Verifying -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                else -> Unit
            }
            Row(horizontalArrangement = Arrangement.spacedBy(ThewyjSpacing.Sm)) {
                OutlinedButton(onClick = onCheckUpdate, shape = ThewyjRadius.Medium, enabled = !busy) {
                    Text("检查更新")
                }
                when (updateState) {
                    is UpdateUiState.Available -> ThewyjPrimaryButton(
                        text = { Text("下载并安装") },
                        onClick = onStartUpdate,
                    )
                    is UpdateUiState.ReadyToInstall -> ThewyjPrimaryButton(
                        text = { Text("打开系统安装器") },
                        onClick = onInstallUpdate,
                    )
                    is UpdateUiState.NeedsInstallPermission -> ThewyjPrimaryButton(
                        text = { Text("去允许安装") },
                        onClick = onInstallUpdate,
                    )
                    else -> Unit
                }
            }
        }
    }
}

@Composable
private fun StatusPanel(text: String, kind: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        color = statusContainerColor(MaterialTheme.colorScheme, kind),
        contentColor = statusContentColor(MaterialTheme.colorScheme, kind),
        shape = ThewyjRadius.Medium,
    ) {
        Text(text, modifier = Modifier.padding(horizontal = ThewyjSpacing.Md, vertical = ThewyjSpacing.Sm))
    }
}

private fun destinationIcon(destination: AppDestination): ImageVector = when (destination) {
    AppDestination.HOME -> Icons.Default.Home
    AppDestination.LEARNING -> Icons.Default.Edit
    AppDestination.TOOLS -> Icons.Default.Build
    AppDestination.FINANCE -> Icons.AutoMirrored.Filled.List
    AppDestination.NOTIFICATIONS -> Icons.Default.Email
    AppDestination.MY -> Icons.Default.Person
}
