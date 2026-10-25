package uk.thewyj.app.task21.payment

import android.graphics.*
import android.os.SystemClock
import androidx.lifecycle.Lifecycle
import androidx.room.Room
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runners.MethodSorters
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.MainActivity
import uk.thewyj.app.task21.store.*

private fun attempt()=InstrumentationRegistry.getArguments().getString("closeoutAttempt","r1").also {require(it.matches(Regex("r[0-9]+")))}
private val target get()=InstrumentationRegistry.getInstrumentation().targetContext
private fun folder()=File(target.filesDir,"closeout-${attempt()}").apply{mkdirs()}
private fun write(row:JSONObject){File(folder(),"results.ndjson").appendText(row.put("pid",android.os.Process.myPid()).put("synthetic_only",true).put("provider_proof",false).toString()+"\n")}
private fun image(lines:List<String>):Bitmap {
    val bitmap=Bitmap.createBitmap(1080,2200,Bitmap.Config.ARGB_8888);val canvas=Canvas(bitmap);canvas.drawColor(Color.WHITE)
    val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.BLACK;textSize=54f;typeface=Typeface.create("sans-serif",Typeface.NORMAL)}
    lines.forEachIndexed{i,text->canvas.drawText(text,90f,150f+i*145f,paint)};return bitmap
}
private fun fields(value:PaymentEnrichment?)=if(value==null)JSONObject.NULL else JSONObject()
    .put("amount_minor",value.amountMinor ?: JSONObject.NULL).put("currency",value.currency ?: JSONObject.NULL)
    .put("direction",value.direction?.name ?: JSONObject.NULL).put("completion",value.completionConfirmed)
    .put("amount_decimal",value.amountDecimalCandidate ?: JSONObject.NULL).put("provider_reference",value.providerReference ?: JSONObject.NULL)
    .put("source_package",value.sourcePackage).put("source_instance_uncertain",value.sourceInstanceUncertain)

@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class CloseoutEmulatorTest {
    private class Observed(val sdk:MlKitOcrEngine):AmountConfirmingOcrEngine {
        var lines=emptyList<String>();var confirmation:Long?=null
        override suspend fun recognize(bitmap:Bitmap)=sdk.recognize(bitmap).also{lines=it}
        override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long)=sdk.confirmAmount(bitmap,expectedMinor).also{confirmation=it}
        override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long,currency:String)=sdk.confirmAmount(bitmap,expectedMinor,currency).also{confirmation=it}
    }
    @Test fun test00_actualSdkPixelMatrix(){
        val bytes=InstrumentationRegistry.getInstrumentation().context.assets.open("closeout-cases.json").use{it.readBytes()}
        File(folder(),"cases.json").writeBytes(bytes);val cases=JSONArray(String(bytes));val failures=mutableListOf<String>()
        val sdk=MlKitOcrEngine(target)
        for(i in 0 until cases.length()){
            val case=cases.getJSONObject(i);val id=case.getString("id");val lines=case.getJSONArray("lines").let{a->(0 until a.length()).map(a::getString)}
            val bitmap=image(lines);val png=File(folder(),"$id.png");check(!png.exists())
            png.outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
            val observed=Observed(sdk);val started=SystemClock.elapsedRealtime()
            var result:PaymentEnrichment?=null;var error=""
            try{
                result=runBlocking{PaymentScreenshotVerifier(observed).verifyCurrent(bitmap,"com.tencent.mm",System.currentTimeMillis(),
                    case.optString("default").takeIf{it.isNotBlank()},2){true}}
                when{
                    case.optBoolean("reject")->assertNull(id,result)
                    case.has("decimal")->{assertNotNull(id,result);assertEquals(id,case.getString("decimal"),result!!.amountDecimalCandidate);assertNull(id,result.amountMinor);assertNull(id,result.currency);assertFalse(id,result.completionConfirmed)}
                    else->{assertNotNull(id,result);assertEquals(id,case.getLong("minor"),result!!.amountMinor);assertEquals(id,case.getString("currency"),result.currency)
                        assertEquals(id,case.getBoolean("completion"),result.completionConfirmed)
                        if(case.has("direction"))assertEquals(id,case.getString("direction"),result.direction?.name ?: "UNKNOWN")
                        assertEquals(id,case.getLong("minor"),observed.confirmation)
                    }
                }
            }catch(failure:Throwable){error=failure.stackTraceToString();failures+=id}
            finally{bitmap.recycle()}
            write(JSONObject().put("id",id).put("kind","SDK_PIXEL").put("status",if(error.isBlank())"PASS" else "FAIL")
                .put("case",case).put("sdk_lines",JSONArray(observed.lines)).put("actual",fields(result))
                .put("secondary_minor",observed.confirmation ?: JSONObject.NULL).put("duration_ms",SystemClock.elapsedRealtime()-started)
                .put("error",error).put("source_argument_is_synthetic",true).put("ledger_writes",0))
        }
        assertTrue("Actual SDK failures retained: $failures",failures.isEmpty())
    }
    @Test fun test01_staleAccountProfileAndContentAreDiscardedWithRealSdk()=runBlocking {
        val sdk=MlKitOcrEngine(target);val ready=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();var calls=0
        val engine=object:AmountConfirmingOcrEngine {
            override suspend fun recognize(bitmap:Bitmap):List<String>{val lines=sdk.recognize(bitmap);if(++calls==1){ready.complete(Unit);release.await()};return lines}
            override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long)=sdk.confirmAmount(bitmap,expectedMinor)
            override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long,currency:String)=sdk.confirmAmount(bitmap,expectedMinor,currency)
        }
        val bitmap=image(listOf("付款详情","付款成功","实付 CNY 0.01"));val verifier=PaymentScreenshotVerifier(engine)
        val epoch=PaymentPageEvidenceEpoch();val old=epoch.capture();var account="synthetic-a";var profile=0
        try{
            val first=async(Dispatchers.Default){verifier.verifyCurrent(bitmap,"com.tencent.mm",1000L,null,2){epoch.current(old)&&account=="synthetic-a"&&profile==0}}
            withTimeout(15000){ready.await()};epoch.invalidate();account="synthetic-b";profile=95;val current=epoch.capture()
            val second=async(Dispatchers.Default){verifier.verifyCurrent(bitmap,"com.tencent.mm",1000L,null,2){epoch.current(current)&&account=="synthetic-b"&&profile==95}}
            release.complete(Unit);assertNull(first.await());assertEquals(1L,second.await()!!.amountMinor)
            write(JSONObject().put("id","scope-epoch").put("status","PASS").put("actual_sdk_primary_calls",calls).put("old_result_discarded",true))
        }finally{release.complete(Unit);bitmap.recycle()}
    }
    @Test fun test02_cancelledDelayedSdkCallbackNeverPublishes()=runBlocking {
        val sdk=MlKitOcrEngine(target);val ready=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
        val engine=object:OcrEngine{override suspend fun recognize(bitmap:Bitmap):List<String>{val lines=sdk.recognize(bitmap);ready.complete(Unit);release.await();return lines}}
        val bitmap=image(listOf("付款详情","付款成功","实付 CNY 0.01"))
        try{
            val result=async(Dispatchers.Default){PaymentScreenshotVerifier(engine).verifyCurrent(bitmap,"com.tencent.mm",1000L,null,2){true}}
            withTimeout(15000){ready.await()};result.cancelAndJoin();release.complete(Unit);assertTrue(result.isCancelled)
            write(JSONObject().put("id","cancelled-callback").put("status","PASS").put("real_sdk_completed_before_delayed_callback",true))
        }finally{release.complete(Unit);bitmap.recycle()}
    }
    @Test fun test03_activityStopsResumesAndRecreates(){
        assertEquals("https://isolated-finance.invalid",BuildConfig.THEWYJ_BASE_URL)
        val scenario=ActivityScenario.launch(MainActivity::class.java);val cycles=JSONArray()
        try{repeat(3){val start=SystemClock.elapsedRealtime();scenario.moveToState(Lifecycle.State.CREATED);assertEquals(Lifecycle.State.CREATED,scenario.state)
            scenario.moveToState(Lifecycle.State.RESUMED);scenario.recreate();assertEquals(Lifecycle.State.RESUMED,scenario.state)
            cycles.put(JSONObject().put("round",it+1).put("duration_ms",SystemClock.elapsedRealtime()-start))}}
        finally{scenario.close()}
        assertEquals(Lifecycle.State.DESTROYED,scenario.state);write(JSONObject().put("id","activity").put("status","PASS").put("cycles",cycles))
    }
    @Test fun test04_budgetPersistsBeforeRealProcessDeath(){
        val db=Room.databaseBuilder(target,NotificationDatabase::class.java,"closeout-budget-${attempt()}.db").build()
        try{val store=RoomPaymentRecognitionStore(db);val ticket=PaymentTicketEngine(now={1000L}).create("synthetic-budget","synthetic-rec","com.tencent.mm","synthetic-event","wechat")
            assertEquals(90000L,ticket.expiresAtMs-ticket.createdAtMs);store.saveTicket(ticket)
            repeat(8){assertTrue(PaymentPersistedScanBudget.reserve(store,"synthetic-budget",ticket.ticketId,1000L+it*250L))}
            assertFalse(PaymentPersistedScanBudget.reserve(store,"synthetic-budget",ticket.ticketId,4000L))
            File(folder(),"budget-seed.json").writeText(JSONObject().put("ticket",ticket.ticketId).put("expires",ticket.expiresAtMs).put("pid",android.os.Process.myPid()).toString())
            write(JSONObject().put("id","budget-seed").put("status","PASS").put("attempts",8))
        }finally{db.close()}
    }
}

class CloseoutBudgetRestoreTest {
    @Test fun freshAndroidProcessCannotResetSpentBudget(){
        val saved=JSONObject(File(folder(),"budget-seed.json").readText());assertNotEquals(saved.getInt("pid"),android.os.Process.myPid())
        val db=Room.databaseBuilder(target,NotificationDatabase::class.java,"closeout-budget-${attempt()}.db").build()
        try{val store=RoomPaymentRecognitionStore(db);val ticket=store.ticket("synthetic-budget",saved.getString("ticket"))!!
            assertEquals(8,ticket.scanAttempts);assertEquals(saved.getLong("expires"),ticket.expiresAtMs)
            assertFalse(PaymentPersistedScanBudget.reserve(store,"synthetic-budget",ticket.ticketId,4000L))
            assertFalse(PaymentPersistedScanBudget.reserve(store,"different-account",ticket.ticketId,4000L))
            write(JSONObject().put("id","budget-restore").put("status","PASS").put("attempts",8).put("seed_pid",saved.getInt("pid")))
        }finally{db.close()}
    }
}
