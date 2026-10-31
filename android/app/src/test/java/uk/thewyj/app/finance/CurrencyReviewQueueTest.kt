package uk.thewyj.app.finance

import android.app.Application
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.*
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class CurrencyReviewQueueTest {
    private val owner="synthetic-unit-owner"
    private fun folder()=File(RuntimeEnvironment.getApplication().cacheDir,"q-${UUID.randomUUID().toString().take(6)}")
    @Test fun twoQueueInstancesCannotLoseOrCorruptConcurrentDurableOperations() {
        val dir=folder();val queues=listOf(NotificationOfflineQueue.inDirectory(dir,owner),NotificationOfflineQueue.inDirectory(dir,owner))
        val ready=java.util.concurrent.CountDownLatch(2);val start=java.util.concurrent.CountDownLatch(1)
        val executor=java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val futures=queues.mapIndexed { writer,queue -> executor.submit {
                ready.countDown();check(start.await(3,java.util.concurrent.TimeUnit.SECONDS))
                repeat(30){queue.enqueue("synthetic-writer-$writer-$it","{\"synthetic\":$it}")}
            }}
            assertTrue(ready.await(3,java.util.concurrent.TimeUnit.SECONDS));start.countDown()
            futures.forEach{it.get(10,java.util.concurrent.TimeUnit.SECONDS)}
            assertEquals(60,NotificationOfflineQueue.inDirectory(dir,owner).pendingCount())
        } finally {executor.shutdownNow()}
    }
    @Test fun upgradedCapabilityCannotRearmTheSameRejectedPayloadForever() {
        val dir=folder();val queue=NotificationOfflineQueue.inDirectory(dir,owner);val body="{\"synthetic\":true}"
        queue.enqueue("synthetic-still-incompatible",body)
        repeat(OfflineNotificationQueue.MAX_UPLOAD_ATTEMPTS){queue.markRejected("synthetic-still-incompatible","currency_client_upgrade_required")}
        var calls=0
        val transport=object:NotificationIngestTransport{override fun post(path:String,sessionToken:String,payload:String):IngestResponse{calls++;return IngestResponse(false,409,"""{"code":"currency_client_upgrade_required"}""")}}
        repeat(15){coordinator(dir,transport).flushDetailed()}
        assertEquals(OfflineNotificationQueue.MAX_UPLOAD_ATTEMPTS,calls)
        val saved=NotificationOfflineQueue.inDirectory(dir,owner).peekRequests().single()
        assertEquals(3,saved.currencyCapabilityRetry);assertEquals(body,saved.body);assertEquals("currency_client_upgrade_required",saved.lastError)
    }
    private fun coordinator(dir:File,transport:NotificationIngestTransport,accountId:String=owner)=NotificationCaptureCoordinator(
        archiveFor={LocalNotificationArchive.inDirectory(File(dir,"a"),it)},queueFor={NotificationOfflineQueue.inDirectory(dir,it)},transport=transport,
        account={NotificationCaptureCoordinator.CaptureAccount(accountId,"synthetic-unit-device","synthetic-session",true)})
    @Test fun manualCurrencyCommandSurvivesRestartWithoutRewritingOriginalIngest() {
        val dir=folder();val original="{\"schema_version\":1,\"operations\":[]}"
        val queue=NotificationOfflineQueue.inDirectory(dir,owner);queue.enqueue("synthetic-original-op",original)
        var online=false
        val transport=object:NotificationIngestTransport {override fun post(path:String,sessionToken:String,body:String):IngestResponse {
            if(!online)return IngestResponse(false,503,"{}")
            return IngestResponse(true,200,if(path==OfflineNotificationQueue.CURRENCY_CONFIRM_PATH)
                """{"operation_results":[{"event":{"event_id":"synthetic-source-unit"},"transaction_id":"synthetic-ledger-id","transaction":{"currency":"JPY","amount_minor":3725,"direction":"expense"}}]}"""
                else """{"operation_results":[{"event":{"event_id":"synthetic-source-unit"},"candidate_id":"synthetic-pending-id"}]}""")
        }}
        fun enqueue(value:Long)=coordinator(dir,transport).enqueueCurrencyConfirmation(owner,"synthetic-unit-op","synthetic-source-unit","JPY",value,"EXPENSE","synthetic",1000)
        assertTrue(enqueue(3725));assertTrue(enqueue(3725));assertFalse(enqueue(4000))
        val reopened=NotificationOfflineQueue.inDirectory(dir,owner)
        assertEquals(2,reopened.pendingCount());assertEquals(original,reopened.peekRequests().first().body)
        val wire=JSONObject(reopened.peekRequests().last().body);assertEquals(0,wire.getJSONObject("edits").getInt("amount_exponent"))
        assertEquals(0,coordinator(dir,transport).flushDetailed().uploaded);assertEquals(2,reopened.pendingCount())
        online=true;val result=coordinator(dir,transport).flushDetailed()
        assertEquals(2,result.uploaded);assertEquals("synthetic-source-unit",result.outcomes.last().eventId)
        assertEquals("synthetic-ledger-id",result.outcomes.last().transactionId);assertEquals(0,reopened.pendingCount())
    }
    @Test fun incompleteOrConflictingSuccessCannotDiscardTheCurrencyDecision() {
        val dir=folder();var response="{}"
        val transport=object:NotificationIngestTransport {override fun post(path:String,sessionToken:String,body:String)=IngestResponse(true,200,response)}
        val pipeline=coordinator(dir,transport)
        assertFalse(pipeline.enqueueCurrencyConfirmation("synthetic-other","synthetic-unit-op","synthetic-source-unit","JPY",100,"EXPENSE","synthetic",1000))
        assertTrue(pipeline.enqueueCurrencyConfirmation(owner,"synthetic-unit-op","synthetic-source-unit","JPY",100,"EXPENSE","synthetic",1000))
        val queue=NotificationOfflineQueue.inDirectory(dir,owner);val body=queue.peekRequests().single().body
        assertEquals(0,pipeline.flushDetailed().uploaded);assertEquals(body,queue.peekRequests().single().body)
        response="""{"operation_results":[{"event":{"event_id":"synthetic-source-unit"},"transaction_id":"synthetic-ledger-id","transaction":{"currency":"USD","amount_minor":100,"direction":"expense"}}]}"""
        val result=pipeline.flushDetailed();assertEquals(0,result.uploaded);assertEquals("currency_receipt_conflict",result.rejected.single().reason)
        assertEquals(body,queue.peekRequests().single().body)
    }
    @Test fun protocolUpgradeRecoversPreviouslyQuarantinedOutboxWithoutChangingItsBody() {
        val dir=folder();val queue=NotificationOfflineQueue.inDirectory(dir,owner);val body="{\"synthetic\":true}"
        queue.enqueue("synthetic-old-capability-op",body)
        repeat(OfflineNotificationQueue.MAX_UPLOAD_ATTEMPTS){queue.markRejected("synthetic-old-capability-op","currency_client_upgrade_required")}
        var calls=0
        val transport=object:NotificationIngestTransport {override fun post(path:String,sessionToken:String,payload:String):IngestResponse{
            calls++;assertEquals(body,payload)
            return IngestResponse(true,200,"""{"operation_results":[{"event":{"event_id":"synthetic-old-event"},"transaction_id":"synthetic-old-ledger"}]}""")
        }}
        assertEquals(1,coordinator(dir,transport).flushDetailed().uploaded);assertEquals(1,calls);assertEquals(0,queue.pendingCount())
    }
}
