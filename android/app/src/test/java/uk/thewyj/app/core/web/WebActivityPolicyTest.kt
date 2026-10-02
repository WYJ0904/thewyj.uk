package uk.thewyj.app.core.web

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebActivityPolicyTest {
    @Test fun nativeDestinationsAndOverlaysDisableOnlyDocumentActivity() {
        assertTrue(webContentActive(false, false))
        assertFalse(webContentActive(true, false))
        assertFalse(webContentActive(false, true))
        assertFalse(webContentActive(true, true))
        assertTrue(webContentActive(false, false))
    }
}
