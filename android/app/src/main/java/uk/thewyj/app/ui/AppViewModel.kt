package uk.thewyj.app.ui

import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import uk.thewyj.app.AppGraph
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.core.network.ApiCall
import uk.thewyj.app.core.network.AppConfig
import uk.thewyj.app.core.session.RefreshWorkResult
import uk.thewyj.app.core.session.SessionState
import uk.thewyj.app.core.session.ConnectionMode
import uk.thewyj.app.core.update.UpdateFlow
import uk.thewyj.app.core.update.UpdateUiState
import uk.thewyj.app.core.web.NavigationDecision
import uk.thewyj.app.core.web.WebRoutePolicy

enum class AppDestination(val label: String, val route: String?) {
    HOME("主页", "/select"),
    LEARNING("学习", "/language"),
    TOOLS("工具", "/tools"),
    FINANCE("财务", "/finance"),
    NOTIFICATIONS("通知", null),
    MY("我的", null),
}

fun destinationForRoute(route: String): AppDestination = when {
    route.startsWith("/language") -> AppDestination.LEARNING
    route.startsWith("/tools") -> AppDestination.TOOLS
    route.startsWith("/finance") -> AppDestination.FINANCE
    else -> AppDestination.HOME
}

class AppViewModel : ViewModel() {
    private val repository = AppGraph.sessionRepository
    private val webRoutePolicy = WebRoutePolicy(BuildConfig.THEWYJ_BASE_URL)
    val session: StateFlow<SessionState> = repository.state

    private val mutableDestination = MutableStateFlow(AppDestination.HOME)
    val destination = mutableDestination.asStateFlow()

    private val mutableWebRoute = MutableStateFlow(AppDestination.HOME.route!!)
    val webRoute = mutableWebRoute.asStateFlow()

    val webEpoch = repository.webSessionEpoch
    private val mutableNavigationEpoch = MutableStateFlow(0)
    val navigationEpoch = mutableNavigationEpoch.asStateFlow()

    private val mutableNotice = MutableStateFlow("")
    val notice = mutableNotice.asStateFlow()

    /** Resolved web theme; null until the page reports it. */
    private val mutableNativeDark = MutableStateFlow<Boolean?>(null)
    val nativeDark = mutableNativeDark.asStateFlow()

    fun onWebThemeChanged(dark: Boolean) {
        mutableNativeDark.value = dark
    }

    private val updateInstaller = AppGraph.updateInstaller
    private val mutableUpdateState = MutableStateFlow<UpdateUiState>(UpdateUiState.Idle)
    val updateState = mutableUpdateState.asStateFlow()
    private var latestConfig: AppConfig? = null

    private val mutableAuthBusy = MutableStateFlow(false)
    val authBusy = mutableAuthBusy.asStateFlow()
    private var refreshJob: Job? = null
    private var networkRecoveryJob: Job? = null
    private var updateJob: Job? = null

    init {
        viewModelScope.launch { repository.restore() }
    }

    fun login(username: String, secret: String) {
        if (mutableAuthBusy.value) return
        viewModelScope.launch {
            mutableAuthBusy.value = true
            try { repository.login(username, secret) } finally { mutableAuthBusy.value = false }
        }
    }

    fun register(username: String, secret: String) {
        if (mutableAuthBusy.value) return
        viewModelScope.launch {
            mutableAuthBusy.value = true
            try { repository.register(username, secret) } finally { mutableAuthBusy.value = false }
        }
    }

    fun logout() {
        viewModelScope.launch { repository.logout() }
    }

    fun refreshSession() {
        if (refreshJob?.isActive == true) return
        refreshJob = viewModelScope.launch {
            if (repository.refresh() == RefreshWorkResult.SUCCESS) {
                mutableNotice.value = "连接已恢复"
            }
        }
    }

    fun onNetworkAvailable() {
        val current = repository.state.value
        if (current !is SessionState.Authenticated) return
        if (current.mode == ConnectionMode.ONLINE) return
        if (networkRecoveryJob?.isActive == true) return
        networkRecoveryJob = viewModelScope.launch {
            repository.restore()
        }
    }

    fun select(destination: AppDestination) {
        mutableDestination.value = destination
        destination.route?.let(::requestRoute)
    }

    fun openRoute(route: String) {
        val normalized = if (route.startsWith('/')) route else "/$route"
        requestRoute(normalized)
        mutableDestination.value = destinationForRoute(normalized)
    }

    fun retryRestore() {
        viewModelScope.launch { repository.restore() }
    }

    private fun requestRoute(route: String) {
        if (mutableWebRoute.value == route) return
        mutableWebRoute.value = route
        mutableNavigationEpoch.value += 1
    }

    fun onWebRouteChanged(url: String) {
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return
        if (webRoutePolicy.decide(url) != NavigationDecision.Internal) return
        val route = uri.rawPath.orEmpty().ifBlank { "/" } + uri.rawQuery?.let { "?$it" }.orEmpty() +
            uri.rawFragment?.let { "#$it" }.orEmpty()
        mutableWebRoute.value = route
        mutableDestination.value = destinationForRoute(route)
    }

    fun setNotice(message: String) {
        mutableNotice.value = message
    }

    fun clearNotice() {
        mutableNotice.value = ""
    }

    fun checkForUpdate() {
        if (updateJob?.isActive == true) return
        updateJob = viewModelScope.launch {
            mutableUpdateState.value = UpdateUiState.Checking
            when (val result = repository.appConfig()) {
                is ApiCall.Success -> {
                    latestConfig = result.value
                    mutableUpdateState.value = UpdateFlow.checkResult(
                        BuildConfig.VERSION_CODE,
                        BuildConfig.VERSION_NAME,
                        result.value,
                    )
                }
                is ApiCall.Failure -> {
                    mutableUpdateState.value = UpdateUiState.Failed(result.message)
                    mutableNotice.value = result.message
                }
            }
        }
    }

    /** Downloads the official APK and verifies the published SHA-256. */
    fun startUpdate() {
        val config = latestConfig ?: return
        if (updateJob?.isActive == true) return
        updateJob = viewModelScope.launch {
            try {
                if (!updateInstaller.canInstallPackages()) {
                    mutableUpdateState.value = UpdateUiState.NeedsInstallPermission(config.latestVersionName)
                    return@launch
                }
                val downloadId = updateInstaller.enqueueDownload(config)
                val completed = updateInstaller.awaitDownload(downloadId) { progress ->
                    mutableUpdateState.value = progress
                }
                if (!completed) {
                    mutableUpdateState.value = UpdateFlow.downloadFailed("安装包下载失败，请检查网络后重试。")
                    return@launch
                }
                mutableUpdateState.value = UpdateUiState.Verifying(config.latestVersionName)
                val verified = updateInstaller.verify(config)
                mutableUpdateState.value = UpdateFlow.afterDownload(
                    config.latestVersionName,
                    updateInstaller.canInstallPackages(),
                    verified,
                )
            } catch (error: Throwable) {
                mutableUpdateState.value = UpdateFlow.downloadFailed(error.message.orEmpty())
            }
        }
    }

    /**
     * Opens the Android package installer, or the "install unknown apps"
     * settings screen when that permission is still missing. The caller starts
     * the returned intent.
     */
    fun prepareInstall(): Intent? {
        val config = latestConfig ?: return null
        if (!updateInstaller.canInstallPackages()) {
            mutableUpdateState.value = UpdateUiState.NeedsInstallPermission(config.latestVersionName)
            return updateInstaller.installPermissionIntent()
        }
        mutableUpdateState.value = UpdateUiState.ReadyToInstall(config.latestVersionName)
        return updateInstaller.installIntent(config)
    }

    /** Re-reads the install permission after the user returns from settings. */
    fun refreshUpdatePermission() {
        val config = latestConfig ?: return
        if (mutableUpdateState.value is UpdateUiState.NeedsInstallPermission && updateInstaller.canInstallPackages()) {
            mutableUpdateState.value = UpdateFlow.afterDownload(config.latestVersionName, true, verified = true)
        }
    }

}
