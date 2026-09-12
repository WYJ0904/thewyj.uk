package uk.thewyj.app.task21.screenshot

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Android 14-16 media permission matrix (Task 24.1 R4).
 *
 * Selected Photos Access still delivers MediaStore change callbacks while the
 * new screenshot stays unreadable, so the capability - not the callback - decides
 * whether a screenshot may be imported.
 */
class MediaReadCapabilityTest {
    private fun grants(vararg granted: String): (String) -> Boolean {
        val set = granted.toSet()
        return { permission -> set.contains(permission) }
    }

    @Test fun android16FullImageGrantIsTheOnlyReadableScreenshotState() {
        val full = MediaReadPolicy.resolve(36, grants(MediaReadPolicy.READ_MEDIA_IMAGES))
        assertEquals(MediaReadCapability.FULL, full)
        assertTrue(MediaReadPolicy.allowsMediaStoreImport(full))
    }

    @Test fun selectedPhotosAccessIsLimitedAndNeverImportable() {
        val limited = MediaReadPolicy.resolve(
            36,
            grants(MediaReadPolicy.READ_MEDIA_VISUAL_USER_SELECTED),
        )
        assertEquals(MediaReadCapability.LIMITED, limited)
        assertFalse(
            "observer callbacks must never be treated as readable screenshots",
            MediaReadPolicy.allowsMediaStoreImport(limited),
        )
    }

    @Test fun noMediaGrantIsDenied() {
        val denied = MediaReadPolicy.resolve(36, grants())
        assertEquals(MediaReadCapability.DENIED, denied)
        assertFalse(MediaReadPolicy.allowsMediaStoreImport(denied))
    }

    @Test fun fullGrantWinsWhenBothPhotoPermissionsAreGranted() {
        val capability = MediaReadPolicy.resolve(
            35,
            grants(
                MediaReadPolicy.READ_MEDIA_IMAGES,
                MediaReadPolicy.READ_MEDIA_VISUAL_USER_SELECTED,
            ),
        )
        assertEquals(MediaReadCapability.FULL, capability)
    }

    @Test fun android13HasNoPartialPhotoState() {
        assertEquals(
            MediaReadCapability.DENIED,
            MediaReadPolicy.resolve(33, grants(MediaReadPolicy.READ_MEDIA_VISUAL_USER_SELECTED)),
        )
        assertEquals(
            MediaReadCapability.FULL,
            MediaReadPolicy.resolve(33, grants(MediaReadPolicy.READ_MEDIA_IMAGES)),
        )
    }

    @Test fun legacyStoragePermissionOnlyAppliesUpToAndroid12() {
        assertEquals(
            MediaReadCapability.FULL,
            MediaReadPolicy.resolve(32, grants(MediaReadPolicy.READ_EXTERNAL_STORAGE)),
        )
        assertEquals(MediaReadCapability.DENIED, MediaReadPolicy.resolve(32, grants()))
        assertEquals(
            "READ_MEDIA_IMAGES does not exist before Android 13",
            MediaReadCapability.DENIED,
            MediaReadPolicy.resolve(32, grants(MediaReadPolicy.READ_MEDIA_IMAGES)),
        )
    }

    @Test fun runtimeRequestOffersFullAndSelectedOnAndroid14Plus() {
        assertEquals(
            listOf(MediaReadPolicy.READ_MEDIA_IMAGES, MediaReadPolicy.READ_MEDIA_VISUAL_USER_SELECTED),
            MediaReadPolicy.runtimeRequest(34).toList(),
        )
        assertEquals(listOf(MediaReadPolicy.READ_MEDIA_IMAGES), MediaReadPolicy.runtimeRequest(33).toList())
        assertEquals(listOf(MediaReadPolicy.READ_EXTERNAL_STORAGE), MediaReadPolicy.runtimeRequest(32).toList())
    }

    @Test fun logStagesSeparateEveryCapabilityState() {
        assertEquals("media-permission-full", MediaReadPolicy.logStage(MediaReadCapability.FULL))
        assertEquals("media-permission-limited", MediaReadPolicy.logStage(MediaReadCapability.LIMITED))
        assertEquals("media-permission-denied", MediaReadPolicy.logStage(MediaReadCapability.DENIED))
    }

    @Test fun manifestDeclaresThePhotoCapabilitiesAndNeverScreenCaptureDetection() {
        val manifest = File("src/main/AndroidManifest.xml")
        assertTrue("manifest must be readable at ${manifest.absolutePath}", manifest.isFile)
        val text = manifest.readText()
        assertTrue(text.contains("android.permission.READ_MEDIA_IMAGES"))
        assertTrue(text.contains("android.permission.READ_MEDIA_VISUAL_USER_SELECTED"))
        assertTrue(text.contains("android.permission.READ_EXTERNAL_STORAGE"))
        assertTrue(text.contains("android:maxSdkVersion=\"32\""))
        // DETECT_SCREEN_CAPTURE / ScreenCaptureCallback only observes this app's
        // own activity and never returns the image: it cannot replace the
        // NotificationListener + MediaStore screenshot archive.
        assertFalse(
            "DETECT_SCREEN_CAPTURE must not be used as a system screenshot listener",
            text.contains("DETECT_SCREEN_CAPTURE"),
        )
        val sources = File("src/main/java/uk/thewyj/app/task21/screenshot")
        val offenders = sources.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { file ->
                val body = file.readText()
                body.contains("ScreenCaptureCallback") && !body.contains("deliberately not used")
            }
            .toList()
        assertTrue("no source may implement Activity.ScreenCaptureCallback: $offenders", offenders.isEmpty())
    }
}
