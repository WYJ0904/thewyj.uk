package uk.thewyj.app.task21.payment

import android.app.Application
import android.app.Notification
import android.content.Context
import android.graphics.Bitmap
import android.os.Bundle
import androidx.room.Room
import kotlinx.coroutines.runBlocking
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
import java.io.File

/** Executes unchanged product classes; TARGET_SPEC failures remain real JUnit RED. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34], application=Application::class)
class FinanceP02MatrixTest {
    private val context:Context get()=RuntimeEnvironment.getApplication()
    private val root get()=File(System.getProperty("finance.p02.root"))
    private val output get()=File(System.getProperty("finance.p02.output")).apply{mkdirs()}
    private val owner="synthetic-finance-p02"
    @Test fun A_identityLifecycleMatrix()=group("A")
    @Test fun B_crossSourceAndLegacyReconcile()=group("B")
    @Test fun C_preauthorizationTarget()=group("C")
    @Test fun D_parserCurrencyTarget()=group("D")
    @Test fun E_pageOcrAndRetryMatrix()=group("E")

    private fun group(group:String) {
        val fixtures=JSONObject(File(root,"fixtures/matrix.json").readText()).getJSONArray("cases")
        val db=Room.inMemoryDatabaseBuilder(context,NotificationDatabase::class.java).allowMainThreadQueries().build()
        val store=RoomPaymentRecognitionStore(db)
        val failures=mutableListOf<String>()
        try {
            for(i in 0 until fixtures.length()) {
                val f=fixtures.getJSONObject(i);if(f.getString("group")!=group)continue
                db.clearAllTables()
                context.getSharedPreferences("wyj-payment-notification-lifecycles",Context.MODE_PRIVATE).edit().clear().commit()
                val started=System.nanoTime()
                var actual=JSONObject();var error:Throwable?=null
                try { actual=execute(f,store); checkExpected(f,actual) } catch(t:Throwable) { error=t }
                val status=when { error==null -> "PASS"; f.getString("layer")=="TARGET_SPEC" && error is AssertionError -> "EXPECTED_RED";else -> "FAIL" }
                val row=JSONObject().put("case_id",f.getString("case_id")).put("group",group).put("layer",f.getString("layer"))
                    .put("fixture",f).put("actual",actual).put("status",status).put("elapsed_ms",(System.nanoTime()-started)/1_000_000.0)
                    .put("coverage","ROBOLECTRIC_API34_REAL_PRODUCT_CLASSES_SYNTHETIC_DATA")
                    .put("error",error?.stackTraceToString() ?: "")
                File(output,"kotlin-$group.ndjson").appendText(row.toString()+"\n")
                if(error!=null)failures.add(f.getString("case_id")+":"+(error.message?:error.javaClass.simpleName))
            }
        } finally { db.close() }
        assertTrue("Retained failed assertions (including expected future RED): "+failures.joinToString(" | "),failures.isEmpty())
    }

    private fun outcome(pkg:String,reference:String="")=PaymentIngestOutcome(true,64800,FinanceDirection.EXPENSE,950,"","",
        if(pkg=="com.tencent.mm")"wechat" else if(pkg=="cmb.pb")"bank_card" else "alipay","synthetic-structured-proof",providerReference=reference)
    private fun message(pkg:String,time:Long,text:String="支付成功 ¥648.00",sender:String="synthetic-sender",conversation:String="synthetic-conversation"):String {
        val extras=Bundle().apply {putParcelableArray(Notification.EXTRA_MESSAGES,arrayOf(Bundle().apply {
            putCharSequence("text",text);putString("sender",sender);putLong("time",time)
        }))}
        return NotificationMessagingIdentity.fromExtras(extras,pkg,conversation)
    }
    private fun lifecycle(f:JSONObject,store:RoomPaymentRecognitionStore):JSONObject {
        val pkg=f.getString("package");var now=1_000_000L;var serial=0
        fun registry()=AndroidPaymentNotificationLifecycleRegistry(context,now={now},idFactory={"p02-event-${++serial}"})
        var r=registry();val kind=f.getString("kind");val identity=f.optString("identity","message")
        val first=NotificationCaptureInput(sourcePackage=pkg,notificationKey="$pkg:p02-slot-a",notificationId=7,tag="p02-tag",
            title="合成支付",text="支付成功 ¥648.00",postTime=now,receivedAtMs=now,
            messageIdentity=if(identity=="message")message(pkg,now) else "")
        val firstProof=outcome(pkg,if(identity=="reference")"SYNTH-REF-A" else "")
        val ids=mutableListOf(r.eventId(owner,first,firstProof))
        if(kind=="interleaved") {
            ids.add(r.eventId(owner,first.copy(messageIdentity=message(pkg,now+1)),firstProof))
            ids.add(r.eventId(owner,first,firstProof))
        } else {
            var continuity=first
            if(kind=="replay") {
                now+=1000L
                continuity=first.copy(postTime=now,receivedAtMs=now,text=if(identity=="empty")first.text else "付款成功 ¥648.00 状态已更新")
                ids.add(r.eventId(owner,continuity,firstProof))
            }
            if(kind=="replay" || f.optBoolean("removed"))r.markRemoved(owner,continuity)
            now+=f.getLong("delay_ms")
            if(f.optBoolean("restart"))r=registry() // new registry object reads persisted synthetic preferences
            val same=kind=="replay"
            val second=first.copy(notificationKey=if(!same && !f.getBoolean("same_slot"))"$pkg:p02-slot-b" else first.notificationKey,
                text=if(same || f.optBoolean("same_body"))first.text else "支付成功 ¥648.00 合成商户乙",
                postTime=if(same && !f.getBoolean("changed_post"))continuity.postTime else now,receivedAtMs=now,
                messageIdentity=if(identity=="message")message(pkg,if(same)first.postTime else first.postTime+1) else "")
            ids.add(r.eventId(owner,second,outcome(pkg,if(identity=="reference")if(same)"SYNTH-REF-A" else "SYNTH-REF-B" else "")))
        }
        val coordinator=PaymentRecognitionCoordinator(store,now={now})
        ids.forEach { id ->coordinator.onSourceEvent(owner,pkg,PaymentSourceType.NOTIFICATION,"notification#event#$id",
            "合成支付","支付成功 实付¥648.00",uploadEventId=id) }
        return JSONObject().put("event_ids",JSONArray(ids)).put("records",store.localBookings(owner).size)
            .put("expense_minor",store.localBookings(owner).sumOf{it.amountMinor}).put("identity_source",identity)
            .put("booking_states",JSONArray(store.localBookings(owner).map{it.syncState}))
            .put("recognition_states",JSONArray(store.localBookings(owner).map{store.recognition(owner,it.recognitionId)?.state}))
    }
    private fun execute(f:JSONObject,store:RoomPaymentRecognitionStore):JSONObject=when(f.getString("kind")) {
        "independent","replay","interleaved" ->lifecycle(f,store)
        "messaging_identity" -> {
            val changed=f.getString("changed");val a=if(changed=="empty")"" else message("com.tencent.mm",1000)
            val b=when(changed){"text"->message("com.tencent.mm",1000,"不同正文同消息");"timestamp"->message("com.tencent.mm",1001)
                "sender"->message("com.tencent.mm",1000,sender="other");"conversation"->message("com.tencent.mm",1000,conversation="other")
                "source"->message("cmb.pb",1000);else->""}
            JSONObject().put("same",a==b).put("empty",a.isEmpty()&&b.isEmpty()).put("first_hash",a).put("second_hash",b)
        }
        "cross_source" -> {
            var now=1000L;var seq=0
            fun registry()=AndroidPaymentNotificationLifecycleRegistry(context,now={now},idFactory={"p02-cross-${++seq}"})
            val initialRegistry=registry()
            val ref=if(f.getBoolean("shared_reference"))"SYNTH-SAME-PLATFORM-REF" else ""
            val p1=NotificationCaptureInput(sourcePackage="com.tencent.mm",notificationKey="com.tencent.mm:p02-key",notificationId=7,tag="same-tag",text="支付成功 实付¥34.00",postTime=now)
            val id1=initialRegistry.eventId(owner,p1,outcome("com.tencent.mm",ref).copy(amountMinor=3400))
            now+=f.getLong("delay_ms")
            val secondRegistry=if(f.getBoolean("restart"))registry() else initialRegistry
            val id2=secondRegistry.eventId(owner,p1.copy(sourcePackage="cmb.pb",notificationKey="cmb.pb:p02-key",postTime=now),outcome("cmb.pb",ref).copy(amountMinor=3400))
            val c=PaymentRecognitionCoordinator(store,now={now})
            c.onSourceEvent(owner,"com.tencent.mm",PaymentSourceType.NOTIFICATION,"notification#event#$id1","合成微信","支付成功 实付¥34.00",uploadEventId=id1)
            c.onSourceEvent(owner,"cmb.pb",PaymentSourceType.BANK_NOTIFICATION,"notification#event#$id2","合成银行","支付成功 实付¥34.00",uploadEventId=id2)
            JSONObject().put("event_ids",JSONArray(listOf(id1,id2))).put("records",store.localBookings(owner).size).put("expense_minor",store.localBookings(owner).sumOf{it.amountMinor})
                .put("booking_states",JSONArray(store.localBookings(owner).map{it.syncState}))
                .put("registry_recreated",f.getBoolean("restart"))
        }
        "reconcile" -> {
            val count=f.getInt("candidates");val time=1_000_000L
            repeat(count){ i->store.saveCandidate(PaymentCandidate("p02-c-$i",owner,"p02-r-$i","pending",3400,"EXPENSE","","synthetic-$i",time,
                if(i==0)"wechat" else "bank_card",900,"synthetic",createdAtMs=time,updatedAtMs=time)) }
            val found=PaymentRecognitionCoordinator(store).reconcile(owner,3400,time+f.getLong("delta_ms"))
            JSONObject().put("match",found!=null).put("candidate",found?.candidateId ?: JSONObject.NULL).put("writes",store.localBookings(owner).size)
                .put("candidate_status",found?.status ?: JSONObject.NULL).put("candidate_count_before",count).put("sql_limit",1).put("call_path","DIRECT_DIAGNOSTIC_NO_PRODUCTION_CALLER_FOUND")
        }
        "preauth" -> {
            val events=f.getJSONArray("events");val c=PaymentRecognitionCoordinator(store,now={1000L});val parsed=JSONArray()
            for(i in 0 until events.length()) {
                val e=events.getJSONObject(i);val state=e.getString("state");val amount=e.getLong("minor")/100.0
                val text=when(state){"authorization"->"预授权 USD $amount";"settlement"->"结算成功 已扣款 USD $amount";"release","expiry"->"预授权解除 USD $amount";else->"退款成功 USD $amount"}+
                    e.optString("reference").takeIf{it.isNotBlank()}?.let{" 交易号 $it"}.orEmpty()
                val id=if(f.getString("scenario")=="duplicate_posted" && i==2)"p02-preauth-1" else "p02-preauth-$i"
                val p=PaymentParserRegistry.parse("sms",PaymentSourceType.SMS,"【合成银行】",text,capturedAtMs=1000L+i)
                parsed.put(JSONObject().put("state",state).put("parser_status",p.status.name).put("minor",p.amountMinor ?: JSONObject.NULL).put("currency",p.currency ?: JSONObject.NULL)
                    .put("provider_reference",p.providerReference ?: JSONObject.NULL).put("synthetic_input",text))
                c.onSourceEvent(owner,"sms",PaymentSourceType.SMS,"sms#event#$id","【合成银行】",text,uploadEventId=id)
            }
            val holds=(0 until events.length()).filter{events.getJSONObject(it).getString("state")=="authorization"}.map{"p02-preauth-$it"}.toSet()
            val preserved=holds.all{id->val record=store.recognitionBySourceEvent(owner,"sms#event#$id");record?.amountMinor==20000L && record.currency=="USD"}
            val lifecycleFields=PaymentRecognitionRecord::class.java.declaredFields.map{it.name}
            JSONObject().put("expense_minor",store.localBookings(owner).filter{it.direction=="EXPENSE"}.sumOf{it.amountMinor})
                .put("refund_minor",store.localBookings(owner).filter{it.direction=="REFUND"}.sumOf{it.amountMinor})
                .put("authorization_excluded",store.localBookings(owner).none{it.eventId in holds})
                .put("authorization_evidence_preserved",preserved)
                .put("lifecycle_model_implemented",lifecycleFields.any{it.contains("authorization",true)}).put("model_fields",JSONArray(lifecycleFields)).put("parsed_events",parsed)
        }
        "parser_currency" -> {
            val type=if(f.getString("package")=="sms")PaymentSourceType.SMS else PaymentSourceType.NOTIFICATION
            val at=System.nanoTime();val p=PaymentParserRegistry.parse(f.getString("package"),type,f.getString("title"),f.getString("text"),capturedAtMs=1000L)
            val parserMs=(System.nanoTime()-at)/1_000_000.0
            val writeAt=System.nanoTime()
            val c=PaymentRecognitionCoordinator(store,now={1000L});c.onSourceEvent(owner,f.getString("package"),type,"p02-source-${f.getString("case_id")}",f.getString("title"),f.getString("text"))
            val booked=store.localBookings(owner)
            JSONObject().put("amount_minor",p.amountMinor ?: JSONObject.NULL).put("currency",p.currency ?: JSONObject.NULL)
                .put("direction",p.direction?.name ?: JSONObject.NULL).put("parser_status",p.status.name).put("records",booked.size)
                .put("booked_currencies",JSONArray(booked.map{it.currency})).put("booked_amounts_minor",JSONArray(booked.map{it.amountMinor}))
                .put("currency_review_required",p::class.java.declaredFields.any{it.name=="currency_review_required"})
                .put("parser_elapsed_ms",parserMs).put("coordinator_room_elapsed_ms",(System.nanoTime()-writeAt)/1_000_000.0)
        }
        "page" -> {
            val lines=f.getJSONArray("lines").let{a->(0 until a.length()).map{a.getString(it)}}
            val at=System.nanoTime()
            val e=if(f.getString("engine")=="ui_tree")PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm",lines,1000L))
                else verifyOcr(lines)
            JSONObject().put("amount_minor",e?.amountMinor ?: JSONObject.NULL).put("direction",e?.direction?.name ?: JSONObject.NULL)
                .put("completion",e?.completionConfirmed ?: false).put("parser_elapsed_ms",(System.nanoTime()-at)/1_000_000.0)
        }
        "ocr_failure" -> {
            val scenario=f.getString("scenario")
            val lines=if(scenario=="empty_capture")emptyList() else listOf("账单详情","付款成功","实付 ¥646.00")
            val e=verifyOcr(lines,scenario=="misread_secondary_disagrees",scenario in setOf("secure_window_failure","locked_capture_failure","ocr_exception"))
            JSONObject().put("answer",e!=null).put("os_capture_tested",false)
        }
        "ticket" -> {
            var time=1000L;val engine=PaymentTicketEngine(now={time});val ticket=engine.create(owner,"p02-rec","com.tencent.mm","p02-event","wechat",missingFields=setOf("amount"))
            time+=f.getLong("age_ms")
            val result=engine.enrich(ticket,PaymentEnrichment(f.getString("package"),64800,"CNY",FinanceDirection.EXPENSE,null,null,null,time,950,completionConfirmed=true))
            JSONObject().put("accepted",result is EnrichmentOutcome.Applied).put("outcome",result.toString()).put("expiry",ticket.expiresAtMs)
        }
        "retry" -> retry(f.getString("scenario"))
        else -> error("Unsupported fixture kind")
    }
    private fun verifyOcr(lines:List<String>,disagree:Boolean=false,throws:Boolean=false):PaymentEnrichment? {
        val bitmap=Bitmap.createBitmap(160,260,Bitmap.Config.ARGB_8888)
        try {
            val engine=object:AmountConfirmingOcrEngine {
                override suspend fun recognize(bitmap:Bitmap):List<String> { if(throws)throw IllegalStateException("SYNTHETIC_CAPTURE_FAILURE");return lines }
                override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long)=if(disagree)64800L else expectedMinor
            }
            return runBlocking { PaymentScreenshotVerifier(engine).verify(bitmap,"com.tencent.mm",1000L) }
        } finally { bitmap.recycle() }
    }
    private fun retry(scenario:String):JSONObject {
        val budget=PaymentPageRetry("synthetic-budget",0);var valid=true;val details=JSONObject()
        when(scenario) {
            "eight_attempts"->{val accepted=(0L..20L).count{budget.beginAttempt(it*1000)};valid=accepted==8;details.put("accepted",accepted)}
            "cooldown_249_250"->{val a=budget.beginAttempt(0);val b=budget.beginAttempt(249);val c=budget.beginAttempt(250);valid=a&&!b&&c;details.put("decisions",JSONArray(listOf(a,b,c)))}
            "window_89999_90000_90001"->{val decisions=listOf(89999L,90000L,90001L).map{PaymentPageRetry("window",0).beginAttempt(it)};valid=decisions==listOf(true,true,false)&&budget.nextDelayMs(90000)==null;details.put("decisions",JSONArray(decisions))}
            "page_changes_share_budget"->{val pool=PaymentPageRetryPool();val a=pool.budget(owner,"ticket-a",0);a.beginAttempt(0);val b=pool.budget(owner,"ticket-a",1000);valid=a===b&&b.attempts==1}
            "background_cancel"->{val pool=PaymentPageRetryPool();val a=pool.budget(owner,"ticket-a",0);pool.clear();valid=!a.beginAttempt(1000)}
            "overlay_retry"->{valid=PaymentOverlayRetryPolicy.shouldRetry("com.android.systemui",8000)&&!PaymentOverlayRetryPolicy.shouldRetry("com.android.systemui",8001)&&!PaymentOverlayRetryPolicy.shouldRetry("unrelated.package",0)}
        }
        return details.put("finite_budget",valid).put("max_window_ms",PaymentPageRetry.MAX_WINDOW_MS).put("max_attempts",PaymentPageRetry.MAX_ATTEMPTS)
    }
    private fun checkExpected(f:JSONObject,a:JSONObject) {
        val e=f.getJSONObject("expected")
        for(key in listOf("records","expense_minor","refund_minor","same","empty","match","writes","accepted","answer","finite_budget","authorization_excluded","authorization_evidence_preserved"))
            if(e.has(key))assertEquals("${f.getString("case_id")} $key",e.get(key).toString(),a.opt(key)?.toString())
        if(e.has("amount_minor"))assertEquals("${f.getString("case_id")} amount",e.get("amount_minor").toString(),a.opt("amount_minor")?.toString())
        if(e.has("currency"))assertEquals("currency",e.getString("currency"),a.optString("currency"))
        if(e.has("direction")&&!e.isNull("direction"))assertEquals("direction",e.getString("direction"),a.optString("direction"))
        if(e.optBoolean("must_not_auto_book"))assertFalse("unsettled/non-detail page must not prove completion",a.optBoolean("completion"))
    }
}
