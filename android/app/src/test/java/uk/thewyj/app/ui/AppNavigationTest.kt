package uk.thewyj.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class AppNavigationTest {
    @Test fun rapidNativeRequestsIgnoreEarlierWebHistoryCallbacks() {
        val observation = WebNavigationObservation()
        observation.requested("/tools")
        observation.requested("/finance")
        assertEquals(false, observation.accept("/tools"))
        assertEquals(false, observation.accept("/select"))
        assertEquals(true, observation.accept("/finance?view=monthly"))
        // Once acknowledged, web links and Back may select another destination.
        assertEquals(true, observation.accept("/account"))
        assertEquals(true, observation.accept("/tools"))
    }
    @Test fun delayedWebObservationsCannotCloseNativePages() {
        for (native in listOf(AppDestination.MY, AppDestination.NOTIFICATIONS)) {
            assertEquals(native, webObservationDestination(native, "/finance"))
            assertEquals(native, webObservationDestination(native, "/tools"))
        }
        assertEquals(AppDestination.FINANCE, webObservationDestination(AppDestination.HOME, "/finance"))
    }
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

    @Test
    fun onlyTheTransferDocumentMayBypassNativeLoginForRecipients() {
        assertEquals(true, isPublicTransferRoute("/transfer"))
        assertEquals(true, isPublicTransferRoute("/transfer?foo=bar#share=abc"))
        for (route in listOf("/finance", "/account", "/admin", "/transfer-extra", "//evil/transfer",
            "https://thewyj.uk/transfer", "/api/transfer/shares")) {
            assertEquals(false, isPublicTransferRoute(route))
        }
    }
}
