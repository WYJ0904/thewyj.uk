package uk.thewyj.app.qa.finance
import android.app.Application
import android.app.KeyguardManager
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.MainActivity

@RunWith(AndroidJUnit4::class)
class FinanceFinishLifecycleTest {
    private val c get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Before fun precondition(){FinanceFinishProbe.install(c.applicationContext as Application);assumeFalse("Owner normal unlock required before UI scenario",c.getSystemService(KeyguardManager::class.java).isKeyguardLocked)}
    @After fun end(){FinanceFinishProbe.mark("idle")}
    private fun <A:android.app.Activity> rounds(type:Class<A>,name:String){
        val intent=Intent(c,type);if(type==MainActivity::class.java)intent.data=Uri.parse("thewyj://app?route=%2Ffinance")
        FinanceFinishProbe.mark("$name-launch")
        ActivityScenario.launch<A>(intent).use{s->
            repeat(30){round->
                val start=SystemClock.elapsedRealtime()
                assertFalse("Unexpected lock during controlled sequence",c.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
                FinanceFinishProbe.mark("$name-$round-stop");s.moveToState(Lifecycle.State.CREATED);assertEquals(Lifecycle.State.CREATED,s.state)
                FinanceFinishProbe.mark("$name-$round-resume");s.moveToState(Lifecycle.State.RESUMED);assertEquals(Lifecycle.State.RESUMED,s.state)
                var before=0;s.onActivity{before=System.identityHashCode(it)}
                FinanceFinishProbe.mark("$name-$round-recreate");s.recreate();assertEquals(Lifecycle.State.RESUMED,s.state)
                s.onActivity{assertNotEquals("Recreation must replace instance",before,System.identityHashCode(it))}
                FinanceDeviceSupport.record(c,"FINISH-$name-$round",JSONObject().put("elapsed_ms",SystemClock.elapsedRealtime()-start).put("state",s.state.name))
            }
            FinanceFinishProbe.mark("$name-teardown")
        }
    }
    @Test fun minimalActivityThirtyStopResumeRecreateRounds()=rounds(FinanceFinishPlainActivity::class.java,"PLAIN")
    @Test fun productMainActivityThirtyStopResumeRecreateRounds()=rounds(MainActivity::class.java,"MAIN")
    @Test fun foregroundBackgroundViaNormalOwnedActivity(){
        ActivityScenario.launch<MainActivity>(Intent(c,MainActivity::class.java).setData(Uri.parse("thewyj://app?route=%2Ffinance"))).use{s->
            repeat(5){round->
                FinanceFinishProbe.mark("normal-cover-$round")
                val start=SystemClock.elapsedRealtime();s.onActivity{it.startActivity(Intent(it,FinanceFinishCoverActivity::class.java))}
                val stopEnd=start+5000;while(s.state!=Lifecycle.State.CREATED&&SystemClock.elapsedRealtime()<stopEnd)Thread.sleep(20)
                assertEquals("Real opaque cover must stop MainActivity",Lifecycle.State.CREATED,s.state)
                val resumeEnd=SystemClock.elapsedRealtime()+20000;while(s.state!=Lifecycle.State.RESUMED&&SystemClock.elapsedRealtime()<resumeEnd)Thread.sleep(20)
                assertEquals("Normal cover finish must resume MainActivity",Lifecycle.State.RESUMED,s.state)
                FinanceDeviceSupport.record(c,"FINISH-NORMAL-BACKGROUND-$round",JSONObject().put("elapsed_ms",SystemClock.elapsedRealtime()-start).put("state",s.state.name))
            }
        }
    }
}
