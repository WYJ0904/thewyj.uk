package uk.thewyj.app.core.design

import android.view.View
import android.view.HapticFeedbackConstants
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ThewyjInteractionPolicyTest {
    @Test fun meaningfulHapticEventsAreBoundedAndSystemRejectionIsRespected() {
        var time = 100L
        val calls = mutableListOf<Int>()
        var systemAccepts = true
        val view = object : View(RuntimeEnvironment.getApplication()) {
            override fun performHapticFeedback(kind: Int): Boolean { calls.add(kind); return systemAccepts }
        }
        val policy = ThewyjHapticPolicy { time }
        assertTrue(policy.perform(view, ThewyjHapticEvent.Destination))
        time += 20; assertFalse(policy.perform(view, ThewyjHapticEvent.Tab)); assertEquals(1, calls.size)
        time += 80; systemAccepts = false
        assertFalse(policy.perform(view, ThewyjHapticEvent.ImportantToggle))
        assertEquals(listOf(HapticFeedbackConstants.CLOCK_TICK, HapticFeedbackConstants.VIRTUAL_KEY), calls)
    }

    @Test fun swipeThresholdClampsBothDirectionsAndHasARealCancellationZone() {
        assertEquals(-80f, ThewyjSwipePolicy.clamp(-500f, 80f, -1f))
        assertEquals(0f, ThewyjSwipePolicy.clamp(30f, 80f, -1f))
        assertEquals(80f, ThewyjSwipePolicy.clamp(500f, 80f, 1f))
        assertFalse(ThewyjSwipePolicy.revealed(-20f, 80f)); assertTrue(ThewyjSwipePolicy.revealed(-40f, 80f))
        assertEquals(65L, ThewyjMotion.releaseDelay(0, 15)); assertEquals(0L, ThewyjMotion.releaseDelay(0, 100))
    }
}
