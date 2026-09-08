package uk.thewyj.app.core.web

import org.junit.Assert.assertEquals
import org.junit.Test

class WebLoadPolicyTest {
    @Test fun navigationAndHistoryDoNotReplayRefresh() {
        val policy = WebLoadPolicy(3)
        assertEquals(WebLoadAction.LOAD, policy.next(0, 3, false))
        assertEquals(WebLoadAction.NONE, policy.next(0, 3, false)) // History callback while view.url is stale.
        assertEquals(WebLoadAction.NAVIGATE, policy.next(1, 3, false))
        assertEquals(WebLoadAction.NONE, policy.next(1, 3, true))
        assertEquals(WebLoadAction.RELOAD, policy.next(1, 4, true))
        assertEquals(WebLoadAction.NONE, policy.next(1, 4, true))
    }
    @Test fun consecutiveWarmTabsNeverLoadOrRefreshTheDocument() {
        val policy = WebLoadPolicy(2)
        assertEquals(WebLoadAction.LOAD, policy.next(0, 2, false))
        repeat(20) { index ->
            assertEquals(WebLoadAction.NAVIGATE, policy.next(index + 1, 2, false))
            assertEquals(WebLoadAction.NONE, policy.next(index + 1, 2, false))
        }
    }
    @Test fun recreatedViewAndSimultaneousNavigationOnlyLoadOnce() {
        assertEquals(WebLoadAction.LOAD, WebLoadPolicy(4).next(7, 4, false))
        val policy = WebLoadPolicy(4)
        policy.next(7, 4, true)
        assertEquals(WebLoadAction.LOAD, policy.next(8, 5, false))
        assertEquals(WebLoadAction.NONE, policy.next(8, 5, true))
    }
}
