package uk.thewyj.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Regression for the real-device P0 where the permission center swallowed the
 * bottom bar: every one of the six shared destinations must close the overlay
 * and land on the tapped page, including tapping "我的" again.
 */
class ShellNavigationTest {
    private val allOverlaysOpen = ShellOverlayState(permissions = true, archive = true, transfer = true)

    @Test fun everyBottomDestinationClosesThePermissionCenter() {
        for (destination in AppDestination.entries) {
            val result = bottomNavigationSelection(destination, allOverlaysOpen)
            assertEquals("tapped destination", destination, result.destination)
            assertFalse(
                "overlays must be dismissed when tapping ${destination.label}",
                result.overlays.anyVisible,
            )
        }
    }

    @Test fun tappingMyFromThePermissionCenterReturnsToTheMyPage() {
        val result = bottomNavigationSelection(AppDestination.MY, ShellOverlayState(permissions = true))
        assertEquals(AppDestination.MY, result.destination)
        assertFalse(result.overlays.permissions)
    }

    @Test fun navigationWithoutOverlaysStaysUnchanged() {
        val result = bottomNavigationSelection(AppDestination.TOOLS)
        assertEquals(AppDestination.TOOLS, result.destination)
        assertFalse(result.overlays.anyVisible)
    }
}
