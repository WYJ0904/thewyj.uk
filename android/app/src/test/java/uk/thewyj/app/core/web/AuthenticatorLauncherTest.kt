package uk.thewyj.app.core.web

import android.content.ActivityNotFoundException
import android.content.ContextWrapper
import android.content.Intent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AuthenticatorLauncherTest {
    private val uri = "otpauth://totp/Aeris:synthetic-user?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Aeris&algorithm=SHA1&digits=6&period=30"
    @Test fun standardUriUsesAnExplicitSystemActionWithoutWebNavigationOrExtras() {
        var launched: Intent? = null
        val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun startActivity(intent: Intent) { launched = intent }
        }
        assertEquals(NavigationDecision.Authenticator, WebRoutePolicy("https://thewyj.uk").decide(uri))
        assertTrue(AuthenticatorLauncher.open(context, uri))
        assertEquals(Intent.ACTION_VIEW, launched?.action)
        assertEquals(uri, launched?.dataString)
        assertNull(launched?.extras)
        assertNull(WebRoutePolicy("https://thewyj.uk").spaRoute(uri))
    }
    @Test fun missingHandlerReturnsAVisibleManualSetupFallback() {
        val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun startActivity(intent: Intent) { throw ActivityNotFoundException("synthetic missing handler") }
        }
        assertFalse(AuthenticatorLauncher.open(context, uri))
        assertTrue(ShadowToast.getTextOfLatestToast().contains("复制密钥"))
    }
    @Test fun unexpectedSchemesParametersAndIssuersNeverLaunch() {
        for (invalid in listOf(uri.replace("otpauth:","https:"), uri.replace("issuer=Aeris","issuer=Other"), uri.replace("period=30","period=60"), uri+"&secret=duplicate", uri+"#fragment", "intent://example", uri.replace("/Aeris:","/Other:"))) {
            assertFalse(AuthenticatorUri.isAllowed(invalid))
        }
    }
}
