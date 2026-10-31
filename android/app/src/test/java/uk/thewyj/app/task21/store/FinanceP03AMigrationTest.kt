package uk.thewyj.app.task21.store

import android.app.Application
import android.database.sqlite.SQLiteDatabase
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.OfflineNotificationQueue
import java.io.File
import java.util.UUID

/** Actual frozen v12 entities/runtime, not a physical old APK. */
@Database(entities=[NotificationInstanceEntity::class,NotificationRevisionEntity::class,NotificationAppPolicyEntity::class,
    NotificationRuleEntity::class,NotificationSettingsEntity::class,PaymentRecognitionEntity::class,PaymentTicketEntity::class,
    PaymentCandidateEntity::class,LocalPaymentBookingEntity::class,PaymentEventAliasEntity::class],version=12,exportSchema=false)
abstract class P03AV12Database: RoomDatabase() { abstract fun paymentDao(): PaymentDao }

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceP03AMigrationTest {
    private val context get()=RuntimeEnvironment.getApplication()
    private fun file()=File(context.cacheDir,"a-"+UUID.randomUUID().toString().take(8)+".db")
    private fun old(f:File)=Room.databaseBuilder(context,P03AV12Database::class.java,f.absolutePath).allowMainThreadQueries().build()
    private fun current(f:File,m:Migration=NotificationDatabase.MIGRATION_12_13)=Room.databaseBuilder(context,NotificationDatabase::class.java,f.absolutePath).addMigrations(m,NotificationDatabase.MIGRATION_13_14).allowMainThreadQueries().build()
    private inline fun<T:RoomDatabase,R>T.closed(block:(T)->R):R=try{block(this)}finally{close()}
    private fun seed(f:File) { uk.thewyj.app.finance.FrozenRoomFixture.create(f,12).use { db ->
        db.execSQL("INSERT INTO local_payment_bookings VALUES('synthetic-account','synthetic-event','synthetic-recognition','synthetic-original-id',8000,'EXPENSE','USD','synthetic',1000,'95555','bank_sms','SYNTH-CAPTURE','pending',1000)")
    } }
    private fun inspect(f:File,version:Int) { SQLiteDatabase.openDatabase(f.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use { db ->
        assertEquals(version,db.version);db.rawQuery("SELECT transactionId,amountMinor,currency FROM local_payment_bookings",null).use {c->assertTrue(c.moveToFirst());assertEquals("synthetic-original-id",c.getString(0));assertEquals(8000L,c.getLong(1));assertEquals("USD",c.getString(2));assertFalse(c.moveToNext())}
    } }
    @Test fun twelveToThirteenKeepsLegacyBookingAndEmptyCorrectionState() {
        val f=file();seed(f);current(f).closed {db->assertEquals("synthetic-original-id",db.paymentDao().localBookings("synthetic-account").single().transactionId);assertTrue(db.reconciliationDao().staged("synthetic-account").isEmpty())};inspect(f,NotificationDatabase.SCHEMA_VERSION)
    }
    @Test fun interruptedAdditiveMigrationRollsBackAndRetries() {
        val f=file();seed(f);val broken=object:Migration(12,13){override fun migrate(db:SupportSQLiteDatabase){db.execSQL("CREATE TABLE synthetic_partial(id INTEGER)");db.execSQL("INSERT INTO synthetic_missing VALUES(1)")}}
        try{current(f,broken).closed{it.openHelper.writableDatabase};fail("injected migration must fail")}catch(e:Exception){assertTrue(e.toString().contains("synthetic_missing"))}
        inspect(f,12);SQLiteDatabase.openDatabase(f.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use { db->db.rawQuery("SELECT COUNT(*) FROM sqlite_master WHERE name='synthetic_partial'",null).use{assertTrue(it.moveToFirst());assertEquals(0,it.getInt(0))}}
        current(f).closed{assertEquals(NotificationDatabase.SCHEMA_VERSION,it.openHelper.writableDatabase.version)};inspect(f,NotificationDatabase.SCHEMA_VERSION)
    }
    @Test fun actualOldRoomOpenerFailsClosedAfterUpgrade() {
        val f=file();seed(f);current(f).closed{it.openHelper.writableDatabase}
        try{old(f).closed{it.openHelper.writableDatabase};fail("no destructive downgrade")}catch(e:IllegalStateException){assertTrue(e.message.orEmpty().contains("${NotificationDatabase.SCHEMA_VERSION} to 12"))};inspect(f,NotificationDatabase.SCHEMA_VERSION)
    }
    @Test fun repeatedCreateOnlyMigrationPreservesStagedJournalAndIds() {
        val f=file();seed(f);current(f).closed { db ->
            db.reconciliationDao().saveJournal(PaymentReconciliationEntity("synthetic-account","synthetic-op","a".repeat(64),"{}","staged","","{}","{}",1,1))
            NotificationDatabase.MIGRATION_12_13.migrate(db.openHelper.writableDatabase)
            assertEquals("synthetic-op",db.reconciliationDao().staged("synthetic-account").single().operationId)
        };inspect(f,NotificationDatabase.SCHEMA_VERSION)
    }
    @Test fun closedDatabaseAndPairedDiskOutboxRestoreWithoutClearingOriginal() {
        val f=file();seed(f);val queueFile=File(context.cacheDir,"q-"+UUID.randomUUID().toString().take(8));val queue=OfflineNotificationQueue(queueFile)
        queue.enqueue("synthetic-op","{\"synthetic\":true}")
        current(f).closed{db->db.reconciliationDao().saveJournal(PaymentReconciliationEntity("synthetic-account","synthetic-op","a".repeat(64),"{}","staged","","{}","{}",1,1))}
        val restored=file();f.copyTo(restored);val restoredQueue=File(context.cacheDir,"q-"+UUID.randomUUID().toString().take(8));queueFile.copyTo(restoredQueue)
        current(restored).closed{db->assertEquals("synthetic-op",db.reconciliationDao().staged("synthetic-account").single().operationId)}
        assertEquals(queue.peekRequests(),OfflineNotificationQueue(restoredQueue).peekRequests());inspect(f,NotificationDatabase.SCHEMA_VERSION);inspect(restored,NotificationDatabase.SCHEMA_VERSION)
    }
}
