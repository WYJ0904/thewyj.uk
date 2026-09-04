package uk.thewyj.app.core.session

import org.junit.Assert.assertEquals
import org.junit.Test

class StartupPolicyTest {
    private val now = 1_000_000L

    @Test
    fun noCredentialsShowsLogin() {
        assertEquals(StartupAction.SIGNED_OUT, StartupPolicy.choose(false, 0, 0, now))
    }

    @Test
    fun validAccessIsVerified() {
        assertEquals(
            StartupAction.VERIFY_ACCESS,
            StartupPolicy.choose(true, now + 60_000, now + 1_000_000, now),
        )
    }

    @Test
    fun expiringAccessUsesRefreshInsteadOfLogin() {
        assertEquals(
            StartupAction.REFRESH_ACCESS,
            StartupPolicy.choose(true, now + 10_000, now + 1_000_000, now),
        )
    }

    @Test
    fun expiredRefreshRequiresAuthentication() {
        assertEquals(
            StartupAction.REAUTHENTICATE,
            StartupPolicy.choose(true, now - 1, now, now),
        )
    }
}
