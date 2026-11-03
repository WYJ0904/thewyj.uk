package uk.thewyj.app.task21.payment

import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import java.io.File
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

private fun output()=File(System.getProperty("finance.p02.output"))
private class Flow(transport:NotificationIngestTransport,first:Int):AutoCloseable {
    val out=output();val config=JSONObject(File(out.parentFile,"private/context.json").readText());val owner=config.getString("account_id")
    val context=object:ContextWrapper(RuntimeEnvironment.getApplication()){
        override fun getFilesDir()=File(out,"files").apply{mkdirs()}
        override fun getApplicationContext():Context=this
    }
    val db=Room.databaseBuilder(context,NotificationDatabase::class.java,File(out,"notification.sqlite").absolutePath).allowMainThreadQueries().build()
    val store=RoomPaymentRecognitionStore(db);val archive=RoomNotificationStore(db)
    val queue=NotificationOfflineQueue.inDirectory(context.filesDir,owner)
    val sink=object:NotificationArchiveSink {
        override fun store(accountId:String,input:NotificationCaptureInput,parsed:StructuredNotificationEvent?):Boolean{
            if(parsed==null)return false
            archive.record(accountId,NotificationCapture(input.sourcePackage,input.sourceType,input.notificationKey,input.notificationId,input.tag,input.groupKey,input.channelId,
                input.postTime,input.isGroup,input.isGroupSummary,input.title,input.text,input.bigText,input.subText,sourceEventId=parsed.eventId));return true
        }
        override fun markRemoved(accountId:String,input:NotificationCaptureInput)=Unit
        override fun storeMediaStoreScreenshot(accountId:String,event:ScreenshotMediaEvent)=ScreenshotArchiveOutcome.SKIPPED
        override fun markFinanceOutcome(accountId:String,sourceEventId:String,state:String,transactionId:String)=archive.markFinanceOutcome(accountId,sourceEventId,state,transactionId)
        override fun recognitionSourceEventIds(accountId:String,sourceEventId:String)=archive.recognitionSourceEventIds(accountId,sourceEventId)
    }
    val hook=AndroidPaymentRecognitionHook(context,sink,store,testing=true,publishOverride={_,_->false},
        notifierOverride=object:PaymentStatusNotifier {override fun notify(message:PaymentStatusNotificationMessage)=true;override fun cancel(notificationId:Int)=Unit})
    private val adapter=object:PaymentRecognitionHook by hook {
        override fun prepareLocalBookings(accountId:String,deviceId:String)=LocalPaymentLedger.recover(context,accountId,deviceId,db,hook.coordinator())
    }
    private var sequence=first
    val pipeline=NotificationCaptureCoordinator(archiveFor={LocalNotificationArchive.inDirectory(context.filesDir,it)},queueFor={queue},transport=transport,
        account={NotificationCaptureCoordinator.CaptureAccount(owner,config.getString("device_id"),config.getString("session"),true,true)},archiveSink=sink,paymentHook=adapter,
        paymentLifecycleRegistry=AndroidPaymentNotificationLifecycleRegistry(context,idFactory={"synthetic-closeout-${sequence++}"}))
    fun capture(key:String,text:String,bank:Boolean=false,uid:Int=if(bank)10040 else 10030){
        val now=System.currentTimeMillis();pipeline.onNotification(NotificationCaptureInput(if(bank)"cmb.pb" else "com.tencent.mm",
            sourceType=if(bank)"bank" else "notification",notificationKey=key,notificationId=7,title=if(bank)"招商银行" else "微信支付",
            text=text,postTime=now,receivedAtMs=now,sourceUid=uid))
    }
    fun snapshot():JSONObject {
        val bookings=JSONArray(store.localBookings(owner).map{b->JSONObject().put("event_id",b.eventId).put("id",b.transactionId).put("recognition_id",b.recognitionId)
            .put("amount_minor",b.amountMinor).put("currency",b.currency).put("amount_exponent",b.amountExponent ?: JSONObject.NULL).put("direction",b.direction)
            .put("sync_state",b.syncState).put("provider_reference",b.providerReference)})
        val records=JSONArray(store.recognitionsByState(owner,PaymentRecognitionState.entries.map{it.name},1000).map{r->JSONObject()
            .put("id",r.recognitionId).put("event_id",r.uploadEventId).put("state",r.state).put("reference",r.providerReference)
            .put("currency",r.currency).put("amount_minor",r.amountMinor ?: JSONObject.NULL).put("direction",r.direction)
            .put("completion",r.completionConfirmed).put("identity_reason",r.identityReviewReason).put("source_uid",r.sourceUid ?: JSONObject.NULL).put("phase",r.financialPhase)})
        return JSONObject().put("pid",ProcessHandle.current().pid()).put("bookings",bookings).put("records",records)
            .put("queue",JSONArray(queue.peekRequests().map{q->JSONObject().put("operation_id",q.operationId).put("path",q.path).put("body",JSONObject(q.body))}))
    }
    override fun close(){db.close()}
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class CloseoutFlowSeedTest {
    @Test fun notificationActualSdkEvidenceRoomAndOfflineOutbox(){
        val out=output();check(!File(out,"seed.json").exists())
        val offline=object:NotificationIngestTransport {override fun post(path:String,sessionToken:String,body:String)=IngestResponse(false,503,"{}")}
        Flow(offline,0).use{f->
            val pixels=JSONArray(File(out.parentFile,"sdk-inputs.json").readText())
            val pixel=(0 until pixels.length()).map(pixels::getJSONObject).single{it.getString("id")=="cny-cent"}.getJSONObject("actual")
            assertEquals(1L,pixel.getLong("amount_minor"));assertEquals("CNY",pixel.getString("currency"));assertTrue(pixel.getBoolean("completion"))
            f.capture("synthetic-primary","待付款 付款金额 CNY 0.01 交易号 SYNTH-FLOW-PRIMARY")
            val ticket=f.store.activeTicketForPackage(f.owner,"com.tencent.mm");assertNotNull("The real pending capture must open a ticket",ticket)
            assertTrue(f.store.localBookings(f.owner).isEmpty())
            val enrichment=PaymentEnrichment(pixel.getString("source_package"),pixel.getLong("amount_minor"),pixel.getString("currency"),
                FinanceDirection.valueOf(pixel.getString("direction")),null,null,null,null,900,evidenceSource=PaymentEvidenceSource.OCR,completionConfirmed=pixel.getBoolean("completion"))
            assertTrue(f.hook.onAccessibilityEnrichment(f.owner,enrichment,ticket!!.ticketId) is EnrichmentOutcome.Applied)
            assertEquals(1L,f.store.localBookings(f.owner).single().amountMinor)
            // More cases use the actual notification parser; their data never
            // originate in hand-written finance table INSERTs or fake receipts.
            f.capture("synthetic-foreign","支付成功 实付 HKD 12.34 交易号 SYNTH-FLOW-FOREIGN")
            f.capture("synthetic-jpy","支付成功 实付 JPY 1000 交易号 SYNTH-FLOW-JPY")
            f.capture("synthetic-bank-auth","预授权 CNY 3.00 交易号 SYNTH-FLOW-AUTH",true)
            f.capture("synthetic-bank-capture","结算成功 已扣款 CNY 2.00 授权号 SYNTH-FLOW-AUTH 交易号 SYNTH-FLOW-CAPTURE",true)
            f.capture("synthetic-bank-refund","部分退款成功 已退款 CNY 1.00 授权号 SYNTH-FLOW-AUTH 交易号 SYNTH-FLOW-REFUND 状态版本 1",true)
            f.capture("synthetic-cancel-auth","预授权 USD 20.00 交易号 SYNTH-FLOW-CANCEL",true)
            f.capture("synthetic-cancel-release","预授权解除 USD 20.00 交易号 SYNTH-FLOW-CANCEL",true)
            f.capture("synthetic-pending","待付款 付款金额 CNY 1.00 交易号 SYNTH-FLOW-PENDING")
            f.capture("synthetic-failed","转账失败 CNY 1.00 交易号 SYNTH-FLOW-FAILED")
            f.capture("synthetic-weak","支付成功 实付 CNY 1.00")
            f.capture("synthetic-profile","支付成功 实付 CNY 0.01 交易号 SYNTH-FLOW-PRIMARY",uid=9510030)
            repeat(3){f.capture("synthetic-foreign","支付成功 实付 HKD 12.34 交易号 SYNTH-FLOW-FOREIGN")}
            val bookings=f.store.localBookings(f.owner)
            assertEquals(5,bookings.size);assertEquals(setOf("CNY","HKD","JPY"),bookings.map{it.currency}.toSet())
            assertEquals(1,bookings.count{it.direction=="REFUND"});assertTrue(bookings.none{it.providerReference in setOf("SYNTH-FLOW-CANCEL","SYNTH-FLOW-AUTH","SYNTH-FLOW-FAILED","SYNTH-FLOW-PENDING")})
            val flushed=f.pipeline.flushDetailed();assertTrue(flushed.pending>0);assertTrue(flushed.retryableFailures>0)
            File(out,"seed.json").writeText(f.snapshot().put("status","PASS").put("sdk_source_file","sdk-inputs.json").put("synthetic_only",true).toString(2))
        }
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class CloseoutFlowRestoreTest {
    @Test fun newJvmRetriesLostReceiptAndRetainsCloudIdentityAndOriginalUnits(){
        val out=output();val seed=JSONObject(File(out,"seed.json").readText());assertNotEquals(seed.getLong("pid"),ProcessHandle.current().pid())
        val port=JSONObject(File(out.parentFile,"port.json").readText()).getInt("port")
        val transport=HttpNotificationIngestTransport("http://127.0.0.1:$port")
        Flow(transport,1000).use{f->
            assertEquals(5,f.store.localBookings(f.owner).size)
            val before=f.queue.peekRequests().associate{it.operationId to it.body}
            val first=f.pipeline.flushDetailed();assertTrue(first.retryableFailures>0);assertTrue(first.pending>0)
            for(request in f.queue.peekRequests())if(request.operationId in before)assertEquals(before[request.operationId],request.body)
            assertTrue(transport.post("/__test/restart",f.config.getString("session"),"{}").ok)
            repeat(3){f.pipeline.flushDetailed()}
            val local=f.store.localBookings(f.owner);assertEquals(5,local.size);assertTrue(local.toString(),local.all{it.syncState=="synced"})
            val response=transport.get("/__test/snapshot",f.config.getString("session"));assertTrue(response.body,response.ok)
            val cloud=JSONObject(response.body).getJSONArray("transactions");assertEquals(local.size,cloud.length())
            for(booking in local){val remote=(0 until cloud.length()).map(cloud::getJSONObject).single{it.getString("id")==booking.transactionId}
                assertEquals(booking.amountMinor,remote.getLong("amount_minor"));assertEquals(booking.currency,remote.getString("currency"))
                assertEquals(booking.direction.lowercase(),remote.getString("direction"));assertEquals(booking.amountExponent,remote.getInt("amount_exponent"))
            }
            val ids=local.map{it.transactionId}.toSet();repeat(3){f.capture("synthetic-foreign","支付成功 实付 HKD 12.34 交易号 SYNTH-FLOW-FOREIGN");f.pipeline.flushDetailed()}
            assertEquals(ids,f.store.localBookings(f.owner).map{it.transactionId}.toSet())
            val finalCloud=JSONObject(transport.get("/__test/snapshot",f.config.getString("session")).body).getJSONArray("transactions");assertEquals(5,finalCloud.length())
            File(out,"restore.json").writeText(f.snapshot().put("status","SYNTHETIC_E2E_PASS").put("cloud",finalCloud).put("synthetic_only",true).toString(2))
        }
    }
}
