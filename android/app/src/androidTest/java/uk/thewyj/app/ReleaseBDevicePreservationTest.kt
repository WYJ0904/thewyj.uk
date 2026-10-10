package uk.thewyj.app

import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.core.auth.SecureCredentialStore
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import java.security.MessageDigest

/** Read-only upgrade comparison with the actual pre-install encrypted/Room baseline. */
@RunWith(AndroidJUnit4::class)
class ReleaseBDevicePreservationTest {
    private fun digest(value: String) = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

    @Test fun currentCandidatePreservesOriginalAccountAndAllBookings() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("releaseBAcceptance") == "true")
        val context = instrumentation.targetContext
        assertEquals("samsung", Build.MANUFACTURER.lowercase())
        assertEquals(36, Build.VERSION.SDK_INT)
        assertEquals("uk.thewyj.app", context.packageName)
        assertFalse(BuildConfig.DEBUG)
        assertFalse(BuildConfig.PAYMENT_DEVICE_TEST)
        assertFalse(BuildConfig.PAYMENT_DIAGNOSTICS)
        val installed = context.packageManager.getPackageInfo(context.packageName, 0)
        assertEquals(50L, installed.longVersionCode)
        assertEquals("1.3.37", installed.versionName)
        val baseline = context.getSharedPreferences("task25.formal.acceptance", Context.MODE_PRIVATE)
        assertTrue("A real pre-upgrade account baseline is required", baseline.contains("original_account_digest"))
        assertTrue("A real pre-upgrade Room baseline is required", baseline.contains("original_bookings_digest"))
        val saved = SecureCredentialStore(context).loadActive()
        assertNotNull("Existing encrypted credentials must survive the upgrade", saved)
        assertEquals(baseline.getString("original_account_digest", null), digest(saved!!.account.id))
        val bookings = RoomPaymentRecognitionStore(NotificationDatabase.get(context)).localBookings(saved.account.id)
        assertEquals(baseline.getInt("original_bookings_count", -1), bookings.size)
        assertEquals("Every original booking must remain identical", baseline.getString("original_bookings_digest", null), digest(bookings.toString()))
        instrumentation.sendStatus(0, Bundle().apply {
            putString("releaseBPreservation", "version=${installed.versionName}/${installed.longVersionCode} originalAccountSame=true encryptedSessionPresent=true originalBookings=${bookings.size} everyOriginalBookingSame=true deviceTest=false diagnostics=false")
        })
    }
}
