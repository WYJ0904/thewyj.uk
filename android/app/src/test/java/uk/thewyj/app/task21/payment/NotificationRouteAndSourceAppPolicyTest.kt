package uk.thewyj.app.task21.payment

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase 1 notification-behaviour guards.
 *
 * `routeIntent` runs from `onCreate` (cold start / process killed) and from
 * `onNewIntent` (warm start, singleTask) with exactly the same intent, so the
 * policy below is the single decision point both entry points share. The source
 * app action must never be offered when Android cannot launch it.
 */
class NotificationRouteAndSourceAppPolicyTest {
    @Test fun verifyExtraWinsAndStartsTheTicketFlow() {
        val decision = NotificationRoutePolicy.resolve(
            verifyRecognitionId = "rec-9",
            notificationRecognitionId = "rec-1",
            uriScheme = null,
            uriHost = null,
            uriPath = null,
            routeParam = null,
        )
        assertEquals(NotificationRoutePolicy.Target.Payment("rec-9", verify = true), decision)
    }

    @Test fun notificationExtraOpensThePaymentVerificationSurface() {
        val fromColdStart = NotificationRoutePolicy.resolve("", "rec-2", null, null, null, null)
        val fromWarmStart = NotificationRoutePolicy.resolve("", "rec-2", null, null, null, null)
        assertEquals(NotificationRoutePolicy.Target.Payment("rec-2", verify = false), fromColdStart)
        assertEquals("cold and warm start must route identically", fromColdStart, fromWarmStart)
    }

    @Test fun shareAndDeepLinksStillRouteToTheWebPath() {
        assertEquals(
            NotificationRoutePolicy.Target.Route("/finance"),
            NotificationRoutePolicy.resolve("", "", "https", "thewyj.uk", "/finance", null),
        )
        assertEquals(
            NotificationRoutePolicy.Target.Route("/transfer"),
            NotificationRoutePolicy.resolve("", "", "thewyj", null, null, "/transfer"),
        )
        assertEquals(
            NotificationRoutePolicy.Target.None,
            NotificationRoutePolicy.resolve("", "", "https", "example.com", "/x", null),
        )
    }

    @Test fun anEmptyIntentRoutesNowhere() {
        assertEquals(
            NotificationRoutePolicy.Target.None,
            NotificationRoutePolicy.resolve("", "", null, null, null, null),
        )
    }

    @Test fun sourceAppActionIsOnlyOfferedWhenItCanReallyLaunch() {
        assertTrue(SourceAppActionPolicy.shouldOffer(enabled = true, resolvable = true))
        assertFalse("uninstalled source app", SourceAppActionPolicy.shouldOffer(enabled = false, resolvable = false))
        assertFalse("disabled/suspended source app", SourceAppActionPolicy.shouldOffer(enabled = false, resolvable = true))
        assertFalse("no resolvable activity", SourceAppActionPolicy.shouldOffer(enabled = true, resolvable = false))
    }
}
