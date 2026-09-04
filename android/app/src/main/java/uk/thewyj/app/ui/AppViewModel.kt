package uk.thewyj.app.ui

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
import uk.thewyj.app.core.web.NavigationDecision
import uk.thewyj.app.core.web.WebRoutePolicy

enum class AppDestination(val label: String, val route: String?) {
    HOME("主页", "/select"),
    LEARNING("学习", "/language"),
    TOOLS("工具", "/tools"),
    FINANCE("财务", "/finance"),
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

    private val mutableWebEpoch = MutableStateFlow(0)
    val webEpoch = mutableWebEpoch.asStateFlow()

    private val mutableNotice = MutableStateFlow("")
    val notice = mutableNotice.asStateFlow()

    private val mutableUpdate = MutableStateFlow<AppConfig?>(null)
    val update = mutableUpdate.asStateFlow()

    private val mutableAuthBusy = MutableStateFlow(false)
    val authBusy = mutableAuthBusy.asStateFlow()
    private var refreshJob: Job? = null
    private var networkRecoveryJob: Job? = null

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
                mutableWebEpoch.value += 1
                mutableNotice.value = "连接已恢复"
            }
        }
    }

    fun onNetworkAvailable() {
        val current = repository.state.value
        if (current !is SessionState.Authenticated) return
        if (networkRecoveryJob?.isActive == true) return
        networkRecoveryJob = viewModelScope.launch {
            repository.restore()
            if (repository.state.value is SessionState.Authenticated) mutableWebEpoch.value += 1
        }
    }

    fun select(destination: AppDestination) {
        mutableDestination.value = destination
        destination.route?.let { mutableWebRoute.value = it }
    }

    fun openRoute(route: String) {
        val normalized = if (route.startsWith('/')) route else "/$route"
        mutableWebRoute.value = normalized
        mutableDestination.value = destinationForRoute(normalized)
    }

    fun onWebRouteChanged(url: String) {
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return
        if (webRoutePolicy.decide(url) != NavigationDecision.Internal) return
        val route = uri.rawPath.orEmpty().ifBlank { "/" } + uri.rawQuery?.let { "?$it" }.orEmpty()
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
        viewModelScope.launch {
            when (val result = repository.appConfig()) {
                is ApiCall.Success -> {
                    mutableUpdate.value = result.value
                    mutableNotice.value = if (result.value.latestVersionCode > BuildConfig.VERSION_CODE) {
                        "发现新版本 ${result.value.latestVersionName}"
                    } else {
                        "当前已是最新版本"
                    }
                }
                is ApiCall.Failure -> mutableNotice.value = result.message
            }
        }
    }
}
