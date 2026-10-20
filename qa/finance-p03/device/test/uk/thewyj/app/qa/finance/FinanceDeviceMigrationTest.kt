package uk.thewyj.app.qa.finance
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.task21.OfflineNotificationQueue
import uk.thewyj.app.task21.store.NotificationDatabase
import java.io.File
import java.util.UUID
@RunWith(AndroidJUnit4::class)
class FinanceDeviceMigrationTest {
    private val c get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val assets get()=InstrumentationRegistry.getInstrumentation().context.assets
    private fun fresh()=File(c.filesDir,"finance-p03-device/migration-${UUID.randomUUID()}.db").apply{parentFile!!.mkdirs()}
    private fun seed(file:File,v:Int){
        val schema=assets.open("schema-$v.json").use{JSONObject(it.bufferedReader().readText())}.getJSONObject("database")
        SQLiteDatabase.openOrCreateDatabase(file,null).use {db->
            val entities=schema.getJSONArray("entities")
            for(i in 0 until entities.length()){
                val e=entities.getJSONObject(i);val table=e.getString("tableName")
                db.execSQL(e.getString("createSql").replace("\${TABLE_NAME}",table))
                val indexes=e.optJSONArray("indices")
                if(indexes!=null)for(j in 0 until indexes.length())db.execSQL(indexes.getJSONObject(j).getString("createSql").replace("\${TABLE_NAME}",table))
            }
            val setup=schema.getJSONArray("setupQueries");for(i in 0 until setup.length())db.execSQL(setup.getString(i))
            db.execSQL("INSERT INTO local_payment_bookings VALUES('synthetic-migration','synthetic-event','synthetic-recognition','synthetic-original-id',8000,'EXPENSE','USD','synthetic',1000,'95555','bank_sms','SYNTH-CAPTURE','pending',1000)")
            db.version=v
        }
    }
    private fun open(file:File,broken:Migration?=null)=Room.databaseBuilder(c,NotificationDatabase::class.java,file.absolutePath)
        .addMigrations(NotificationDatabase.MIGRATION_9_10,NotificationDatabase.MIGRATION_10_11,NotificationDatabase.MIGRATION_11_12,NotificationDatabase.MIGRATION_12_13,broken?:NotificationDatabase.MIGRATION_13_14).build()
    private fun inspect(file:File,v:Int){SQLiteDatabase.openDatabase(file.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use{db->
        assertEquals(v,db.version);db.rawQuery("PRAGMA integrity_check",null).use{assertTrue(it.moveToFirst());assertEquals("ok",it.getString(0))}
        db.rawQuery("SELECT transactionId,amountMinor FROM local_payment_bookings",null).use{assertTrue(it.moveToFirst());assertEquals("synthetic-original-id",it.getString(0));assertEquals(8000L,it.getLong(1));assertFalse(it.moveToNext())}
    }}
    @Test fun compiledFormalSchemaNineToFourteenNativeMigration(){
        val f=fresh();seed(f,9);val db=open(f);try{assertEquals(14,db.openHelper.writableDatabase.version);assertEquals("synthetic-original-id",db.paymentDao().localBookings("synthetic-migration").single().transactionId)}finally{db.close()}
        inspect(f,14);FinanceDeviceSupport.record(c,"DEVICE-MIGRATION-9-14",JSONObject().put("old_compiled_schema",9).put("new_schema",14).put("private_formal_rows",false))
    }
    @Test fun interruptedNativeMigrationRollsBackAndRetries(){
        val f=fresh();seed(f,13)
        val broken=object:Migration(13,14){override fun migrate(db:SupportSQLiteDatabase){NotificationDatabase.MIGRATION_13_14.migrate(db);db.execSQL("INSERT INTO synthetic_missing_table VALUES(1)")}}
        val first=open(f,broken);try{try{first.openHelper.writableDatabase;fail("Injected failure must surface")}catch(e:Exception){assertTrue(e.toString().contains("synthetic_missing_table"))}}finally{first.close()}
        inspect(f,13);val retry=open(f);try{assertEquals(14,retry.openHelper.writableDatabase.version)}finally{retry.close()};inspect(f,14)
        FinanceDeviceSupport.record(c,"DEVICE-MIGRATION-INTERRUPT",JSONObject().put("rolled_back",true).put("retry",14))
    }
    @Test fun closedNativeDatabaseAndMatchingOutboxRestoreWithoutDowngrade(){
        val f=fresh();seed(f,13);val upgraded=open(f);upgraded.openHelper.writableDatabase;upgraded.close();inspect(f,14)
        val q=File(f.path+".outbox");OfflineNotificationQueue(q).enqueue("synthetic-migration-op","{\"synthetic\":true}")
        val backup=fresh();f.copyTo(backup);val bq=File(backup.path+".outbox");q.copyTo(bq)
        val restored=open(backup);assertEquals(14,restored.openHelper.writableDatabase.version);restored.close()
        assertEquals(OfflineNotificationQueue(q).peekRequests(),OfflineNotificationQueue(bq).peekRequests())
        val old=FrameworkSQLiteOpenHelperFactory().create(SupportSQLiteOpenHelper.Configuration.builder(c).name(backup.absolutePath).callback(object:SupportSQLiteOpenHelper.Callback(9){override fun onCreate(db:SupportSQLiteDatabase)=Unit;override fun onUpgrade(db:SupportSQLiteDatabase,o:Int,n:Int)=Unit}).build())
        try{try{old.writableDatabase;fail("Old opener must fail closed")}catch(e:Exception){assertTrue(e.toString().contains("downgrade",true))}}finally{old.close()}
        inspect(f,14);inspect(backup,14)
        FinanceDeviceSupport.record(c,"DEVICE-NATIVE-BACKUP",JSONObject().put("closed_pair_restored",true).put("old_opener_rejected",true).put("actual_old_apk_execution",false))
    }
}
