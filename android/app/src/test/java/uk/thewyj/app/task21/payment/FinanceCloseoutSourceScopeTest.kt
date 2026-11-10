package uk.thewyj.app.task21.payment

import android.app.Application
import androidx.room.Room
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.store.*

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceCloseoutSourceScopeTest {
    private lateinit var db:NotificationDatabase
    private lateinit var store:RoomPaymentRecognitionStore
    private lateinit var coordinator:PaymentRecognitionCoordinator
    @Before fun setup(){db=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java).allowMainThreadQueries().build();store=RoomPaymentRecognitionStore(db);coordinator=PaymentRecognitionCoordinator(store,currencyPolicyVersion=2)}
    @After fun close(){db.close()}
    private fun capture(id:String,uid:Int?)=coordinator.onSourceEvent("synthetic-scope","com.tencent.mm",PaymentSourceType.NOTIFICATION,
        id,"微信支付","支付成功 实付 CNY 34.00 交易号 SYNTH-CLOSEOUT-SCOPE",uploadEventId=id,sourceUid=uid)
    @Test fun referenceCannotInventAnUnknownHistoricalProfile(){
        val old=capture("original",null);val original=store.localBookings("synthetic-scope").single()
        val current=capture("known-profile-alias",9510030)
        assertNotEquals(old.recognitionId,current.recognitionId)
        assertEquals(listOf(original),store.localBookings("synthetic-scope"))
        assertEquals("reference_money_or_instance_conflict",store.recognition("synthetic-scope",current.recognitionId)!!.identityReviewReason)
        assertEquals(1,store.pendingCandidateCount("synthetic-scope"))
    }
    @Test fun missingNewProfileCannotReuseAKnownProfileReference(){
        val old=capture("original",10030);val current=capture("unknown-profile-alias",null)
        assertNotEquals(old.recognitionId,current.recognitionId)
        assertEquals(1,store.localBookings("synthetic-scope").size)
    }
    @Test fun directSourceIdFromAnotherProfileCannotPublishAnAlias(){
        val old=capture("same-event",10030);val original=store.recognition("synthetic-scope",old.recognitionId)
        val conflict=capture("same-event",9510030)
        assertEquals("source_scope_conflict",conflict.skippedReason)
        assertEquals(original,store.recognition("synthetic-scope",old.recognitionId))
        assertEquals(1,store.localBookings("synthetic-scope").size)
    }
    @Test fun provenSameProfileReferenceReplayKeepsOriginalIdentity(){
        val old=capture("original",10030);val current=capture("same-profile-alias",10030)
        assertEquals(old.recognitionId,current.recognitionId);assertEquals(1,store.localBookings("synthetic-scope").size)
    }
    @Test fun rejectedCaptureCannotAppendAnotherProfilesMessageProof(){
        val sink=object:uk.thewyj.app.task21.NotificationArchiveSink {
            override fun store(accountId:String,input:uk.thewyj.app.task21.NotificationCaptureInput,parsed:uk.thewyj.app.task21.StructuredNotificationEvent?)=false
            override fun markRemoved(accountId:String,input:uk.thewyj.app.task21.NotificationCaptureInput)=Unit
            override fun storeMediaStoreScreenshot(accountId:String,event:uk.thewyj.app.task21.ScreenshotMediaEvent)=uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome.SKIPPED
        }
        val hook=AndroidPaymentRecognitionHook(RuntimeEnvironment.getApplication(),sink,store,testing=true,
            notifierOverride=object:PaymentStatusNotifier {
                override fun notify(message:PaymentStatusNotificationMessage)=true
                override fun cancel(notificationId:Int)=Unit
            })
        val input=uk.thewyj.app.task21.NotificationCaptureInput("com.tencent.mm",title="微信支付",text="支付成功 实付 CNY 34.00 交易号 SYNTH-HOOK-SCOPE",
            notificationKey="synthetic-slot",notificationId=7,paymentEventId="synthetic-hook-scope",sourceUid=10030,
            messageIdentity=uk.thewyj.app.task21.NotificationFingerprint.sha256Hex("synthetic-scope-message"))
        hook.onCapture("synthetic-scope",input,"合成",input.paymentEventId)
        val row=store.recognitionByUploadEvent("synthetic-scope",input.paymentEventId)!!
        val before=store.eventAliases("synthetic-scope",row.recognitionId).toSet()
        hook.onCapture("synthetic-scope",input.copy(sourceUid=9510030),"合成",input.paymentEventId)
        assertEquals(before,store.eventAliases("synthetic-scope",row.recognitionId).toSet())
        assertEquals(row,store.recognition("synthetic-scope",row.recognitionId))
    }
    @Test fun durableVerifiedCurrencyCannotBeInvalidatedByLaterDefaultOnExactEventReplay(){
        var default="USD"
        val c=PaymentRecognitionCoordinator(store,currencyPolicyVersion=2,defaultCurrency={default},now={1000L})
        val first=c.onSourceEvent("synthetic-scope","com.tencent.mm",PaymentSourceType.NOTIFICATION,"durable-cny",
            "微信支付","支付成功 实付 CNY 100.00 交易号 SYNTH-PRIOR-004",uploadEventId="durable-cny")
        val original=store.recognition("synthetic-scope",first.recognitionId)!!
        assertEquals(2,store.localBookings("synthetic-scope").single().amountExponent)
        default="JPY"
        c.onSourceEvent("synthetic-scope","com.tencent.mm",PaymentSourceType.NOTIFICATION,"durable-cny",
            "微信支付","支付成功 实付 ¥100.00 交易号 SYNTH-PRIOR-004",uploadEventId="durable-cny")
        assertEquals("",store.recognition("synthetic-scope",first.recognitionId)!!.identityReviewReason)
        assertEquals(original,store.recognition("synthetic-scope",first.recognitionId))
        assertEquals("CNY",store.localBookings("synthetic-scope").single().currency)
    }
    @Test fun legitimateDuplicateCanPersistANewSameProfileMessageProof(){
        val sink=object:uk.thewyj.app.task21.NotificationArchiveSink {
            override fun store(accountId:String,input:uk.thewyj.app.task21.NotificationCaptureInput,parsed:uk.thewyj.app.task21.StructuredNotificationEvent?)=false
            override fun markRemoved(accountId:String,input:uk.thewyj.app.task21.NotificationCaptureInput)=Unit
            override fun storeMediaStoreScreenshot(accountId:String,event:uk.thewyj.app.task21.ScreenshotMediaEvent)=uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome.SKIPPED
        }
        val hook=AndroidPaymentRecognitionHook(RuntimeEnvironment.getApplication(),sink,store,testing=true,
            notifierOverride=object:PaymentStatusNotifier {
                override fun notify(message:PaymentStatusNotificationMessage)=true
                override fun cancel(notificationId:Int)=Unit
            })
        val input=uk.thewyj.app.task21.NotificationCaptureInput("com.tencent.mm",title="微信支付",text="支付成功 实付 CNY 34.00 交易号 SYNTH-VALID-REPLAY",
            notificationKey="synthetic-replay",notificationId=8,paymentEventId="synthetic-valid-replay",sourceUid=10030,
            messageIdentity=uk.thewyj.app.task21.NotificationFingerprint.sha256Hex("synthetic-original-message"))
        hook.onCapture("synthetic-scope",input,"合成",input.paymentEventId)
        val replay=input.copy(messageIdentity=uk.thewyj.app.task21.NotificationFingerprint.sha256Hex("synthetic-new-proof"))
        hook.onCapture("synthetic-scope",replay,"合成",replay.paymentEventId)
        assertEquals(1,store.localBookings("synthetic-scope").size)
        assertEquals(store.recognitionByUploadEvent("synthetic-scope",input.paymentEventId),
            store.recognitionsByMessageProof("synthetic-scope",uk.thewyj.app.task21.paymentMessageProof(replay)).single())
    }
}
