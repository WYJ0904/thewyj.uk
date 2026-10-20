package uk.thewyj.app.qa.finance
import android.content.Intent
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.MainActivity
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
@RunWith(AndroidJUnit4::class)
class FinanceDeviceDiagnosticsTest {
    private fun find(v:View):WebView?{if(v is WebView)return v;if(v is ViewGroup)for(i in 0 until v.childCount)find(v.getChildAt(i))?.let{return it};return null}
    private fun eval(s:ActivityScenario<MainActivity>,code:String):String{
        val done=CountDownLatch(1);var value="null"
        s.onActivity{a->find(a.window.decorView)?.evaluateJavascript(code){r->value=r;done.countDown()}?:done.countDown()}
        assertTrue(done.await(5,TimeUnit.SECONDS));return value
    }
    private fun snapshot(s:ActivityScenario<MainActivity>):JSONObject{
        val result=JSONObject(JSONArray("["+eval(s,"JSON.stringify({path:location.pathname,visibility:document.visibilityState,active:document.documentElement.dataset.androidWebActive,fields:Object.fromEntries(['financeExpenseTotal','financeRefundTotal','financeBalanceTotal','financeTransactionCount','dashboardFinanceBalance','dashboardFinanceSync'].map(id=>[id,document.getElementById(id)?.textContent])),classes:Object.fromEntries(['publicHome','financePage','financeWorkspace'].map(id=>[id,document.getElementById(id)?.className]))})")+"]").getString(0))
        s.onActivity{a->result.put("activity_focus",a.hasWindowFocus());find(a.window.decorView)?.let{w->result.put("webview_shown",w.isShown).put("width",w.width).put("height",w.height)}}
        return result
    }
    @Test fun inspectActualFinancialBackNavigationWithoutChangingState(){
        val c=InstrumentationRegistry.getInstrumentation().targetContext
        ActivityScenario.launch<MainActivity>(Intent(c,MainActivity::class.java).setData(Uri.parse("thewyj://app?route=%2Ffinance"))).use{s->
            val end=android.os.SystemClock.elapsedRealtime()+20000
            while(eval(s,"document.getElementById('financeExpenseTotal')?.textContent.includes('170.00')")!="true"&&android.os.SystemClock.elapsedRealtime()<end)Thread.sleep(100)
            FinanceDeviceSupport.record(c,"DEVICE-UI-DIAGNOSTIC-BEFORE",snapshot(s))
            eval(s,"document.getElementById('financeBackBtn').click();true");Thread.sleep(1500)
            FinanceDeviceSupport.record(c,"DEVICE-UI-DIAGNOSTIC-AFTER",snapshot(s))
        }
    }
    @Test fun independentActualMainActivityStopResumeRecreate(){
        val c=InstrumentationRegistry.getInstrumentation().targetContext
        ActivityScenario.launch<MainActivity>(Intent(c,MainActivity::class.java).setData(Uri.parse("thewyj://app?route=%2Ffinance"))).use{s->
            repeat(3){round->val t=android.os.SystemClock.elapsedRealtime();s.moveToState(Lifecycle.State.CREATED);s.moveToState(Lifecycle.State.RESUMED);assertEquals(Lifecycle.State.RESUMED,s.state);s.recreate();assertEquals(Lifecycle.State.RESUMED,s.state)
                FinanceDeviceSupport.record(c,"DEVICE-INDEPENDENT-MAIN-$round",JSONObject().put("state",s.state.name).put("elapsed_ms",android.os.SystemClock.elapsedRealtime()-t))}
        }
    }
}
