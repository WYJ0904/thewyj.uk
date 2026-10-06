package uk.thewyj.app.core.web

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebMotionPreferenceTest {
    @Test fun nativePreferenceHasBothStatesAndDoesNotSpoofMedia() {
        val reduced = webReducedMotionScript(true)
        val normal = webReducedMotionScript(false)
        assertTrue(reduced.contains("androidReducedMotion = 'true'"))
        assertTrue(normal.contains("androidReducedMotion = 'false'"))
        assertTrue(reduced.contains("thewyj:reduced-motion"))
        assertFalse(reduced.contains("matchMedia ="))
    }
}
