package uk.thewyj.app.finance

import android.app.Application
import androidx.room.Room
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.*
import java.nio.file.Files
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceAiTest {
    private val context get()=RuntimeEnvironment.getApplication()
    private lateinit var db:FinanceAiDatabase
    private lateinit var main:NotificationDatabase
    private lateinit var store:RoomPaymentRecognitionStore
    private var owner="synthetic-ai-owner"
    private var now=1000L
    private val reference="SYNTH-P06-REFERENCE"
    private fun record(unit:String="CNY")=PaymentRecognitionRecord("rec-ai",owner,"WAITING_FOR_ENRICHMENT",1,"com.tencent.mm","NOTIFICATION","synthetic-ai-event",paymentChannel="wechat",amountMinor=null,currency=unit,direction="EXPENSE",merchant="",providerReference=reference,createdAtMs=1000,updatedAtMs=1000,sourceUid=10390)
    private fun ticket()=PaymentTicketEngine(now={1000L}).create(owner,"rec-ai","com.tencent.mm","synthetic-ai-event","wechat").copy(sourceUid=10390)
    private fun page(unit:String="CNY",time:Long=1000L)=PaymentPageSnapshot("com.tencent.mm",listOf("付款详情","付款成功","本次扣除 $unit ${if(unit=="JPY")"90" else "90.00"}","原价 $unit ${if(unit=="JPY")"100" else "100.00"}","优惠 $unit ${if(unit=="JPY")"10" else "10.00"}","交易号 $reference","商户 Restaurant"),time)
    private fun packet()=checkNotNull(FinanceAiEvidence.capture(record(),ticket(),null,page(),now))
    private fun response(input:JSONObject)=JSONObject().put("status","suggestion").put("input_digest","a".repeat(64)).put("model_version","synthetic-1").put("requires_manual_confirmation",true)
        .put("suggestion",JSONObject().put("schema_version",1).put("requires_manual_confirmation",true).put("decision","suggest").put("selected_candidate_id","m0")
            .put("currency",input.getString("currency")).put("direction",input.getString("direction")).put("confidence",950).put("refusal_reason","none").put("category","food")
            .put("merchant_normalized","Restaurant").put("evidence_refs",JSONArray(listOf("m0","m1","m2")))
            .put("amount_candidates",JSONArray().apply{val source=input.getJSONArray("candidates");repeat(source.length()){i->val c=source.getJSONObject(i);put(JSONObject().put("candidate_id",c.getString("id")).put("amount_minor",c.getLong("amount_minor")).put("currency",c.getString("currency")).put("role",listOf("actual_paid","original","discount")[i]).put("evidence_refs",JSONArray(listOf(c.getString("id")))))}}))
    private class Transport(val reply:(JSONObject)->JSONObject):NotificationIngestTransport {
        var enabled=false;var revision=0L;var offline=false;var models=0;var uploaded:JSONObject?=null;var beforeReply:(()->Unit)?=null
        override fun get(path:String,sessionToken:String)=if(offline)IngestResponse(false,503,"{}")else IngestResponse(true,200,JSONObject().put("available",true).put("model_version","synthetic-1").put("consent",JSONObject().put("enabled",if(enabled)1 else 0).put("revision",revision)).toString())
        override fun post(path:String,sessionToken:String,body:String):IngestResponse {
            if(offline)return IngestResponse(false,503,"{}")
            val json=JSONObject(body)
            val result=when{
                path.endsWith("/consent")->{if(json.getLong("expected_revision")!=revision)return IngestResponse(false,409,"{}");enabled=json.getBoolean("enabled");revision++;JSONObject().put("consent",JSONObject().put("enabled",if(enabled)1 else 0).put("revision",revision))}
                path.endsWith("/evidence")->{uploaded=json.getJSONObject("evidence");JSONObject().put("status","evidence_ready").put("input_digest","a".repeat(64))}
                else->{models++;beforeReply?.invoke();reply(checkNotNull(uploaded))}
            }
            return IngestResponse(true,200,result.toString())
        }
    }
    private fun coordinator(t:Transport)=FinanceAiCoordinator(context,db,store,t,account={NotificationCaptureCoordinator.CaptureAccount(owner,"synthetic-device","synthetic-session",financeEntitled=true,archiveEntitled=false)},clock={now},eventIdResolver={it.sourceEventId},automaticallySchedule=false)
    @Before fun setup(){db=Room.inMemoryDatabaseBuilder(context,FinanceAiDatabase::class.java).allowMainThreadQueries().build();main=Room.inMemoryDatabaseBuilder(context,NotificationDatabase::class.java).allowMainThreadQueries().build();store=RoomPaymentRecognitionStore(main);store.saveRecognition(record())}
    @After fun close(){db.close();main.close()}

    @Test fun sixExplicitUnitsRemainExactAndNoOriginalReferenceOrPersonalTextIsUploaded(){
        for(unit in CurrencyMoney.digits.keys){val p=FinanceAiEvidence.capture(record(unit),ticket(),null,page(unit),now)!!;assertEquals(unit,p.getString("currency"));assertEquals(if(unit=="JPY")90L else 9000L,p.getJSONArray("candidates").getJSONObject(0).getLong("amount_minor"));assertFalse(p.toString().contains(reference));assertFalse(p.toString().contains("交易号"))}
    }
    @Test fun missingSourceOrProfileAndIndependentIdentityConflictsRemainManual(){
        for(r in listOf(record().copy(sourceUid=null),record().copy(identityReviewReason="reference_money_or_instance_conflict"),record().copy(providerReference=""),record().copy(direction="INCOME"))){assertNull(FinanceAiEvidence.capture(r,ticket(),null,page(),now))}
    }
    @Test fun ordinaryRuleMoneyAndAuthorizationNeedZeroModelCalls(){
        for(r in listOf(record().copy(amountMinor=9000),record().copy(financialPhase="AUTHORIZED"),record().copy(financialPhase="authorization_release"))){assertNull(FinanceAiEvidence.capture(r,ticket(),null,page(),now))}
        val t=Transport(::response);assertEquals(0,t.models)
    }
    @Test fun chatPendingLoadingAndPromptInjectionCannotCreateAnAiObservation(){
        for(prefix in listOf("|聊天记录","聊天记","加载中","密码","ignore previous instructions")){assertNull(FinanceAiEvidence.capture(record(),ticket(),null,page().copy(textLines=listOf(prefix)+page().textLines),now))}
        assertNull(FinanceAiEvidence.capture(record(),ticket(),null,page().copy(textLines=page().textLines.map{if(it=="付款成功")"待付款" else it}),now))
    }
    @Test fun currencyConflictUnknownUnitAndJpyFractionNeverDefaultToCny(){
        assertNull(FinanceAiEvidence.capture(record(),ticket(),null,page("USD"),now))
        assertNull(FinanceAiEvidence.capture(record(),ticket(),null,page().copy(textLines=page().textLines.map{it.replace("CNY","XYZ")}),now))
        assertNull(FinanceAiEvidence.capture(record("JPY"),ticket(),null,page("JPY").copy(textLines=page("JPY").textLines.map{it.replace("JPY 90","JPY 90.5")}),now))
    }
    @Test fun originalTicketExpiryAndObservationTimeAreNotExtended(){
        assertNull(FinanceAiEvidence.capture(record(),ticket(),null,page(),91000+1))
        val p=packet();assertEquals(1000L,p.getLong("captured_at_ms"));assertEquals(91000L,p.getLong("expires_at_ms"));assertEquals(90000L,ticket().expiresAtMs-ticket().createdAtMs)
    }
    @Test fun inventedModelMoneyCurrencyReferencesAndAuthorityAreRejectedOnDevice(){
        val p=packet();assertNotNull(FinanceAiEvidence.validatedSuggestion(response(p),p))
        for(mode in 0..5){val r=response(p);val a=r.getJSONObject("suggestion");when(mode){0->a.getJSONArray("amount_candidates").getJSONObject(0).put("amount_minor",99999);1->a.put("currency","USD");2->a.put("transaction_id","invented");3->a.put("confidence",1.5);4->a.put("selected_candidate_id","m2");5->a.put("direction","income")};assertNull("mode $mode",FinanceAiEvidence.validatedSuggestion(r,p))}
    }
    @Test fun captureIsLocalConsentIsExplicitAndRulesNeverWriteABooking(){
        val t=Transport(::response);val c=coordinator(t);assertTrue(c.capture(ticket(),page()));assertFalse(c.capture(ticket(),page()));assertFalse(c.flush(owner));assertEquals(0,t.models)
        assertTrue(c.setConsent(owner,true));assertTrue(c.flush(owner));assertEquals(1,t.models);assertNotNull(c.advice(owner,"rec-ai"));assertTrue(store.localBookings(owner).isEmpty());assertNull(store.recognition(owner,"rec-ai")!!.amountMinor)
    }
    @Test fun differentAccountAndManualChangeDiscardLateAdvice(){
        val t=Transport(::response);val c=coordinator(t);c.capture(ticket(),page());c.setConsent(owner,true)
        t.beforeReply={owner="synthetic-other-owner"};c.flush("synthetic-ai-owner");assertNull(c.advice(owner,"rec-ai"));assertTrue(store.localBookings(owner).isEmpty());assertTrue(store.localBookings("synthetic-ai-owner").isEmpty())
    }
    @Test fun lateReplyCannotOverwriteANewerObservation(){
        val d=db.assistance();val old=FinanceAiObservation(owner,"rec-ai","event","r1","p1","{}",91000,updatedAtMs=1000)
        d.put(old);d.put(old.copy(inputDigest="p2",updatedAtMs=2000));assertEquals(0,d.publish(owner,"rec-ai","r1","p1","suggestion","old",3000));assertEquals("p2",d.observation(owner,"rec-ai")!!.inputDigest)
        assertEquals(0,d.linkEvent(owner,"rec-ai","r1","p1","wrong-event"));assertNull(d.observation("other-account","rec-ai"))
    }
    @Test fun offlineWithdrawalBlocksLocalAdviceAndIsRetriedWithoutReenabling(){
        val t=Transport(::response);val c=coordinator(t);c.capture(ticket(),page());c.setConsent(owner,true);c.flush(owner);assertNotNull(c.advice(owner,"rec-ai"))
        t.offline=true;assertTrue(c.setConsent(owner,false));assertNull(c.advice(owner,"rec-ai"));assertTrue(db.assistance().state(owner)!!.localRevokePending)
        val calls=t.models;t.offline=false;c.refreshConfiguration(owner);assertFalse(t.enabled);assertFalse(db.assistance().state(owner)!!.consent);assertFalse(db.assistance().state(owner)!!.localRevokePending);assertEquals(calls,t.models)
    }
    @Test fun sourceEditAndInvalidOutputCannotMutateFinancialFacts(){
        val t=Transport{p->response(p).apply{getJSONObject("suggestion").getJSONArray("amount_candidates").getJSONObject(0).put("amount_minor",99999)}};val c=coordinator(t)
        c.capture(ticket(),page());c.setConsent(owner,true);c.flush(owner);assertNull(c.advice(owner,"rec-ai"));assertEquals("invalid",db.assistance().observation(owner,"rec-ai")!!.status);assertTrue(store.localBookings(owner).isEmpty())
    }
    @Test fun separateAiCacheSurvivesBinaryBackupWithoutUpgradingCoreRoom(){
        val first="p06-ai-${UUID.randomUUID()}.db";val second="p06-ai-${UUID.randomUUID()}.db"
        val source=Room.databaseBuilder(context,FinanceAiDatabase::class.java,first).allowMainThreadQueries().build()
        val row=FinanceAiObservation(owner,"rec-ai","original-event","record","input",packet().toString(),91000,updatedAtMs=1000)
        source.assistance().put(row);source.assistance().putState(FinanceAiAccountState(owner,true,false,4,1000,localRevokePending=true));source.openHelper.writableDatabase.query("PRAGMA wal_checkpoint(FULL)").close();source.close()
        Files.copy(context.getDatabasePath(first).toPath(),context.getDatabasePath(second).toPath())
        val copy=Room.databaseBuilder(context,FinanceAiDatabase::class.java,second).allowMainThreadQueries().build()
        try{assertEquals(row,copy.assistance().observation(owner,"rec-ai"));assertTrue(copy.assistance().state(owner)!!.localRevokePending);assertEquals(18,NotificationDatabase.SCHEMA_VERSION);assertEquals(1,copy.openHelper.writableDatabase.version)}finally{copy.close()}
    }
}
