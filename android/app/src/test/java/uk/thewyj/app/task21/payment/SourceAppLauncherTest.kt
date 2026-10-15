package uk.thewyj.app.task21.payment

import android.app.Application
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class SourceAppLauncherTest {
    private fun target(uid: Int?) = PaymentTicket("ticket-one", "account-a", "rec-one",
        "com.tencent.mm", "event-one", "wechat", null, emptySet(), 1000, 91000,
        PaymentTicketState.WAITING_FOR_ACCESSIBILITY, sourceUid = uid)

    @Test fun unknownOriginNeverSilentlyOpensMainWeChat() {
        val app = RuntimeEnvironment.getApplication()
        assertFalse(SourceAppLauncher.launch(app, target(null)))
        assertNull(shadowOf(app).nextStartedActivity)
    }

    @Test fun inaccessibleCloneDoesNotFallbackToTheMainApplication() {
        val app = RuntimeEnvironment.getApplication()
        assertFalse(SourceAppLauncher.launch(app, target(9_510_123)))
        assertNull(shadowOf(app).nextStartedActivity)
    }

    @Test fun sharedPackageNeedsStrongReferenceRatherThanAnAmountMatch() {
        assertTrue(PaymentSourceIdentity.requiresManualReview(true, true, "", ""))
        assertTrue(PaymentSourceIdentity.requiresManualReview(false, false, "order-one", "order-two"))
        assertFalse(PaymentSourceIdentity.requiresManualReview(false, true, "order-one", "order-one"))
        assertFalse(PaymentSourceIdentity.requiresManualReview(true, false, "", ""))
    }
}
