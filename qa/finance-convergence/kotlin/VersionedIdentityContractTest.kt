package uk.thewyj.app.task21.payment
import android.app.Application
import android.content.Context
import androidx.room.Room
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.store.*
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome

/** Versioned examples, not replacements for any original A/C fixture or oracle. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class VersionedIdentityContractTest {
 private val app get()=RuntimeEnvironment.getApplication()
 private lateinit var db:NotificationDatabase
 private lateinit var store:RoomPaymentRecognitionStore
 private lateinit var hook:AndroidPaymentRecognitionHook
 @Before fun setup(){
  app.getSharedPreferences("wyj-payment-notification-lifecycles",Context.MODE_PRIVATE).edit().clear().commit()
  db=Room.inMemoryDatabaseBuilder(app,NotificationDatabase::class.java).allowMainThreadQueries().build();store=RoomPaymentRecognitionStore(db)
  val sink=object:NotificationArchiveSink{
   override fun store(accountId:String,input:NotificationCaptureInput,parsed:StructuredNotificationEvent?)=false
   override fun markRemoved(accountId:String,input:NotificationCaptureInput)=Unit
   override fun storeMediaStoreScreenshot(accountId:String,event:ScreenshotMediaEvent)=ScreenshotArchiveOutcome.SKIPPED
  }
  hook=AndroidPaymentRecognitionHook(app,sink,store,testing=true,notifierOverride=object:PaymentStatusNotifier{override fun notify(message:PaymentStatusNotificationMessage)=true;override fun cancel(notificationId:Int)=Unit})
 }
 @After fun close(){db.close()}
 private fun unproven(pkg:String,restart:Boolean){
  val owner="synthetic-v2-owner";var next=0
  fun registry()=AndroidPaymentNotificationLifecycleRegistry(app,now={1000L},idFactory={"synthetic-v2-${++next}"})
  var registry=registry();val input=NotificationCaptureInput(pkg,notificationKey="synthetic-same-slot",notificationId=7,title="支付",text="支付成功 CNY 648.00",postTime=1000,receivedAtMs=1000,sourceUid=10390)
  val outcome=hook.outcomeFor(owner,input)!!;assertFalse(outcome.identityReviewReason.isBlank())
  val id=registry.eventId(owner,input,outcome);hook.onCapture(owner,input.copy(paymentEventId=id),"SYNTHETIC",id)
  registry.markRemoved(owner,input);if(restart)registry=registry()
  val replay=registry.eventId(owner,input,outcome);hook.onCapture(owner,input.copy(paymentEventId=replay),"SYNTHETIC",replay)
  assertEquals(id,replay);assertTrue(store.localBookings(owner).isEmpty());assertEquals(1,store.candidates(owner,"pending").size)
  val records=store.recognitionsByState(owner,PaymentRecognitionState.entries.map{it.name});assertEquals(1,records.size)
  assertTrue(records.single().identityReviewReason.startsWith("identity_unproven_"))
 }
 @Test fun A009WechatZeroDelayAfterRestartRemainsManual()=unproven("com.tencent.mm",true)
 @Test fun A011WechatZeroDelayRemainsManual()=unproven("com.tencent.mm",false)
 @Test fun A201AlipayZeroDelayAfterRestartRemainsManual()=unproven("com.eg.android.AlipayGphone",true)
 @Test fun A203AlipayZeroDelayRemainsManual()=unproven("com.eg.android.AlipayGphone",false)
 @Test fun distinctSourceReferencesSameMoneyAndReplayPreserveTwoOriginalIds(){
  val owner="synthetic-v2-proven";val base=NotificationCaptureInput("com.tencent.mm",title="微信支付",text="支付成功 CNY 648.00 交易号 SYNTH-V2-OP-A",sourceUid=10390,receivedAtMs=1000,postTime=1000)
  for((id,input) in listOf("synthetic-proof-A" to base,"synthetic-proof-B" to base.copy(text=base.text.replace("OP-A","OP-B")))){
   hook.onCapture(owner,input.copy(paymentEventId=id),"SYNTHETIC",id);hook.onCapture(owner,input.copy(paymentEventId=id),"SYNTHETIC",id)
  }
  assertEquals(2,store.localBookings(owner).size);assertEquals(129600L,store.localBookings(owner).sumOf{it.amountMinor});assertEquals(2,store.localBookings(owner).map{it.eventId}.distinct().size)
  assertTrue(store.localBookings("other-account").isEmpty())
 }
}
