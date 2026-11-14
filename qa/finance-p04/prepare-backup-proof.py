"""Generate an isolated, two-JVM four-component backup proof using product readers."""
from pathlib import Path
import os

ROOT=Path(__file__).resolve().parents[2]
DEST=Path(os.environ['FINANCE_BACKUP_ROOT']).resolve()
assert DEST.is_relative_to(ROOT/'docs/migration-evidence/finance-p04')
(DEST/'kotlin').mkdir(parents=True,exist_ok=False)
(DEST/'test.init.gradle').write_bytes((ROOT/'qa/finance-p02/test.init.gradle').read_bytes())
source=r'''package uk.thewyj.app.finance
import android.app.Application
import androidx.room.Room
import java.io.File
import java.security.MessageDigest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.OfflineNotificationQueue
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.*

private const val BACKUP_OWNER="synthetic-backup-owner"
private val backupNames=setOf("notification.sqlite","currency.sqlite","outbox.queue","currency-context.xml")
private fun digest(file:File)=MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString(""){"%02x".format(it)}
private fun output()=File(System.getProperty("finance.p02.output")).apply{mkdirs()}
private fun validate(folder:File,manifest:JSONObject,owner:String){
    check(manifest.getString("account_id")==owner)
    val files=manifest.getJSONObject("files");check(files.keys().asSequence().toSet()==backupNames)
    for(name in backupNames)check(digest(File(folder,name))==files.getString(name))
}
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class CurrencyP04BackupSeedTest {
 @Test fun closeAndSealAllFourNonsecretComponents(){
  val context=RuntimeEnvironment.getApplication();val out=output();val folder=File(out,"sealed");check(folder.mkdirs())
  val mainFile=File(context.cacheDir,"m.db");val fxFile=File(context.cacheDir,"f.db");val queueFile=File(context.cacheDir,"q.queue")
  val main=Room.databaseBuilder(context,NotificationDatabase::class.java,mainFile.absolutePath).allowMainThreadQueries().build()
  val fx=Room.databaseBuilder(context,CurrencyReferenceDatabase::class.java,fxFile.absolutePath).allowMainThreadQueries().build()
  val store=RoomPaymentRecognitionStore(main)
  val rec=PaymentRecognitionCoordinator(store,currencyPolicyVersion=2,now={1000L}).onSourceEvent(BACKUP_OWNER,"com.tencent.mm",PaymentSourceType.NOTIFICATION,"synthetic-backup-event","微信支付","已扣款 $100.00")
  assertTrue(rec.recognitionId.isNotBlank());assertEquals("XXX",store.recognition(BACKUP_OWNER,rec.recognitionId)!!.currency)
  fx.currencies().putCurrencyDecision(ManualCurrencyDecision(BACKUP_OWNER,rec.recognitionId,"JPY",1000))
  fx.currencies().putPreferences(CachedCurrencyPreferences(BACKUP_OWNER,"CNY","CNY","USD",1))
  fx.currencies().putSourceUnit(CachedSourceCurrencyUnit(BACKUP_OWNER,"synthetic-known-JPY","JPY",0))
  val rate=JSONObject().put("base","USD").put("quote","CNY").put("requested_date","2026-10-19").put("rate_timestamp","2026-10-19T00:00:00Z")
    .put("rate","7").put("source","P04 synthetic nonmarket backup fixture").put("fetched_at","2026-10-22T12:00:00Z").put("expires_at","2026-10-22T18:00:00Z").put("rounding","HALF_EVEN")
  val rateId=CurrencyReferenceRepository.snapshotId(rate);fx.currencies().putRate(CachedCurrencyRate(rateId,CurrencyReferenceRepository.canonicalRate(rate)))
  fx.currencies().putReference(CachedCurrencyReference(BACKUP_OWNER,"synthetic-history-id",1,"CNY",rateId,"USD",10000,70000))
  CurrencyRuntimePreferences.save(context,BACKUP_OWNER,"USD")
  assertTrue(context.getSharedPreferences("wyj-currency-context",0).edit().putString("$BACKUP_OWNER:default","USD").commit())
  val prefs=File(context.applicationInfo.dataDir,"shared_prefs/wyj-currency-context.xml");assertTrue(prefs.exists())
  val queue=OfflineNotificationQueue(queueFile);queue.enqueue("synthetic-old-operation","{\"synthetic\":true}")
  repeat(OfflineNotificationQueue.MAX_UPLOAD_ATTEMPTS){queue.markRejected("synthetic-old-operation","currency_client_upgrade_required")};queue.retryCurrencyProtocolUpgrades()
  queue.enqueueRequest("synthetic-currency-operation",OfflineNotificationQueue.CURRENCY_CONFIRM_PATH,"{\"event_id\":\"synthetic-backup-event\",\"edits\":{\"currency\":\"JPY\",\"amount_minor\":3725,\"amount_exponent\":0}}")
  val requests=queue.peekRequests();main.close();fx.close()
  for((name,file)in mapOf("notification.sqlite" to mainFile,"currency.sqlite" to fxFile,"outbox.queue" to queueFile,"currency-context.xml" to prefs))file.copyTo(File(folder,name))
  val files=JSONObject();backupNames.forEach{files.put(it,digest(File(folder,it)))}
  val manifest=JSONObject().put("account_id",BACKUP_OWNER).put("room_version",16).put("fx_version",1).put("files",files).put("recognition_id",rec.recognitionId)
    .put("seed_pid",ProcessHandle.current().pid()).put("rate_id",rateId).put("original_queue_body",requests.first().body)
    .put("scope","Actual closed synthetic files only; formal personal backup and device restore NOT_TESTED; no credentials included")
  validate(folder,manifest,BACKUP_OWNER);val target=File(out,"backup-manifest.json");check(target.createNewFile());target.writeText(manifest.toString(2))
 }
}
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class CurrencyP04BackupRestoreTest {
 @Test fun independentJvmRestoresMoneyIdentityManualChoicePreferencesAndExactQueue(){
  val context=RuntimeEnvironment.getApplication();val out=output();val folder=File(out,"sealed");val manifest=JSONObject(File(out,"backup-manifest.json").readText())
  assertNotEquals(manifest.getLong("seed_pid"),ProcessHandle.current().pid());validate(folder,manifest,BACKUP_OWNER)
  assertThrows(IllegalStateException::class.java){validate(folder,manifest,"synthetic-other-owner")}
  val missing=JSONObject(manifest.toString());missing.getJSONObject("files").remove("currency-context.xml")
  assertThrows(IllegalStateException::class.java){validate(folder,missing,BACKUP_OWNER)}
  val bad=JSONObject(manifest.toString());bad.getJSONObject("files").put("currency.sqlite","0".repeat(64))
  assertThrows(IllegalStateException::class.java){validate(folder,bad,BACKUP_OWNER)}
  val mainFile=File(context.cacheDir,"m.db");val fxFile=File(context.cacheDir,"f.db");val queueFile=File(context.cacheDir,"q.queue")
  val prefs=File(context.applicationInfo.dataDir,"shared_prefs/wyj-currency-context.xml");assertFalse(prefs.exists());prefs.parentFile!!.mkdirs()
  for((name,file)in mapOf("notification.sqlite" to mainFile,"currency.sqlite" to fxFile,"outbox.queue" to queueFile,"currency-context.xml" to prefs))File(folder,name).copyTo(file)
  val main=Room.databaseBuilder(context,NotificationDatabase::class.java,mainFile.absolutePath).allowMainThreadQueries().build()
  val fx=Room.databaseBuilder(context,CurrencyReferenceDatabase::class.java,fxFile.absolutePath).allowMainThreadQueries().build()
  try{
   assertEquals(16,main.openHelper.writableDatabase.version)
   val rec=RoomPaymentRecognitionStore(main).recognition(BACKUP_OWNER,manifest.getString("recognition_id"))!!;assertEquals("XXX",rec.currency)
   assertEquals("JPY",fx.currencies().currencyDecision(BACKUP_OWNER,rec.recognitionId)!!.currency)
   assertNull(fx.currencies().currencyDecision("synthetic-other-owner",rec.recognitionId))
   assertEquals("USD",fx.currencies().preferences(BACKUP_OWNER)!!.defaultCurrency);assertEquals("USD",CurrencyRuntimePreferences.defaultCurrency(context,BACKUP_OWNER))
   assertEquals(0,fx.currencies().sourceUnit(BACKUP_OWNER,"synthetic-known-JPY")!!.amountExponent)
   val history=CurrencyReferenceRepository(fx).cached(BACKUP_OWNER,"synthetic-history-id",1,"CNY")!!;assertEquals(10000L,history.originalMinor);assertEquals(70000L,history.convertedMinor);assertEquals(manifest.getString("rate_id"),history.rateId)
   val requests=OfflineNotificationQueue(queueFile).peekRequests();assertEquals(2,requests.size);assertEquals(manifest.getString("original_queue_body"),requests.first().body);assertEquals(3,requests.first().currencyCapabilityRetry)
   assertEquals(OfflineNotificationQueue.CURRENCY_CONFIRM_PATH,requests.last().path);assertEquals(3725,JSONObject(requests.last().body).getJSONObject("edits").getInt("amount_minor"))
  }finally{main.close();fx.close()}
  val result=JSONObject().put("status","PASS").put("seed_pid",manifest.getLong("seed_pid")).put("restore_pid",ProcessHandle.current().pid()).put("components",4).put("format","Room16 + FX1 + five-column Outbox + currency-only SharedPreferences").put("formal_backup","NOT_TESTED")
  val target=File(out,"backup-restore.json");check(target.createNewFile());target.writeText(result.toString(2))
 }
}
'''
(DEST/'kotlin/CurrencyP04BackupTest.kt').write_text(source,encoding='utf8')
print(DEST)
