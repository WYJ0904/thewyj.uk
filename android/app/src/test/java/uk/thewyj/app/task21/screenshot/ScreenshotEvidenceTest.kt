package uk.thewyj.app.task21.screenshot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenshotEvidenceTest {
    @Test fun mediaStoreRowIdIsThePrimaryScreenshotIdentity() {
        assertEquals("ms:42", ScreenshotEvidence.mediaStoreFingerprint(42))
        assertTrue(ScreenshotEvidence.isMediaStoreFingerprint("ms:42"))
        assertFalse(ScreenshotEvidence.isMediaStoreFingerprint("nfb:abc"))
        assertEquals("shot:ms:42", ScreenshotEvidence.archiveIdentity("ms:42", "aux:x:1"))
    }

    @Test fun uriFingerprintIsStableAndNormalised() {
        val first = ScreenshotEvidence.uriFingerprint("content://media/external/images/media/1")
        val second = ScreenshotEvidence.uriFingerprint("  CONTENT://MEDIA/EXTERNAL/IMAGES/MEDIA/1 ")
        assertEquals(first, second)
        assertTrue(first.startsWith("uri:"))
        assertNotEquals(first, ScreenshotEvidence.uriFingerprint("content://media/external/images/media/2"))
    }

    @Test fun bitmapFingerprintChangesWhenTheScreenshotChanges() {
        val first = ScreenshotEvidence.bitmapFingerprint(1080, 2400, IntArray(64) { it })
        val second = ScreenshotEvidence.bitmapFingerprint(1080, 2400, IntArray(64) { it + 1 })
        assertTrue(first.startsWith("nfb:"))
        assertNotEquals("two different screenshots must not share a fingerprint", first, second)
        assertEquals(first, ScreenshotEvidence.bitmapFingerprint(1080, 2400, IntArray(64) { it }))
        assertEquals("", ScreenshotEvidence.bitmapFingerprint(0, 0, IntArray(0)))
    }

    @Test fun auxiliaryIdentityPrefersNotificationWhenTimestamp() {
        val withWhen = ScreenshotEvidence.auxiliaryIdentity("com.tencent.mm", 5_000L, 1_000L)
        assertTrue(withWhen.endsWith(":5000"))
        val postTimeOnly = ScreenshotEvidence.auxiliaryIdentity("com.tencent.mm", 0L, 1_000L)
        assertTrue(postTimeOnly.endsWith(":1000"))
        assertEquals("", ScreenshotEvidence.auxiliaryIdentity("com.tencent.mm", 0L, 0L))
        assertEquals(
            "an unreadable screenshot still gets a per-capture identity",
            "shot:$withWhen",
            ScreenshotEvidence.archiveIdentity("", withWhen),
        )
    }

    @Test fun screenshotDetectionNeverInventsSemanticsFromMediaAlone() {
        assertTrue(
            ScreenshotEvidence.isScreenshotEvent(
                "com.samsung.android.app.smartcapture", "", "", "", "", hasMedia = true,
            ),
        )
        assertTrue(
            ScreenshotEvidence.isScreenshotEvent("com.other.app", "screenshot_status", "", "", "", hasMedia = false),
        )
        assertTrue(
            ScreenshotEvidence.isScreenshotEvent("com.other.app", "", "屏幕截图已保存", "", "", hasMedia = false),
        )
        assertFalse(
            "a normal picture notification must not become a screenshot row",
            ScreenshotEvidence.isScreenshotEvent("com.tencent.mm", "chat", "张三", "转账100", "", hasMedia = true),
        )
    }

    @Test fun mergeDecisionFollowsEvidencePriority() {
        assertEquals(
            ScreenshotLinkAction.DUPLICATE,
            ScreenshotEvidence.decide(sameEvidenceArchived = true, unlinkedCounterpartInWindow = false),
        )
        assertEquals(
            ScreenshotLinkAction.MERGE,
            ScreenshotEvidence.decide(sameEvidenceArchived = false, unlinkedCounterpartInWindow = true),
        )
        assertEquals(
            ScreenshotLinkAction.NEW_EVENT,
            ScreenshotEvidence.decide(sameEvidenceArchived = false, unlinkedCounterpartInWindow = false),
        )
    }

    @Test fun mergeWindowSeparatesSlowScreenshotsButPairsTheTwoOrigins() {
        assertTrue(ScreenshotEvidence.isWithinMergeWindow(10_000L, 10_500L))
        assertTrue(ScreenshotEvidence.isWithinMergeWindow(10_000L, 10_000L + ScreenshotEvidence.MERGE_WINDOW_MS))
        assertFalse(
            ScreenshotEvidence.isWithinMergeWindow(10_000L, 10_000L + ScreenshotEvidence.MERGE_WINDOW_MS + 1),
        )
        assertFalse(ScreenshotEvidence.isWithinMergeWindow(0L, 10_000L))
    }

    @Test fun originWireValuesRoundTrip() {
        ScreenshotMediaOrigin.entries.forEach { origin ->
            assertEquals(origin, ScreenshotMediaOrigin.fromWire(origin.wireValue))
        }
        assertEquals(ScreenshotMediaOrigin.NONE, ScreenshotMediaOrigin.fromWire("something-else"))
    }
}
