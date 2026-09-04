package uk.thewyj.app.core.session

import uk.thewyj.app.core.auth.AccountSnapshot

enum class ConnectionMode { ONLINE, OFFLINE, RECOVERING }

sealed interface SessionState {
    data object Initializing : SessionState
    data class SignedOut(val message: String = "") : SessionState
    data class Authenticated(
        val account: AccountSnapshot,
        val mode: ConnectionMode,
        val message: String = "",
    ) : SessionState
}

enum class StartupAction { SIGNED_OUT, VERIFY_ACCESS, REFRESH_ACCESS, REAUTHENTICATE }

object StartupPolicy {
    private const val ACCESS_SAFETY_WINDOW_MS = 30_000L

    fun choose(
        hasCredentials: Boolean,
        accessExpiresAt: Long,
        refreshExpiresAt: Long,
        now: Long,
    ): StartupAction = when {
        !hasCredentials -> StartupAction.SIGNED_OUT
        refreshExpiresAt <= now -> StartupAction.REAUTHENTICATE
        accessExpiresAt > now + ACCESS_SAFETY_WINDOW_MS -> StartupAction.VERIFY_ACCESS
        else -> StartupAction.REFRESH_ACCESS
    }
}

enum class RefreshWorkResult { SUCCESS, RETRY, SIGNED_OUT }
