package uk.thewyj.app.core.session

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.thewyj.app.core.auth.AccountSnapshot
import uk.thewyj.app.core.auth.CredentialStore
import uk.thewyj.app.core.auth.DeviceCredentials
import uk.thewyj.app.core.auth.DeviceIdentity
import uk.thewyj.app.core.auth.PendingLogout
import uk.thewyj.app.core.network.AccountApi
import uk.thewyj.app.core.network.ApiCall
import uk.thewyj.app.core.network.ApiFailureKind
import uk.thewyj.app.core.network.AppConfig
import uk.thewyj.app.core.web.WebSessionController

class SessionRepositoryTest {
    private val now = 1_000_000L
    private val account = AccountSnapshot("stable-user-id", "alice", "user", "普通用户", emptySet())

    @Test
    fun validSessionRestoresSameAccountAndCookie() = runBlocking {
        val store = FakeStore(credentials())
        val api = FakeApi().apply { currentResult = ApiCall.Success(account) }
        val web = FakeWebSession()
        val repository = repository(store, api, web)

        repository.restore()

        val state = repository.state.value as SessionState.Authenticated
        assertEquals(ConnectionMode.ONLINE, state.mode)
        assertEquals("stable-user-id", state.account.id)
        assertEquals("access-old", web.installedAccess)
    }

    @Test
    fun offlineVerificationKeepsCredentialAndEntersSafeOfflineMode() = runBlocking {
        val original = credentials()
        val store = FakeStore(original)
        val api = FakeApi().apply { currentResult = retryable() }
        val repository = repository(store, api, FakeWebSession())

        repository.restore()

        val state = repository.state.value as SessionState.Authenticated
        assertEquals(ConnectionMode.OFFLINE, state.mode)
        assertEquals(original, store.active)
    }

    @Test
    fun expiredAccessSilentlyRotatesWithoutPassword() = runBlocking {
        val store = FakeStore(credentials(accessExpiry = now - 1))
        val api = FakeApi().apply { refreshResult = ApiCall.Success(credentials("access-new", "refresh-new")) }
        val web = FakeWebSession()
        val repository = repository(store, api, web)

        repository.restore()

        assertEquals("access-new", store.active?.accessToken)
        assertEquals("access-new", web.installedAccess)
        assertEquals(ConnectionMode.ONLINE, (repository.state.value as SessionState.Authenticated).mode)
    }

    @Test
    fun ambiguousRefreshKeepsOneRotationKeyForIdempotentRetry() = runBlocking {
        val store = FakeStore(credentials(accessExpiry = now - 1))
        val api = FakeApi().apply { refreshResult = retryable() }
        val repository = repository(store, api, FakeWebSession())

        assertEquals(RefreshWorkResult.RETRY, repository.refresh())
        val firstKey = store.active!!.pendingRotationKey
        assertTrue(firstKey.isNotBlank())
        api.refreshResult = ApiCall.Success(credentials("access-new", "refresh-new"))
        assertEquals(RefreshWorkResult.SUCCESS, repository.refresh())

        assertEquals(firstKey, api.rotationKeys[0])
        assertEquals(firstKey, api.rotationKeys[1])
        assertEquals("", store.active!!.pendingRotationKey)
    }

    @Test
    fun revokedRefreshIsTheOnlyNetworkFailureThatClearsLogin() = runBlocking {
        val store = FakeStore(credentials(accessExpiry = now - 1))
        val api = FakeApi().apply {
            refreshResult = ApiCall.Failure(
                "app_session_revoked",
                "设备会话已撤销",
                ApiFailureKind.AUTHENTICATION,
                401,
            )
        }
        val web = FakeWebSession()
        val repository = repository(store, api, web)

        assertEquals(RefreshWorkResult.SIGNED_OUT, repository.refresh())

        assertNull(store.active)
        assertTrue(web.clearCount > 0)
        assertTrue(repository.state.value is SessionState.SignedOut)
    }

    @Test
    fun switchingAccountsClearsWebDataBeforeInstallingNewCookie() = runBlocking {
        val store = FakeStore(credentials())
        val second = account.copy(id = "second-user-id", username = "bob")
        val api = FakeApi().apply {
            loginResult = ApiCall.Success(credentials("second-access", "second-refresh", second))
        }
        val web = FakeWebSession()
        val repository = repository(store, api, web)

        repository.login("bob", "correct-secret")

        assertEquals("second-user-id", store.active?.account?.id)
        assertEquals(1, web.clearCount)
        assertEquals("second-access", web.installedAccess)
    }

    @Test
    fun offlineLogoutClearsLocalAccountAndQueuesServerRevocation() = runBlocking {
        val store = FakeStore(credentials())
        val api = FakeApi().apply { logoutResult = retryable() }
        val web = FakeWebSession()
        val repository = repository(store, api, web)

        repository.logout()

        assertNull(store.active)
        assertEquals("refresh-old", store.pending?.refreshToken)
        assertTrue(repository.state.value is SessionState.SignedOut)
        assertEquals(1, web.clearCount)
    }

    @Test
    fun pendingLogoutSurvivesOnlyRetryableFailures() = runBlocking {
        val store = FakeStore(credentials()).apply {
            pending = PendingLogout("old-refresh", "663a75e0-0c27-4c0b-9ed7-608a8d05c235")
        }
        val api = FakeApi().apply {
            logoutResult = retryable()
            currentResult = ApiCall.Success(account)
        }
        val repository = repository(store, api, FakeWebSession())

        repository.restore()
        assertEquals("old-refresh", store.pending?.refreshToken)

        api.logoutResult = ApiCall.Failure(
            "app_session_revoked",
            "设备会话已撤销",
            ApiFailureKind.AUTHENTICATION,
            401,
        )
        repository.restore()
        assertNull(store.pending)
        assertTrue(repository.state.value is SessionState.Authenticated)
    }

    private fun repository(store: FakeStore, api: FakeApi, web: FakeWebSession) = SessionRepository(
        store = store,
        deviceIdentity = DeviceIdentity { "663a75e0-0c27-4c0b-9ed7-608a8d05c235" },
        api = api,
        webSession = web,
        now = { now },
    )

    private fun credentials(
        access: String = "access-old",
        refresh: String = "refresh-old",
        accountValue: AccountSnapshot = account,
        accessExpiry: Long = now + 60_000,
    ) = DeviceCredentials(
        accessToken = access,
        accessExpiresAtEpochMs = accessExpiry,
        refreshToken = refresh,
        refreshExpiresAtEpochMs = now + 10_000_000,
        deviceSessionId = "device-session-id",
        account = accountValue,
    )

    private fun retryable() = ApiCall.Failure(
        "network_unavailable",
        "网络暂时不可用",
        ApiFailureKind.RETRYABLE,
    )
}

private class FakeStore(initial: DeviceCredentials?) : CredentialStore {
    var active: DeviceCredentials? = initial
    var pending: PendingLogout? = null
    override fun loadActive() = active
    override fun saveActive(credentials: DeviceCredentials) { active = credentials }
    override fun clearActive() { active = null }
    override fun loadPendingLogout() = pending
    override fun savePendingLogout(pending: PendingLogout) { this.pending = pending }
    override fun clearPendingLogout() { pending = null }
}

private class FakeWebSession : WebSessionController {
    var installedAccess = ""
    var clearCount = 0
    override suspend fun installAccessCookie(accessToken: String, expiresAtEpochMs: Long) {
        installedAccess = accessToken
    }
    override suspend fun clearAccountData() { clearCount += 1 }
}

private class FakeApi : AccountApi {
    var loginResult: ApiCall<DeviceCredentials> = ApiCall.Failure("unused", "unused", ApiFailureKind.VALIDATION)
    var refreshResult: ApiCall<DeviceCredentials> = ApiCall.Failure("unused", "unused", ApiFailureKind.VALIDATION)
    var currentResult: ApiCall<AccountSnapshot> = ApiCall.Failure("unused", "unused", ApiFailureKind.VALIDATION)
    var logoutResult: ApiCall<Unit> = ApiCall.Success(Unit)
    val rotationKeys = mutableListOf<String>()

    override suspend fun register(username: String, secret: String): ApiCall<Unit> = ApiCall.Success(Unit)
    override suspend fun login(username: String, secret: String, deviceId: String) = loginResult
    override suspend fun refresh(credentials: DeviceCredentials, deviceId: String, rotationKey: String): ApiCall<DeviceCredentials> {
        rotationKeys += rotationKey
        return refreshResult
    }
    override suspend fun currentAccount(accessToken: String) = currentResult
    override suspend fun logout(refreshToken: String, accessToken: String, deviceId: String) = logoutResult
    override suspend fun appConfig() = ApiCall.Success(AppConfig(1, "1.0.0", 1, ""))
}
