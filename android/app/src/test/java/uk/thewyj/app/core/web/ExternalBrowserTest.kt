package uk.thewyj.app.core.web

import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.ResolveInfo
import android.net.Uri
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ExternalBrowserTest {
    @Test fun externalBrowserCannotReturnToOurOwnDeepLinkHandler() {
        val app = RuntimeEnvironment.getApplication()
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
        fun handler(name: String) = ResolveInfo().apply {
            activityInfo = ActivityInfo().apply {
                packageName = name; this.name = "$name.BrowserActivity"; exported = true
                applicationInfo = ApplicationInfo().apply { packageName = name }
            }
        }
        shadowOf(app.packageManager).addResolveInfoForIntent(probe, handler(app.packageName))
        shadowOf(app.packageManager).addResolveInfoForIntent(probe, handler("com.android.chrome"))
        val url = "https://thewyj.uk/transfer#share=fixture-share-00001"
        ExternalBrowser.open(app, url)
        val started = shadowOf(app).nextStartedActivity
        assertEquals("com.android.chrome", started.`package`)
        assertEquals(url, started.dataString)
    }

    @Test fun publicTransferDoesNotMatchOurManifestButFinanceStillDoes() {
        val app = RuntimeEnvironment.getApplication()
        fun ours(path: String) = app.packageManager.queryIntentActivities(
            Intent(Intent.ACTION_VIEW, Uri.parse("https://thewyj.uk$path"))
                .addCategory(Intent.CATEGORY_BROWSABLE), 0,
        ).any { it.activityInfo.packageName == app.packageName }
        assertFalse(ours("/transfer#share=fixture-share-00001"))
        assertTrue(ours("/finance"))
        assertTrue(ours("/account"))
    }
}
