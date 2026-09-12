package uk.thewyj.app.core

import android.os.Build
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import uk.thewyj.app.core.permission.PermissionDecisions
import uk.thewyj.app.task21.screenshot.MediaReadCapability
import uk.thewyj.app.task21.screenshot.MediaReadPolicy

/**
 * Task 24.2 Phase 2 — Android 11 / API 30 is the real release baseline.
 *
 * The release APK declares `minSdk = 30`, so the code paths that are still
 * version-dependent must behave correctly *at* API 30, not only on the newest
 * device. These run under Robolectric with the minimum supported SDK.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30], application = android.app.Application::class)
class AndroidApi30BaselineTest {
    @Test fun theTestRuntimeIsReallyTheMinimumSupportedRelease() {
        assertEquals(30, Build.VERSION.SDK_INT)
        assertTrue(Build.VERSION.SDK_INT >= 30)
    }

    @Test fun restrictedSettingsAreNotAssumedBelowAndroid13() {
        assertFalse(PermissionDecisions.restrictedSettingsRisk(30, null))
        assertFalse(PermissionDecisions.restrictedSettingsRisk(30, "com.example.sideloaded"))
    }

    @Test fun api30UsesTheLegacyStorageGrantForScreenshots() {
        assertEquals(
            MediaReadCapability.FULL,
            MediaReadPolicy.resolve(30) { it == MediaReadPolicy.READ_EXTERNAL_STORAGE },
        )
        assertEquals(MediaReadCapability.DENIED, MediaReadPolicy.resolve(30) { false })
        // Selected-photos access does not exist before Android 14.
        assertEquals(
            MediaReadCapability.DENIED,
            MediaReadPolicy.resolve(30) { it == MediaReadPolicy.READ_MEDIA_VISUAL_USER_SELECTED },
        )
    }

    @Test fun android14OnlyFlagsNeverLeakIntoTheApi30Path() {
        assertEquals(MediaReadCapability.FULL, MediaReadPolicy.resolve(33) { it == MediaReadPolicy.READ_MEDIA_IMAGES })
        assertEquals(
            MediaReadCapability.LIMITED,
            MediaReadPolicy.resolve(34) { it == MediaReadPolicy.READ_MEDIA_VISUAL_USER_SELECTED },
        )
    }

    @Test fun noOemBackgroundKeepAliveHacksAreIntroduced() {
        val sources = File("src/main/java").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue("expected Android sources at src/main/java", sources.isNotEmpty())
        val forbidden = listOf(
            "com.miui.powerkeeper",
            "com.huawei.systemmanager",
            "com.coloros.safecenter",
            "com.oppo.safe",
            "com.vivo.permissionmanager",
            "com.iqoo.secure",
            "autostart",
            "oem_keepalive",
            "KEEP_ALIVE_HACK",
        )
        val offenders = sources.filter { file ->
            val body = file.readText()
            forbidden.any { marker -> body.contains(marker, ignoreCase = true) }
        }.map { it.path }
        assertTrue("OEM background keep-alive hacks must never be added: $offenders", offenders.isEmpty())
    }
}
