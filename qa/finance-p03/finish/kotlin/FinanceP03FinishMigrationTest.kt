package uk.thewyj.app.task21.store
import android.app.Application
import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.OfflineNotificationQueue
import java.io.File
import java.util.UUID

/** Exact exported historical schemas, isolated SQLite files, no formal DB. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceP03FinishMigrationTest {
    private val c get()=RuntimeEnvironment.getApplication()
    private val out get()=File(System.getProperty("finance.finish.trace.output")).apply{mkdirs()}
    private val root get()=File(System.getProperty("finance.p02.root")).parentFile.parentFile
    private val owner="synthetic-finish-migration"
    private val recognition="synthetic-original-recognition"
    private val event="synthetic-original-event"
    private val transaction="synthetic-original-transaction"
    private fun fresh()=File(c.cacheDir,"m${UUID.randomUUID().toString().take(5)}.db")
    private fun insert(db:SQLiteDatabase,table:String,known:Map<String,Any>){
        val values=ContentValues()
        db.rawQuery("PRAGMA table_info($table)",null).use{q->while(q.moveToNext()){
            val name=q.getString(1);val type=q.getString(2);val notNull=q.getInt(3)==1;val default=q.getString(4)
            val value=known[name]?:if(notNull&&default==null){if(type.contains("INT"))0L else ""}else continue
            when(value){is Number->values.put(name,value.toLong());else->values.put(name,value.toString())}
        }}
        db.insertOrThrow(table,null,values)
    }
    private fun seed(f:File,version:Int){
        val schema=JSONObject(File(root,"android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/$version.json").readText()).getJSONObject("database")
        assertEquals(version,schema.getInt("version"))
        SQLiteDatabase.openOrCreateDatabase(f,null).use{db->
            val entities=schema.getJSONArray("entities")
            for(i in 0 until entities.length()){
                val e=entities.getJSONObject(i);val table=e.getString("tableName");db.execSQL(e.getString("createSql").replace("\${TABLE_NAME}",table))
                val indexes=e.optJSONArray("indices");if(indexes!=null)for(j in 0 until indexes.length())db.execSQL(indexes.getJSONObject(j).getString("createSql").replace("\${TABLE_NAME}",table))
            }
            val setup=schema.getJSONArray("setupQueries");for(i in 0 until setup.length())db.execSQL(setup.getString(i))
            val shared=mapOf("accountId" to owner,"recognitionId" to recognition,"sourcePackage" to "95555","sourceType" to "BANK_NOTIFICATION","paymentChannel" to "bank_card","amountMinor" to 8000L,"currency" to "USD","direction" to "EXPENSE","merchant" to "synthetic","providerReference" to "SYNTHETIC-ORIGINAL-CAPTURE","createdAtMs" to 1000L)
            insert(db,"payment_recognitions",shared+mapOf("state" to "FINANCE_RECORDED","notificationId" to 7L,"sourceEventId" to "sms#event#$event","uploadEventId" to event,"hasAmount" to 1L,"updatedAtMs" to 1000L,"completionConfirmed" to 1L,"sourceUid" to -1L))
            insert(db,"local_payment_bookings",shared+mapOf("eventId" to event,"transactionId" to transaction,"occurredAtMs" to 1000L,"syncState" to "pending"))
            db.version=version
        }
    }
    private fun current(f:File,last:Migration=NotificationDatabase.MIGRATION_13_14)=Room.databaseBuilder(c,NotificationDatabase::class.java,f.absolutePath).addMigrations(NotificationDatabase.MIGRATION_9_10,NotificationDatabase.MIGRATION_10_11,NotificationDatabase.MIGRATION_11_12,NotificationDatabase.MIGRATION_12_13,last).allowMainThreadQueries().build()
    private fun inspect(f:File,version:Int){SQLiteDatabase.openDatabase(f.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use{db->
        assertEquals(version,db.version)
        db.rawQuery("PRAGMA integrity_check",null).use{assertTrue(it.moveToFirst());assertEquals("ok",it.getString(0))}
        db.rawQuery("SELECT transactionId,amountMinor,recognitionId FROM local_payment_bookings",null).use{assertTrue(it.moveToFirst());assertEquals(transaction,it.getString(0));assertEquals(8000L,it.getLong(1));assertEquals(recognition,it.getString(2));assertFalse(it.moveToNext())}
        db.rawQuery("SELECT COUNT(*) FROM local_payment_bookings b LEFT JOIN payment_recognitions r ON b.accountId=r.accountId AND b.recognitionId=r.recognitionId WHERE r.recognitionId IS NULL",null).use{assertTrue(it.moveToFirst());assertEquals(0,it.getInt(0))}
        db.rawQuery("SELECT COUNT(*) FROM (SELECT accountId,eventId,COUNT(*) n FROM local_payment_bookings GROUP BY accountId,eventId HAVING n>1)",null).use{assertTrue(it.moveToFirst());assertEquals(0,it.getInt(0))}
    }}
    @Test fun exactSchemasNineElevenTwelveThirteenUpgradeWithNoOrphansAndSameOutbox(){
        val rows=JSONArray()
        for(version in listOf(9,11,12,13)){
            val f=fresh();seed(f,version);inspect(f,version)
            val q=File(f.path+".q");val queue=OfflineNotificationQueue(q);queue.enqueue(event,"{\"synthetic\":true,\"transaction_id\":\"$transaction\"}");val before=queue.peekRequests()
            val db=current(f);try{assertEquals(14,db.openHelper.writableDatabase.version);assertEquals(transaction,db.paymentDao().localBookings(owner).single().transactionId)}finally{db.close()}
            inspect(f,14);assertEquals(before,OfflineNotificationQueue(q).peekRequests())
            val copy=File(out,"schema-$version-upgraded.sqlite");check(!copy.exists());f.copyTo(copy)
            rows.put(JSONObject().put("old_schema",version).put("new_schema",14).put("original_id",transaction).put("outbox_request_count",before.size).put("orphans",0).put("duplicate_bookings",0).put("scope","exact exported schema on Robolectric SQLite; NOT formal/device data"))
        }
        val log=File(out,"room-four-schema-upgrades.json");check(!log.exists());log.writeText(rows.toString())
    }
    @Test fun nineToFourteenFaultRollsBackWholeChainThenPairedBackupRejectsOldWriter(){
        val f=fresh();seed(f,9)
        val q=File(f.path+".q");OfflineNotificationQueue(q).enqueue(event,"{\"synthetic\":true}");val requests=OfflineNotificationQueue(q).peekRequests()
        val broken=object:Migration(13,14){override fun migrate(db:SupportSQLiteDatabase){NotificationDatabase.MIGRATION_13_14.migrate(db);db.execSQL("SELECT * FROM synthetic_finish_missing_table")}}
        val bad=current(f,broken);try{try{bad.openHelper.writableDatabase;fail("Fault must surface")}catch(e:Exception){assertTrue(e.toString().contains("synthetic_finish_missing_table"))}}finally{bad.close()}
        inspect(f,9);assertEquals(requests,OfflineNotificationQueue(q).peekRequests())
        val retry=current(f);retry.openHelper.writableDatabase;retry.close();inspect(f,14)
        val restored=fresh();f.copyTo(restored);val restoredQueue=File(restored.path+".q");q.copyTo(restoredQueue)
        val copy=current(restored);copy.openHelper.writableDatabase;copy.close();inspect(restored,14);assertEquals(requests,OfflineNotificationQueue(restoredQueue).peekRequests())
        val old=FrameworkSQLiteOpenHelperFactory().create(SupportSQLiteOpenHelper.Configuration.builder(c).name(restored.absolutePath).callback(object:SupportSQLiteOpenHelper.Callback(9){override fun onCreate(db:SupportSQLiteDatabase)=Unit;override fun onUpgrade(db:SupportSQLiteDatabase,old:Int,new:Int)=Unit}).build())
        try{try{old.writableDatabase;fail("Old writer must refuse downgrade")}catch(e:Exception){assertTrue(e.toString().contains("downgrade",true))}}finally{old.close()}
        inspect(restored,14)
        val log=File(out,"room-whole-chain-recovery.json");check(!log.exists());log.writeText(JSONObject().put("fault_rolled_back_to",9).put("retry_schema",14).put("closed_pair_restored",true).put("old_v9_callback_refused",true).put("actual_old_formal_apk","NOT TESTED").put("original_id",transaction).toString())
    }
}
