package uk.thewyj.app.qa.finance
import android.app.KeyguardManager
import android.content.Intent
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeFalse
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.MainActivity
@RunWith(AndroidJUnit4::class)
class FinanceDeviceScreenTest {
    @Test fun ownedQaScreenOffWakeAndNormalUnlockResume(){
        val i=InstrumentationRegistry.getInstrumentation();val c=i.targetContext
        val keyguard=c.getSystemService(KeyguardManager::class.java);val power=c.getSystemService(PowerManager::class.java)
        assumeFalse("Normal owner unlock required before this scenario",keyguard.isKeyguardLocked)
        fun key(code:Int){ParcelFileDescriptor.AutoCloseInputStream(i.uiAutomation.executeShellCommand("input keyevent $code")).use{it.readBytes()}}
        ActivityScenario.launch<MainActivity>(Intent(c,MainActivity::class.java).setData(Uri.parse("thewyj://app?route=%2Ffinance"))).use{s->
            s.onActivity{assertTrue("Only the foreground QA window may start screen test",it.hasWindowFocus())}
            key(223);val offEnd=android.os.SystemClock.elapsedRealtime()+5000
            while(power.isInteractive&&android.os.SystemClock.elapsedRealtime()<offEnd)Thread.sleep(100)
            assertFalse("Actual screen off",power.isInteractive)
            key(224);val unlockStart=android.os.SystemClock.elapsedRealtime();val unlockEnd=unlockStart+20000
            while((!power.isInteractive||keyguard.isKeyguardLocked)&&android.os.SystemClock.elapsedRealtime()<unlockEnd)Thread.sleep(100)
            val locked=keyguard.isKeyguardLocked
            FinanceDeviceSupport.record(c,"DEVICE-SCREEN-WAKE",JSONObject().put("screen_off_observed",true).put("interactive",power.isInteractive).put("normal_unlock_wait_ms",android.os.SystemClock.elapsedRealtime()-unlockStart).put("keyguard_locked",locked))
            assumeFalse("Screen woke; owner normal unlock still required; recovery NOT TESTED",locked)
            val resumeStart=android.os.SystemClock.elapsedRealtime()
            while(s.state!=Lifecycle.State.RESUMED&&android.os.SystemClock.elapsedRealtime()-resumeStart<20000)Thread.sleep(100)
            assertEquals(Lifecycle.State.RESUMED,s.state)
            FinanceDeviceSupport.record(c,"DEVICE-SCREEN-RESUME",JSONObject().put("state",s.state.name).put("resume_ms",android.os.SystemClock.elapsedRealtime()-resumeStart))
        }
    }
}
