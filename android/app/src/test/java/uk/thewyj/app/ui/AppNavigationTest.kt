package uk.thewyj.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class AppNavigationTest {
    @Test
    fun primaryProductRoutesSelectTheirNativeDestinations() {
        assertEquals(AppDestination.LEARNING, destinationForRoute("/language/japanese"))
        assertEquals(AppDestination.TOOLS, destinationForRoute("/tools?category=text"))
        assertEquals(AppDestination.FINANCE, destinationForRoute("/finance"))
    }

    @Test
    fun accountMembershipAndAdminRemainWebContentUnderHomeShell() {
        assertEquals(AppDestination.HOME, destinationForRoute("/account"))
        assertEquals(AppDestination.HOME, destinationForRoute("/recharge"))
        assertEquals(AppDestination.HOME, destinationForRoute("/admin"))
    }
}
