package uk.thewyj.app.task21.payment

import android.app.Application
import android.content.Context
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.PaymentIngestOutcome
import uk.thewyj.app.task21.FinanceDirection

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class AndroidPaymentNotificationLifecycleRegistryTest {
    private lateinit var context: Context

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        preferences().edit().clear().commit()
    }

    @After fun tearDown() {
        preferences().edit().clear().commit()
    }

    @Test fun identitySurvivesRecreationAndShortIdenticalRepostButExpiresAfterGrace() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        var now = 1_000L
        val input = NotificationCaptureInput(
            sourcePackage = "com.tencent.mm",
            notificationKey = "95|com.tencent.mm|-243922068|null|9510390",
            notificationId = -243922068,
            postTime = 1_000L,
            receivedAtMs = 1_000L,
        )
        val firstStore = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val first = firstStore.eventId("account-a", input)

        val recreatedStore = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val updated = recreatedStore.eventId(
            "account-a",
            input.copy(postTime = 12_000L, receivedAtMs = 12_000L),
        )
        assertEquals(first, updated)

        recreatedStore.markRemoved("account-a", input)
        now += 2_000L
        val repostRegistry = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val immediateRepost = repostRegistry.eventId("account-a", input.copy(postTime = 30_000L, receivedAtMs = 30_000L))
        assertEquals(first, immediateRepost)

        repostRegistry.markRemoved("account-a", input)
        now += AndroidPaymentNotificationLifecycleRegistry.REPOST_GRACE_MS + 1
        val later = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
            .eventId("account-a", input.copy(postTime = 60_000L, receivedAtMs = 60_000L))
        assertNotEquals(first, later)
    }

    @Test fun sameSlotAndAmountWithDifferentTransactionEvidenceGetsANewId() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        var now = 1_000L
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val first = registry.eventId("account-a", input("交易号 A100"))
        now += 1_000L
        val second = registry.eventId("account-a", input("交易号 B200"))
        assertNotEquals(first, second)
    }

    @Test fun sameAmountAndSlotWithDifferentProviderReferencesNeverMerge() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, idFactory = { ids.removeFirst() })
        val capture = input("已支付 ¥2.80")
        val first = registry.eventId("account-a", capture, payment("reference-A"))
        val second = registry.eventId("account-a", capture, payment("reference-B"))
        assertNotEquals(first, second)
    }

    @Test fun registryStoresNoAccountOrNotificationContent() {
        val registry = AndroidPaymentNotificationLifecycleRegistry(context) { "payment-event-private" }
        registry.eventId(
            "private-account-id",
            NotificationCaptureInput(
                sourcePackage = "com.tencent.mm",
                notificationKey = "private-notification-key",
                notificationId = 7,
                title = "private title",
                text = "private body",
            ),
        )
        val persisted = preferences().all.entries.joinToString("|") { "${it.key}=${it.value}" }
        assertFalse(persisted.contains("private-account-id"))
        assertFalse(persisted.contains("private-notification-key"))
        assertFalse(persisted.contains("private title"))
        assertFalse(persisted.contains("private body"))
    }

    private fun preferences() = context.getSharedPreferences(
        "wyj-payment-notification-lifecycles",
        Context.MODE_PRIVATE,
    )

    private fun input(body: String) = NotificationCaptureInput(
        sourcePackage = "com.tencent.mm",
        notificationKey = "shared-payment-slot",
        notificationId = 7,
        title = "微信支付",
        text = body,
        postTime = 1_000L,
        receivedAtMs = 1_000L,
    )

    private fun payment(reference: String) = PaymentIngestOutcome(
        confirmed = true,
        amountMinor = 280,
        direction = FinanceDirection.EXPENSE,
        confidence = 950,
        merchant = "",
        counterparty = "",
        paymentChannel = "wechat",
        parserVersion = "wechat-2",
        providerReference = reference,
    )
}
