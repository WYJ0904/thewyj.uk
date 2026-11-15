package uk.thewyj.app.core.session

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
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
import uk.thewyj.app.core.network.ThewyjApiClient
import uk.thewyj.app.core.web.WebSessionController
import uk.thewyj.app.core.web.computeAccessCookieMaxAgeSeconds

class WebSessionSyncRegressionTest {
    private val now = 1_760_000_000_000L
    private val account = AccountSnapshot("1234", "alice", "user", "普通用户", emptySet())

    @Test
    fun clockSkewAheadNeverSetsZeroMaxAgeCookieAndPreservesServerTtl() {
        // Simulates a device whose local clock is 2 hours ahead of UTC while
        // the server returned Date = T and access_expires_at = T + 15m.
        val serverNowIso = "2026-11-16T00:00:00Z"
        val serverExpiresIso = "2026-11-16T00:15:00Z"
        val serverDateMs = java.time.Instant.parse(serverNowIso).toEpochMilli()
        val skewedClientNowMs = serverDateMs + 2L * 60L * 60L * 1000L

        val apiClient = ThewyjApiClient("https://example.test")
        val normalizedExpiry = apiClient.normalizeExpiryEpochMs(
            expiresAtIso = serverExpiresIso,
            serverDateMs = serverDateMs,
            clientNowMs = skewedClientNowMs,
        )
        assertEquals(skewedClientNowMs + 15L * 60L * 1000L, normalizedExpiry)
        assertEquals(900L, computeAccessCookieMaxAgeSeconds(normalizedExpiry, skewedClientNowMs))

        // Even if an unadjusted past timestamp reaches WebSessionBridge, active
        // cookie installation must never emit Max-Age=0 (which deletes the cookie).
        val pastTimestampFromSkew = now - 3_600_000L
        val maxAge = computeAccessCookieMaxAgeSeconds(pastTimestampFromSkew, now)
        assertTrue("Max-Age must remain positive on active install", maxAge >= 60L)
        assertEquals(900L, computeAccessCookieMaxAgeSeconds(now + 3_600_000L, now))
    }

    @Test
    fun webTriggeredRefreshReloadsWebViewAfterCookieInstallEvenIfTokenIsUnchanged() = runBlocking {
        val creds = credentials("access-1", "refresh-1")
        val store = SyncFakeStore(creds)
        val events = mutableListOf<String>()
        val web = SyncFakeWebSession(events)
        val api = SyncFakeApi(account).apply {
            currentResult = ApiCall.Success(account)
            refreshResult = ApiCall.Success(creds)
        }
        val repo = SessionRepository(store, DeviceIdentity { "dev-1" }, api, web) { now }
        repo.restore()
        assertEquals(0, repo.webSessionEpoch.value)
        events.clear()

        val result = repo.refresh(forceWebReload = true)
        assertEquals(RefreshWorkResult.SUCCESS, result)
        assertEquals(1, repo.webSessionEpoch.value)
        assertTrue(events.contains("install:access-1"))

        // Token rotation with forceWebReload increments once, never twice.
        api.refreshResult = ApiCall.Success(credentials("access-2", "refresh-2"))
        assertEquals(RefreshWorkResult.SUCCESS, repo.refresh(forceWebReload = true))
        assertEquals(2, repo.webSessionEpoch.value)
        assertEquals("access-2", web.installedAccess)
    }

    @Test
    fun offlineToOnlineRecoveryAndMissingCookieReloadWebViewAutomatically() = runBlocking {
        val creds = credentials("access-1", "refresh-1")
        val store = SyncFakeStore(creds)
        val web = SyncFakeWebSession()
        val api = SyncFakeApi(account).apply {
            currentResult = ApiCall.Failure("network_unavailable", "网络暂时不可用", ApiFailureKind.RETRYABLE)
        }
        val repo = SessionRepository(store, DeviceIdentity { "dev-1" }, api, web) { now }

        repo.restore()
        val offlineState = repo.state.value as SessionState.Authenticated
        assertEquals(ConnectionMode.OFFLINE, offlineState.mode)
        assertEquals(0, repo.webSessionEpoch.value)

        // Network returns with same valid token -> must reload WebView out of error state.
        api.currentResult = ApiCall.Success(account)
        repo.restore()
        assertEquals(ConnectionMode.ONLINE, (repo.state.value as SessionState.Authenticated).mode)
        assertEquals(1, repo.webSessionEpoch.value)

        // Normal subsequent restore while ONLINE and cookie present does not churn WebView.
        repo.restore()
        assertEquals(1, repo.webSessionEpoch.value)

        // If CookieManager lost the cookie externally while ONLINE, next restore recovers & reloads.
        web.cookiePresent = false
        repo.restore()
        assertEquals(2, repo.webSessionEpoch.value)
        assertTrue(web.cookiePresent)
    }

    private fun credentials(access: String, refresh: String) = DeviceCredentials(
        accessToken = access,
        accessExpiresAtEpochMs = now + 900_000L,
        refreshToken = refresh,
        refreshExpiresAtEpochMs = now + 10_000_000L,
        deviceSessionId = "ds-1",
        account = account,
    )
}

private class SyncFakeStore(var active: DeviceCredentials?) : CredentialStore {
    var pending: PendingLogout? = null
    override fun loadActive(): DeviceCredentials? = active
    override fun saveActive(credentials: DeviceCredentials) { active = credentials }
    override fun clearActive() { active = null }
    override fun loadPendingLogout(): PendingLogout? = pending
    override fun savePendingLogout(pending: PendingLogout) { this.pending = pending }
    override fun clearPendingLogout() { pending = null }
}

private class SyncFakeWebSession(
    private val events: MutableList<String> = mutableListOf(),
) : WebSessionController {
    var installedAccess = ""
    var cookiePresent = false

    override suspend fun installAccessCookie(accessToken: String, expiresAtEpochMs: Long) {
        installedAccess = accessToken
        cookiePresent = true
        events += "install:$accessToken"
    }

    override suspend fun clearAccountData() {
        installedAccess = ""
        cookiePresent = false
        events += "clear"
    }

    override suspend fun hasAccessCookie(): Boolean = cookiePresent
}

private class SyncFakeApi(private val account: AccountSnapshot) : AccountApi {
    var refreshResult: ApiCall<DeviceCredentials> = ApiCall.Failure("unused", "unused", ApiFailureKind.VALIDATION)
    var currentResult: ApiCall<AccountSnapshot> = ApiCall.Success(account)

    override suspend fun register(username: String, secret: String) = ApiCall.Success(Unit)
    override suspend fun login(username: String, secret: String, deviceId: String) = refreshResult
    override suspend fun refresh(credentials: DeviceCredentials, deviceId: String, rotationKey: String) = refreshResult
    override suspend fun currentAccount(accessToken: String) = currentResult
    override suspend fun logout(refreshToken: String, accessToken: String, deviceId: String) = ApiCall.Success(Unit)
    override suspend fun appConfig() = ApiCall.Success(AppConfig(1, "1.0.0", 1, ""))
    override suspend fun pendingCandidateCount(accessToken: String) = ApiCall.Success(0)
}
