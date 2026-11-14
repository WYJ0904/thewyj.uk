package uk.thewyj.app.task21.payment

import android.app.Application
import android.content.Context
import android.database.Cursor
import androidx.room.Room
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.store.*
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome
import java.io.File

/** Trace frozen truths separately from new safety assertions: no red becomes a pass here. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34], application=Application::class)
class FinanceP03FinishTraceTest {
    private val context: Context get()=RuntimeEnvironment.getApplication()
    private val owner="synthetic-finish-owner"
    private val out get()=File(System.getProperty("finance.finish.trace.output")).apply{mkdirs()}
    private fun fixture(id:String):JSONObject {
        val cases=JSONObject(File(System.getProperty("finance.p02.root"),"fixtures/matrix.json").readText()).getJSONArray("cases")
        return (0 until cases.length()).map{cases.getJSONObject(it)}.single{it.getString("case_id")==id}
    }
    private fun snapshot(db:NotificationDatabase):JSONObject {
        val result=JSONObject()
        val tables=mutableListOf<String>()
        db.openHelper.readableDatabase.query("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'payment_%' OR name='local_payment_bookings') ORDER BY name").use{c->while(c.moveToNext())tables+=c.getString(0)}
        for(table in tables){
            check(table.matches(Regex("[a-z_]+")))
            val rows=JSONArray()
            db.openHelper.readableDatabase.query("SELECT * FROM $table").use{c->while(c.moveToNext()){
                val row=JSONObject()
                for(i in 0 until c.columnCount)row.put(c.getColumnName(i),when(c.getType(i)){
                    Cursor.FIELD_TYPE_NULL->JSONObject.NULL;Cursor.FIELD_TYPE_INTEGER->c.getLong(i);Cursor.FIELD_TYPE_FLOAT->c.getDouble(i);else->c.getString(i)
                });rows.put(row)
            }}
            result.put(table,rows)
        }
        return result
    }
    private fun write(name:String,data:Any){val f=File(out,name);check(!f.exists());f.writeText(data.toString())}
    private fun traceClearing(id:String,expectedSafeExpense:Long){
        val f=fixture(id);val db=Room.inMemoryDatabaseBuilder(context,NotificationDatabase::class.java).allowMainThreadQueries().build()
        try{
            val store=RoomPaymentRecognitionStore(db);val c=PaymentRecognitionCoordinator(store,now={1000L});val steps=JSONArray();val events=f.getJSONArray("events")
            for(i in 0 until events.length()){
                val e=events.getJSONObject(i);val phase=e.getString("state");val amount=e.getLong("minor")/100.0
                val text=when(phase){"authorization"->"预授权 USD $amount";"settlement"->"结算成功 已扣款 USD $amount";"release","expiry"->"预授权解除 USD $amount";else->"退款成功 USD $amount"}+
                    e.optString("reference").takeIf{it.isNotBlank()}?.let{" 交易号 $it"}.orEmpty()
                val source="sms#event#p02-preauth-$i"
                val parsed=PaymentParserRegistry.parse("sms",PaymentSourceType.SMS,"【合成银行】",text,capturedAtMs=1000L+i)
                val outcome=c.onSourceEvent(owner,"sms",PaymentSourceType.SMS,source,"【合成银行】",text,uploadEventId="p02-preauth-$i")
                assertNotNull("Source evidence must remain",store.recognitionBySourceEvent(owner,source))
                steps.put(JSONObject().put("index",i).put("original_event",e).put("exact_frozen_text",text).put("parsed",parsed.toString()).put("outcome",outcome.toString()).put("database",snapshot(db)))
            }
            val actual=store.localBookings(owner).filter{it.direction=="EXPENSE"}.sumOf{it.amountMinor}
            write("$id-trace.json",JSONObject().put("case_id",id).put("fixture",f).put("steps",steps).put("original_expected_expense_minor",17000).put("actual_expense_minor",actual).put("original_business_status","EXPECTED_RED").put("new_safety_trace_is_not_business_pass",true).put("outbox_scope","core-only; no fake HTTP/receipt claim"))
            assertEquals(expectedSafeExpense,actual)
            assertTrue("Authorization never creates formal spend",store.localBookings(owner).none{it.eventId=="p02-preauth-0"})
        }finally{db.close()}
    }
    @Test fun traceC005RetainsEverySourceWithoutInventingIndependentCaptures()=traceClearing("C005",8000L)
    @Test fun traceC007RetainsMissingReferenceEvidenceAndNoUnprovedExpense()=traceClearing("C007",0L)
    @Test fun allTwentyFourEmptyIdentityTruthClaimsStaySeparateFromActualHookSafety(){
        val ids="A009 A011 A021 A023 A069 A071 A117 A119 A165 A167 A201 A203 A213 A215 A261 A263 A309 A311 A357 A359 A393 A395 A405 A407".split(" ")
        val db=Room.inMemoryDatabaseBuilder(context,NotificationDatabase::class.java).allowMainThreadQueries().build()
        try{
            val store=RoomPaymentRecognitionStore(db)
            val execute=FinanceP02MatrixTest::class.java.getDeclaredMethod("execute",JSONObject::class.java,RoomPaymentRecognitionStore::class.java).apply{isAccessible=true}
            val frozen=FinanceP02MatrixTest();val rows=JSONArray()
            for(id in ids){
                db.clearAllTables();context.getSharedPreferences("wyj-payment-notification-lifecycles",Context.MODE_PRIVATE).edit().clear().commit()
                val f=fixture(id);val direct=execute.invoke(frozen,f,store) as JSONObject
                val frozenExpected=f.getJSONObject("expected").getInt("records")
                assertNotEquals("The original unresolved oracle is not silently changed",frozenExpected,direct.getInt("records"))
                db.clearAllTables()
                val sink=object:NotificationArchiveSink{
                    override fun store(a:String,i:NotificationCaptureInput,p:StructuredNotificationEvent?)=false
                    override fun markRemoved(a:String,i:NotificationCaptureInput)=Unit
                    override fun storeMediaStoreScreenshot(a:String,e:ScreenshotMediaEvent)=ScreenshotArchiveOutcome.SKIPPED
                }
                val hook=AndroidPaymentRecognitionHook(context,sink,store,testing=true,notifierOverride=object:PaymentStatusNotifier{
                    override fun notify(message:PaymentStatusNotificationMessage)=true
                    override fun cancel(notificationId:Int)=Unit
                })
                val eventIds=direct.getJSONArray("event_ids")
                for(i in 0 until eventIds.length()){
                    val event=eventIds.getString(i)
                    val input=NotificationCaptureInput(sourcePackage=f.getString("package"),notificationKey="${f.getString("package")}:p02-slot-a",notificationId=7,tag="p02-tag",title="合成支付",text="支付成功 ¥648.00",postTime=1_000_000L+i,receivedAtMs=1_000_000L+i,paymentEventId=event)
                    hook.onCapture(owner,input,"合成支付",event)
                }
                assertEquals("Actual Android hook must quarantine missing operation identity",0,store.localBookings(owner).size)
                assertTrue(store.pendingCandidateCount(owner)>0)
                rows.put(JSONObject().put("case_id",id).put("fixture",f).put("frozen_direct_core_actual",direct).put("actual_hook",snapshot(db)).put("frozen_business_status",if(f.getString("layer")=="CURRENT_BASELINE")"FAIL" else "EXPECTED_RED").put("actual_hook_no_unproved_bookings",true).put("proof_not_present",JSONArray(listOf("provider operation reference","message identity","revision/predecessor","source UID"))).put("oracle_only_new_event_evidence_flag",f.optBoolean("new_event_evidence")))
            }
            write("A24-input-and-hook-traces.json",rows)
        }finally{db.close()}
    }
}
