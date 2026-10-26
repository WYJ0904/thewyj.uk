package uk.thewyj.app.task21.payment

import android.content.Context
import android.content.ContextWrapper
import android.graphics.*
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uk.thewyj.app.finance.*
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.store.*
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome

private val jointTarget get()=InstrumentationRegistry.getInstrumentation().targetContext
private fun jointDir()=File(jointTarget.filesDir,"p06-joint-"+InstrumentationRegistry.getArguments().getString("p06Attempt","r1")).apply{mkdirs()}
private class JointFlow:AutoCloseable {
    val out=jointDir();val config=JSONObject(File(out,"private/context.json").readText());val owner=config.getString("account_id")
    val context=object:ContextWrapper(jointTarget){override fun getFilesDir()=File(out,"files").apply{mkdirs()};override fun getApplicationContext():Context=this}
    val database=Room.databaseBuilder(context,NotificationDatabase::class.java,File(out,"notification.sqlite").absolutePath).allowMainThreadQueries().build()
    val aiDatabase=Room.databaseBuilder(context,FinanceAiDatabase::class.java,File(out,"assistance.sqlite").absolutePath).allowMainThreadQueries().build()
    val store=RoomPaymentRecognitionStore(database);val archive=RoomNotificationStore(database)
    val queue=NotificationOfflineQueue.inDirectory(context.filesDir,owner)
    val account=NotificationCaptureCoordinator.CaptureAccount(owner,config.getString("device_id"),config.getString("session"),true,true)
    // Explicit QA account preference is a real product prerequisite, never an
    // inferred provider fact or a test-only unconditional CNY fallback.
    init { CurrencyRuntimePreferences.save(context,owner,"CNY") }
    val transport=HttpNotificationIngestTransport(config.getString("base_url"))
    val sink=object:NotificationArchiveSink {
        override fun store(accountId:String,input:NotificationCaptureInput,parsed:StructuredNotificationEvent?):Boolean {
            if(parsed==null)return false
            archive.record(accountId,NotificationCapture(input.sourcePackage,input.sourceType,input.notificationKey,input.notificationId,input.tag,input.groupKey,input.channelId,input.postTime,input.isGroup,input.isGroupSummary,input.title,input.text,input.bigText,input.subText,sourceEventId=parsed.eventId));return true
        }
        override fun markRemoved(accountId:String,input:NotificationCaptureInput)=Unit
        override fun storeMediaStoreScreenshot(accountId:String,event:ScreenshotMediaEvent)=ScreenshotArchiveOutcome.SKIPPED
        override fun markFinanceOutcome(accountId:String,sourceEventId:String,state:String,transactionId:String)=archive.markFinanceOutcome(accountId,sourceEventId,state,transactionId)
        override fun recognitionSourceEventIds(accountId:String,sourceEventId:String)=archive.recognitionSourceEventIds(accountId,sourceEventId)
        override fun structuredEventIdsForRecognition(accountId:String,sourceEventId:String)=archive.structuredEventIdsForRecognition(accountId,sourceEventId)
    }
    val hook=AndroidPaymentRecognitionHook(context,sink,store,testing=true,publishOverride={_,_->false},notifierOverride=object:PaymentStatusNotifier{override fun notify(message:PaymentStatusNotificationMessage)=true;override fun cancel(notificationId:Int)=Unit})
    val pipeline=NotificationCaptureCoordinator(archiveFor={LocalNotificationArchive.inDirectory(context.filesDir,it)},queueFor={queue},transport=transport,account={account},archiveSink=sink,paymentHook=hook,
        paymentLifecycleRegistry=AndroidPaymentNotificationLifecycleRegistry(context,idFactory={"synthetic-p06-joint-source"}))
    val ai=FinanceAiCoordinator(context,aiDatabase,store,transport,account={account},eventIdResolver={r->r.uploadEventId.ifBlank{archive.structuredEventIdsForRecognition(owner,r.sourceEventId).distinct().singleOrNull().orEmpty()}},automaticallySchedule=false,pendingSourcePipeline=pipeline)
    fun progress(stage:String){File(out,"progress.json").writeText(JSONObject().put("stage",stage).put("pid",android.os.Process.myPid()).toString())}
    override fun close(){aiDatabase.close();database.close()}
}
class FinanceP06JointSeedTest {
    @Test fun actualSdkThroughNativeCacheOutboxAndAuthenticatedHttpCannotAutoBook()=runBlocking {
        JointFlow().use { f->
            f.progress("notification-capture")
            val numericControl=InstrumentationRegistry.getArguments().getString("p06ReferenceMode")=="numeric-positive-control"
            val now=System.currentTimeMillis();val reference=if(numericControl)"202610260123456789" else "SYNTH-P06-JOINT-123456"
            f.pipeline.onNotification(NotificationCaptureInput("com.tencent.mm",sourceType="notification",notificationKey="synthetic-p06-joint",notificationId=7,title="微信支付",text="付款成功 付款金额待核实 CNY 交易号 $reference",postTime=now,receivedAtMs=now,sourceUid=10390))
            val record=f.store.recognitionsByState(f.owner,PaymentRecognitionState.entries.map{it.name},100).single{it.providerReference==reference}
            assertEquals("currency_amount_unproven",record.identityReviewReason)
            // Same existing explicit verification action used by the native UI;
            // no automatic ticket extension, synthetic identity proof or SQL row.
            val ticket=f.hook.coordinator().restartVerification(f.owner,record.recognitionId)
            assertNotNull(ticket);assertEquals(90000L,ticket!!.expiresAtMs-ticket.createdAtMs);assertNull(record.amountMinor);assertTrue(f.store.localBookings(f.owner).isEmpty())
            assertTrue(f.queue.peekRequests().isNotEmpty());f.progress("outbox-upload");val flushed=f.pipeline.flushDetailed();assertEquals(0,flushed.pending)
            val event=record.uploadEventId.ifBlank{f.archive.structuredEventIdsForRecognition(f.owner,record.sourceEventId).distinct().single()}
            f.progress("actual-sdk-ambiguity")
            val lines=listOf("付款详情","付款成功","本次扣除 CNY 90.00","原价 CNY 100.00","优惠 CNY 10.00","交易号 $reference")
            val bitmap=Bitmap.createBitmap(1080,2200,Bitmap.Config.ARGB_8888);Canvas(bitmap).apply{drawColor(Color.WHITE);val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.BLACK;textSize=54f;typeface=Typeface.create("sans-serif",Typeface.NORMAL)};lines.forEachIndexed{i,s->drawText(s,90f,150f+i*145f,paint)}}
            File(f.out,"synthetic-ai-page.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
            val sdk=MlKitOcrEngine(f.context);val raw=sdk.recognize(bitmap);File(f.out,"synthetic-sdk-lines.json").writeText(JSONArray(raw).toString(2))
            var observed=false
            val verifier=PaymentScreenshotVerifier(object:OcrEngine{override suspend fun recognize(b:Bitmap)=raw})
            val deterministic=verifier.verifyCurrentWithAssistance(bitmap,"com.tencent.mm",System.currentTimeMillis(),null,2,{snapshot->observed=f.ai.capture(ticket!!,snapshot)||observed}){true}
            bitmap.recycle();assertNull("Ambiguous money cannot silently become a rule booking",deterministic?.amountMinor);assertTrue("Actual SDK text must reach the native assistance observer",observed)
            val local=f.ai.observation(f.owner,record.recognitionId)!!;val packet=JSONObject(local.packetJson);assertEquals(event,local.eventId);assertEquals(9000L,packet.getJSONArray("candidates").getJSONObject(0).getLong("amount_minor"))
            assertFalse(f.ai.flush(f.owner));assertNull(f.ai.advice(f.owner,record.recognitionId));f.progress("explicit-qa-consent")
            assertTrue(f.ai.setConsent(f.owner,true));assertTrue(f.ai.flush(f.owner));val advice=f.ai.advice(f.owner,record.recognitionId);assertNotNull(advice)
            assertTrue(advice!!.getBoolean("requires_manual_confirmation"));assertTrue(f.store.localBookings(f.owner).isEmpty());assertNull(f.store.recognition(f.owner,record.recognitionId)!!.amountMinor)
            val state=JSONObject(f.transport.get("/__qa/state",f.account.sessionToken).body);assertEquals(0,state.getJSONArray("transactions").length());assertEquals(1,state.getInt("mock_model_calls"))
            File(f.out,"seed.json").writeText(JSONObject().put("status","PASS").put("case_id",if(numericControl)"NUMERIC_REFERENCE_POSITIVE_CONTROL" else "ORIGINAL_ALPHA_REFERENCE").put("pid",android.os.Process.myPid()).put("event_id",event).put("recognition_id",record.recognitionId).put("packet",packet).put("advice",advice).put("source_uid",record.sourceUid).put("synthetic_notification_input",true).put("actual_os_notification",false).put("model_provider","MOCK").put("ledger_writes",0).toString(2))
        }
    }
}
class FinanceP06JointRestoreTest {
    @Test fun newAndroidProcessPullsHumanReceiptAndInvalidatesOldAiCacheWithoutDuplicating() {
        JointFlow().use { f->
            val seed=JSONObject(File(f.out,"seed.json").readText());assertNotEquals(seed.getInt("pid"),android.os.Process.myPid());val id=seed.getString("recognition_id")
            assertNotNull(f.ai.observation(f.owner,id));val state=JSONObject(f.transport.get("/__qa/state",f.account.sessionToken).body);val tx=state.getJSONArray("transactions");assertEquals(1,tx.length());assertEquals(8800L,tx.getJSONObject(0).getLong("amount_minor"));assertEquals("CNY",tx.getJSONObject(0).getString("currency"))
            val sync=PaymentHintSync(f.context,f.transport,f.store,f.sink,accountOverride={f.account}).sync();assertTrue(sync.ok);assertTrue(sync.completeObservation)
            val local=f.store.recognition(f.owner,id)!!;assertEquals(seed.getString("event_id"),local.uploadEventId);assertEquals("FINANCE_RECORDED",local.state);assertNull(f.ai.advice(f.owner,id));assertEquals(1,state.getInt("mock_model_calls"))
            f.pipeline.flushDetailed();val after=JSONObject(f.transport.get("/__qa/state",f.account.sessionToken).body);assertEquals(tx.toString(),after.getJSONArray("transactions").toString())
            File(f.out,"restore.json").writeText(JSONObject().put("status","PASS").put("seed_pid",seed.getInt("pid")).put("restore_pid",android.os.Process.myPid()).put("event_id",local.uploadEventId).put("transaction",tx.getJSONObject(0)).put("stale_ai_not_adopted",true).put("synthetic_only",true).toString(2))
        }
    }
}
class FinanceP06RealReceiptProbeTest {
    @Test fun observeExistingPrivateReceiptThroughActualSdkWithoutNotificationOrBooking()=runBlocking {
        val out=jointDir();val source=File(out,"private/real-wechat-receipt.png");assertTrue(source.exists());val bitmap=BitmapFactory.decodeFile(source.absolutePath)!!
        val sdk=MlKitOcrEngine(jointTarget);val raw=sdk.recognize(bitmap)
        File(out,"private/real-wechat-sdk-lines.json").writeText(JSONArray(raw).toString(2))
        val parsed=PaymentScreenshotVerifier(sdk).verifyCurrent(bitmap,"com.tencent.mm",System.currentTimeMillis(),null,2){true};bitmap.recycle()
        File(out,"receipt-probe.json").writeText(JSONObject().put("kind","REAL_PAGE_BYTES_DIAGNOSTIC_NOT_E2E").put("ledger_writes",0).put("new_notification_generated",false).put("source_argument_from_observed_window",true)
            .put("amount_minor",parsed?.amountMinor?:JSONObject.NULL).put("amount_decimal",parsed?.amountDecimalCandidate?:JSONObject.NULL).put("currency",parsed?.currency?:JSONObject.NULL).put("completion",parsed?.completionConfirmed?:false).put("raw_lines_private",true).toString(2))
    }
}
