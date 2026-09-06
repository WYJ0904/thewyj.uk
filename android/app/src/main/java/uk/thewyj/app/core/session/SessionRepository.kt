package uk.thewyj.app.core.session

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import uk.thewyj.app.core.auth.CredentialStore
import uk.thewyj.app.core.auth.CredentialStorageException
import uk.thewyj.app.core.auth.DeviceCredentials
import uk.thewyj.app.core.auth.DeviceIdentity
import uk.thewyj.app.core.auth.PendingLogout
import uk.thewyj.app.core.network.AccountApi
import uk.thewyj.app.core.network.ApiCall
import uk.thewyj.app.core.network.ApiFailureKind
import uk.thewyj.app.core.network.AppConfig
import uk.thewyj.app.core.web.WebSessionController
import uk.thewyj.app.core.web.WebSessionException
import java.util.UUID

class SessionRepository(
    private val store: CredentialStore,
    private val deviceIdentity: DeviceIdentity,
    private val api: AccountApi,
    private val webSession: WebSessionController,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()
    private val mutableState = MutableStateFlow<SessionState>(SessionState.Initializing)
    val state: StateFlow<SessionState> = mutableState.asStateFlow()
    private val mutableWebSessionEpoch = MutableStateFlow(0)
    val webSessionEpoch = mutableWebSessionEpoch.asStateFlow()

    suspend fun restore() = guarded(Unit) { mutex.withLock {
        flushPendingLogout()
        val credentials = store.loadActive()
        when (StartupPolicy.choose(
            hasCredentials = credentials != null,
            accessExpiresAt = credentials?.accessExpiresAtEpochMs ?: 0L,
            refreshExpiresAt = credentials?.refreshExpiresAtEpochMs ?: 0L,
            now = now(),
        )) {
            StartupAction.SIGNED_OUT -> mutableState.value = SessionState.SignedOut()
            StartupAction.REAUTHENTICATE -> terminate("登录有效期已结束，请重新登录")
            StartupAction.REFRESH_ACCESS -> refreshLocked(credentials!!)
            StartupAction.VERIFY_ACCESS -> verifyLocked(credentials!!)
        }
    } }

    suspend fun login(username: String, secret: String) = guarded(Unit) { mutex.withLock {
        flushPendingLogout()
        when (val result = api.login(username.trim(), secret, deviceIdentity.getOrCreate())) {
            is ApiCall.Success -> activate(result.value)
            is ApiCall.Failure -> mutableState.value = SessionState.SignedOut(result.message)
        }
    } }

    suspend fun register(username: String, secret: String) = guarded(Unit) { mutex.withLock {
        flushPendingLogout()
        when (val result = api.register(username.trim(), secret)) {
            is ApiCall.Success -> when (val login = api.login(username.trim(), secret, deviceIdentity.getOrCreate())) {
                is ApiCall.Success -> activate(login.value)
                is ApiCall.Failure -> mutableState.value = SessionState.SignedOut(login.message)
            }
            is ApiCall.Failure -> mutableState.value = SessionState.SignedOut(result.message)
        }
    } }

    suspend fun refresh(): RefreshWorkResult = guarded(RefreshWorkResult.RETRY) { mutex.withLock {
        val credentials = store.loadActive()
            ?: return@withLock RefreshWorkResult.SIGNED_OUT.also {
                mutableState.value = SessionState.SignedOut()
            }
        refreshLocked(credentials)
    } }

    suspend fun logout() = guarded(Unit) { mutex.withLock {
        val credentials = store.loadActive()
        val deviceId = deviceIdentity.getOrCreate()
        if (credentials != null) {
            store.savePendingLogout(PendingLogout(credentials.refreshToken, deviceId))
            api.logout(credentials.refreshToken, credentials.accessToken, deviceId).also {
                if (!it.shouldRetry()) store.clearPendingLogout()
            }
        }
        store.clearActive()
        webSession.clearAccountData()
        mutableState.value = SessionState.SignedOut()
    } }

    private suspend fun <T> guarded(fallback: T, action: suspend () -> T): T = try {
        action()
    } catch (error: CredentialStorageException) {
        mutableState.value = SessionState.StorageUnavailable(error.message.orEmpty())
        fallback
    } catch (error: WebSessionException) {
        mutableState.value = SessionState.StorageUnavailable(error.message.orEmpty())
        fallback
    }

    suspend fun appConfig(): ApiCall<AppConfig> = api.appConfig()

    private suspend fun verifyLocked(credentials: DeviceCredentials): RefreshWorkResult {
        webSession.installAccessCookie(credentials.accessToken, credentials.accessExpiresAtEpochMs)
        return when (val result = api.currentAccount(credentials.accessToken)) {
            is ApiCall.Success -> {
                activate(credentials.copy(account = result.value))
                RefreshWorkResult.SUCCESS
            }
            is ApiCall.Failure -> when (result.kind) {
                ApiFailureKind.RETRYABLE -> {
                    mutableState.value = SessionState.Authenticated(
                        credentials.account,
                        ConnectionMode.OFFLINE,
                        result.message,
                    )
                    RefreshWorkResult.RETRY
                }
                ApiFailureKind.AUTHENTICATION -> refreshLocked(credentials)
                ApiFailureKind.VALIDATION -> {
                    mutableState.value = SessionState.Authenticated(
                        credentials.account,
                        ConnectionMode.RECOVERING,
                        result.message,
                    )
                    RefreshWorkResult.RETRY
                }
            }
        }
    }

    private suspend fun refreshLocked(original: DeviceCredentials): RefreshWorkResult {
        if (original.refreshExpiresAtEpochMs <= now()) {
            terminate("登录有效期已结束，请重新登录")
            return RefreshWorkResult.SIGNED_OUT
        }
        // A cold-start WebView must not request authentication before its cookie exists.
        if (mutableState.value is SessionState.Authenticated) {
            mutableState.value = SessionState.Authenticated(
                original.account,
                ConnectionMode.RECOVERING,
                "正在恢复连接",
            )
        }
        val rotationKey = original.pendingRotationKey.ifBlank { UUID.randomUUID().toString() }
        val pending = original.copy(pendingRotationKey = rotationKey)
        store.saveActive(pending)
        return when (val result = api.refresh(pending, deviceIdentity.getOrCreate(), rotationKey)) {
            is ApiCall.Success -> {
                activate(result.value.copy(pendingRotationKey = ""))
                RefreshWorkResult.SUCCESS
            }
            is ApiCall.Failure -> when (result.kind) {
                ApiFailureKind.RETRYABLE, ApiFailureKind.VALIDATION -> {
                    mutableState.value = SessionState.Authenticated(
                        original.account,
                        ConnectionMode.OFFLINE,
                        result.message,
                    )
                    RefreshWorkResult.RETRY
                }
                ApiFailureKind.AUTHENTICATION -> {
                    terminate(result.message)
                    RefreshWorkResult.SIGNED_OUT
                }
            }
        }
    }

    private suspend fun activate(credentials: DeviceCredentials) {
        val previous = store.loadActive()
        if (previous != null && previous.account.id != credentials.account.id) {
            webSession.clearAccountData()
        }
        store.saveActive(credentials)
        webSession.installAccessCookie(credentials.accessToken, credentials.accessExpiresAtEpochMs)
        if (previous != null && previous.accessToken != credentials.accessToken) {
            mutableWebSessionEpoch.value += 1
        }
        mutableState.value = SessionState.Authenticated(credentials.account, ConnectionMode.ONLINE)
    }

    private suspend fun terminate(message: String) {
        store.clearActive()
        webSession.clearAccountData()
        mutableState.value = SessionState.SignedOut(message)
    }

    private suspend fun flushPendingLogout() {
        val pending = store.loadPendingLogout() ?: return
        if (!api.logout(pending.refreshToken, "", pending.deviceId).shouldRetry()) {
            store.clearPendingLogout()
        }
    }

    private fun ApiCall<Unit>.shouldRetry(): Boolean =
        this is ApiCall.Failure && kind == ApiFailureKind.RETRYABLE
}
