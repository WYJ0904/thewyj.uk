package uk.thewyj.app.core.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class WebRoutePolicyTest {
    private val policy = WebRoutePolicy("https://thewyj.uk")
    @Test fun spaNavigationOnlyAcceptsKnownSameOriginPages() {
        listOf("/select", "/finance", "/language/japanese", "/tools/json", "/share/file/abc_123").forEach {
            assertEquals(it, policy.spaRoute("https://thewyj.uk$it"))
        }
        assertEquals("/finance?month=2026-09#top", policy.spaRoute("https://thewyj.uk/finance?month=2026-09#top"))
        listOf("https://evil.example/finance", "https://user@thewyj.uk/finance", "https://thewyj.uk/api/me", "https://thewyj.uk/app.js", "https://thewyj.uk/unknown").forEach {
            assertEquals(null, policy.spaRoute(it))
        }
    }

    @Test
    fun exactProductionOriginStaysInsideApp() {
        assertEquals(NavigationDecision.Internal, policy.decide("https://thewyj.uk/finance?month=2026-09"))
    }

    @Test
    fun configuredPreviewOriginStaysInsidePreviewBuildOnly() {
        val preview = WebRoutePolicy("https://task20-preview.thewyj-uk.pages.dev")
        assertEquals(NavigationDecision.Internal, preview.decide("https://task20-preview.thewyj-uk.pages.dev/tools"))
        assertEquals(NavigationDecision.External, preview.decide("https://thewyj.uk/tools"))
    }

    @Test
    fun lookalikeAndSubdomainOriginsCannotEnterTrustedWebView() {
        assertEquals(NavigationDecision.External, policy.decide("https://evil-thewyj.uk/"))
        assertEquals(NavigationDecision.External, policy.decide("https://preview.thewyj.uk/"))
    }

    @Test
    fun activeContentAndCleartextSchemesAreBlocked() {
        assertEquals(NavigationDecision.Blocked, policy.decide("javascript:alert(1)"))
        assertEquals(NavigationDecision.Blocked, policy.decide("file:///data/local/private"))
        assertEquals(NavigationDecision.Blocked, policy.decide("http://thewyj.uk/"))
    }

    @Test
    fun onlyDocumentedSessionBridgeActionsAreAccepted() {
        assertEquals(NavigationDecision.RefreshSession, policy.decide("thewyj://session/refresh?reason=expired"))
        assertEquals(NavigationDecision.Logout, policy.decide("thewyj://session/logout"))
        assertEquals(NavigationDecision.Blocked, policy.decide("thewyj://session/export-token"))
        assertEquals(NavigationDecision.Blocked, policy.decide("thewyj://admin/role"))
    }

    @Test
    fun routesAreResolvedAgainstTheTrustedOrigin() {
        assertEquals("https://thewyj.uk/tools", policy.urlFor("tools"))
        assertEquals("https://thewyj.uk/language", policy.urlFor("/language"))
    }

    @Test
    fun configuredBaseMustBeAnHttpsOriginWithoutCredentialsOrPath() {
        assertThrows(IllegalArgumentException::class.java) { WebRoutePolicy("http://thewyj.uk") }
        assertThrows(IllegalArgumentException::class.java) { WebRoutePolicy("https://user@thewyj.uk") }
        assertThrows(IllegalArgumentException::class.java) { WebRoutePolicy("https://thewyj.uk/app") }
    }
}
