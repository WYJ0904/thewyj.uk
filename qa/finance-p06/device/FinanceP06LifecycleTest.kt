package uk.thewyj.app.qa.financep06

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uk.thewyj.app.MainActivity

class FinanceP06PlainActivity:Activity() {
    override fun onCreate(b:Bundle?){super.onCreate(b);setContentView(TextView(this).apply{text="FINANCE P06 ISOLATED LIFECYCLE CONTROL"});window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
}
class FinanceP06LifecycleTest {
    private fun <A:Activity> rounds(type:Class<A>,name:String){
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val keyguard=context.getSystemService(KeyguardManager::class.java)
        assertFalse("Normal unlock is a precondition, not an extended timeout",keyguard.isKeyguardLocked)
        val helper=Intent().setClassName(context.packageName,"androidx.test.core.app.InstrumentationActivityInvoker\$EmptyActivity")
        val resolved=context.packageManager.resolveActivity(helper,0)
        assertNotNull("D-01 helper must be in target package",resolved)
        assertEquals(android.os.Process.myUid(),resolved!!.activityInfo.applicationInfo.uid)
        val attempt=InstrumentationRegistry.getArguments().getString("closeoutAttempt","r3")!!
        val dir=File(context.filesDir,"closeout-$attempt").apply{mkdirs()}
        ActivityScenario.launch(type).use {scenario->
            repeat(30){round->
                assertFalse(keyguard.isKeyguardLocked)
                val started=SystemClock.elapsedRealtime()
                scenario.moveToState(Lifecycle.State.CREATED);assertEquals(Lifecycle.State.CREATED,scenario.state)
                scenario.moveToState(Lifecycle.State.RESUMED);assertEquals(Lifecycle.State.RESUMED,scenario.state)
                var previous=0;scenario.onActivity{previous=System.identityHashCode(it)}
                scenario.recreate();assertEquals(Lifecycle.State.RESUMED,scenario.state)
                scenario.onActivity{assertNotEquals(previous,System.identityHashCode(it))}
                File(dir,"results.ndjson").appendText(JSONObject().put("id","$name-$round").put("status","PASS").put("duration_ms",SystemClock.elapsedRealtime()-started)
                    .put("helper_uid",resolved.activityInfo.applicationInfo.uid).put("qa_uid",android.os.Process.myUid()).put("synthetic_only",true).toString()+"\n")
            }
        }
    }
    @Test fun plainActivityThirtyRounds()=rounds(FinanceP06PlainActivity::class.java,"PLAIN")
    @Test fun productMainActivityThirtyRounds()=rounds(MainActivity::class.java,"MAIN")
}
