package uk.thewyj.app.task21.payment

import android.app.Application
import android.content.Intent
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

/** Real service entry points, synthetic metadata, no bank account or page content. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class ServiceResourceContractTest {
    @After fun cleanup(){PaymentAccessibilityDeviceTest.install(null);PaymentTicketPackageSignal.clear()}
    private fun event()=AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED).apply{
        packageName="qa.synthetic.unrelated";className="android.widget.FrameLayout"
    }
    private fun record(id:String,events:Int,lookups:Int,started:Long){
        val out=File(System.getProperty("finance.p02.output")).apply{mkdirs()}
        File(out,"service-resources.ndjson").appendText(JSONObject().put("id",id).put("status","PASS")
            .put("events",events).put("gateway_lookups",lookups).put("duration_ms",(System.nanoTime()-started)/1_000_000)
            .put("raw_page_text_read",false).put("screenshots",0).put("ledger_writes",0).put("synthetic_only",true).toString()+"\n")
    }
    @Test fun thousandUnrelatedEventsCoalesceTheBlockedRepositoryRefresh(){
        val started=System.nanoTime();val entered=CountDownLatch(1);val release=CountDownLatch(1);val completed=CountDownLatch(1);val queries=AtomicInteger()
        PaymentAccessibilityDeviceTest.install(object:PaymentAccessibilityGateway{
            override fun financeAccountId():String?{
                assertNotEquals(Looper.getMainLooper(),Looper.myLooper());queries.incrementAndGet();entered.countDown()
                check(release.await(5,TimeUnit.SECONDS));completed.countDown();return null
            }
            override fun activePackages(accountId:String,nowMs:Long):Set<String> = error("No account: must not query a ticket database")
            override fun activeTicket(accountId:String,sourcePackage:String):PaymentTicket? = error("No ticket: must not read a page")
            override fun enrich(accountId:String,ticketId:String,enrichment:PaymentEnrichment):EnrichmentOutcome = error("No page enrichment allowed")
        },blockContentReadsForAudit=true)
        val controller=Robolectric.buildService(ThewyjPaymentAccessibilityService::class.java).create()
        try{
            ReflectionHelpers.callInstanceMethod<Unit>(controller.get(),"onServiceConnected");assertTrue(entered.await(5,TimeUnit.SECONDS))
            val before=PaymentAccessibilityStatus.lastParserResult
            repeat(1000){val e=event();controller.get().onAccessibilityEvent(e);e.recycle()}
            assertEquals(1,queries.get());assertEquals(before,PaymentAccessibilityStatus.lastParserResult)
            assertEquals(0,PaymentAccessibilityStatus.lastTextLineCount)
            release.countDown();assertTrue(completed.await(5,TimeUnit.SECONDS))
            record("noise-1000",1000,queries.get(),started)
        }finally{release.countDown();controller.destroy()}
    }
    @Test fun unboundServiceIgnoresQueuedNoiseAndStaleTicketSignals(){
        val started=System.nanoTime();val controller=Robolectric.buildService(ThewyjPaymentAccessibilityService::class.java).create()
        try{
            controller.get().onUnbind(Intent());PaymentTicketPackageSignal.publish("qa.synthetic.unrelated")
            val before=PaymentAccessibilityStatus.lastParserResult
            repeat(1000){val e=event();controller.get().onAccessibilityEvent(e);e.recycle()}
            assertEquals(before,PaymentAccessibilityStatus.lastParserResult);assertFalse(PaymentAccessibilityStatus.connected)
            record("unbound-1000",1000,0,started)
        }finally{controller.destroy()}
    }
    @Test fun destroyedServiceCannotReopenTheGateFromNewEvents(){
        val started=System.nanoTime();val controller=Robolectric.buildService(ThewyjPaymentAccessibilityService::class.java).create();val service=controller.get()
        controller.destroy();PaymentTicketPackageSignal.publish("qa.synthetic.unrelated")
        val before=PaymentAccessibilityStatus.lastParserResult
        repeat(1000){val e=event();service.onAccessibilityEvent(e);e.recycle()}
        assertEquals(before,PaymentAccessibilityStatus.lastParserResult);assertFalse(PaymentAccessibilityStatus.connected)
        record("destroyed-1000",1000,0,started)
    }
}
