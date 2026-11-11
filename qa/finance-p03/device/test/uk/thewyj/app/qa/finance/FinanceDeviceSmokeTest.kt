package uk.thewyj.app.qa.finance
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.task21.store.NotificationDatabase
@RunWith(AndroidJUnit4::class)
class FinanceDeviceSmokeTest {
 @Test fun isolatedInstalledCandidate(){
  val c=InstrumentationRegistry.getInstrumentation().targetContext
  assertEquals("uk.thewyj.app.debug",c.packageName)
  assertTrue(BuildConfig.THEWYJ_BASE_URL.startsWith("https://localhost:"))
  assertEquals(36,android.os.Build.VERSION.SDK_INT)
  assertEquals("SM-S9360",android.os.Build.MODEL)
  assertEquals(14,NotificationDatabase.SCHEMA_VERSION)
  assertFalse(FinanceDeviceGate.enabled(c))
 }
}
