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

    @Test fun identitySurvivesRegistryRecreationAndRemovalStartsANewLifecycle() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        val input = NotificationCaptureInput(
            sourcePackage = "com.tencent.mm",
            notificationKey = "95|com.tencent.mm|-243922068|null|9510390",
            notificationId = -243922068,
            postTime = 1_000L,
            receivedAtMs = 1_000L,
        )
        val firstStore = AndroidPaymentNotificationLifecycleRegistry(context) { ids.removeFirst() }
        val first = firstStore.eventId("account-a", input)

        val recreatedStore = AndroidPaymentNotificationLifecycleRegistry(context) { ids.removeFirst() }
        val updated = recreatedStore.eventId(
            "account-a",
            input.copy(postTime = 12_000L, receivedAtMs = 12_000L),
        )
        assertEquals(first, updated)

        recreatedStore.markRemoved("account-a", input)
        val reposted = AndroidPaymentNotificationLifecycleRegistry(context) { ids.removeFirst() }
            .eventId("account-a", input.copy(postTime = 30_000L, receivedAtMs = 30_000L))
        assertNotEquals(first, reposted)
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
}
