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
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.MainActivity
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
@RunWith(AndroidJUnit4::class)
class FinanceDeviceMainTest {
    private fun find(v:View):WebView? {if(v is WebView)return v;if(v is ViewGroup)for(i in 0 until v.childCount)find(v.getChildAt(i))?.let{return it};return null}
    private fun js(s:ActivityScenario<MainActivity>,code:String):String{
        val done=CountDownLatch(1);var output="NO_WEBVIEW"
        s.onActivity{a-> val web=find(a.window.decorView);if(web==null)done.countDown() else web.evaluateJavascript(code){value->output=value;done.countDown()}}
        assertTrue("UI-thread WebView callback",done.await(5,TimeUnit.SECONDS));return output
    }
    private fun waitFor(s:ActivityScenario<MainActivity>,code:String):String{
        val end=android.os.SystemClock.elapsedRealtime()+20000;var value=""
        while(android.os.SystemClock.elapsedRealtime()<end){value=js(s,code);if(value=="true")return value;Thread.sleep(200)}
        fail("Actual MainActivity WebView condition failed; last=$value");return value
    }
    @Test fun actualMainActivityThreeSurfacesAndLifecycle(){
        val c=InstrumentationRegistry.getInstrumentation().targetContext
        val intent=Intent(c,MainActivity::class.java).setData(Uri.parse("thewyj://app?route=%2Ffinance"))
        ActivityScenario.launch<MainActivity>(intent).use{s->
            waitFor(s,"Boolean(document.getElementById('financeWorkspace') && !document.getElementById('financeWorkspace').classList.contains('hidden'))")
            waitFor(s,"document.getElementById('financeExpenseTotal').textContent.includes('170.00') && document.getElementById('financeRefundTotal').textContent.includes('20.00') && document.getElementById('financeBalanceTotal').textContent.includes('150.00')")
            js(s,"document.getElementById('financeRecordedSection').open=true;document.getElementById('financeAllMonthsBtn').click();true")
            waitFor(s,"['80.00','90.00','20.00'].every(x=>document.getElementById('financeTransactionList').textContent.includes(x))")
            val displayed=JSONObject(org.json.JSONArray("["+js(s,"JSON.stringify({expense:document.getElementById('financeExpenseTotal').textContent,refund:document.getElementById('financeRefundTotal').textContent,balance:document.getElementById('financeBalanceTotal').textContent,historyCount:document.getElementById('financeTransactionCount').textContent})")+"]").getString(0))
            assertTrue("Negative balance sign must be visible",displayed.getString("balance").any{it=='-'||it=='\u2212'})
            FinanceDeviceSupport.record(c,"DEVICE-WEB-FINANCE",JSONObject().put("displayed",displayed).put("actual_main_activity",true).put("webview_ui_thread",true))
            js(s,"document.getElementById('financeBackBtn').click();true")
            waitFor(s,"document.getElementById('dashboardFinanceBalance').textContent.includes('150.00')")
            val dashboard=org.json.JSONArray("["+js(s,"document.getElementById('dashboardFinanceBalance').textContent")+"]").getString(0)
            assertTrue("Dashboard negative balance sign",dashboard.any{it=='-'||it=='\u2212'})
            FinanceDeviceSupport.record(c,"DEVICE-WEB-DASHBOARD",JSONObject().put("actual_text",dashboard).put("actual_android_page",true))
            repeat(3){round->
                val start=android.os.SystemClock.elapsedRealtime();s.moveToState(Lifecycle.State.CREATED);s.moveToState(Lifecycle.State.RESUMED)
                assertEquals(Lifecycle.State.RESUMED,s.state);s.recreate();assertEquals(Lifecycle.State.RESUMED,s.state)
                waitFor(s,"Boolean(document.getElementById('dashboardFinanceBalance'))")
                FinanceDeviceSupport.record(c,"DEVICE-MAIN-LIFECYCLE-$round",JSONObject().put("elapsed_ms",android.os.SystemClock.elapsedRealtime()-start).put("state",s.state.name))
            }
        }
    }
}
