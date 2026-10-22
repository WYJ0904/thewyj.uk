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

/** Exact v13 entity set. It intentionally knows no supersession table. */
@Database(entities=[NotificationInstanceEntity::class,NotificationRevisionEntity::class,NotificationAppPolicyEntity::class,
    NotificationRuleEntity::class,NotificationSettingsEntity::class,PaymentRecognitionEntity::class,PaymentTicketEntity::class,
    PaymentCandidateEntity::class,LocalPaymentBookingEntity::class,PaymentEventAliasEntity::class,PaymentReconciliationEntity::class,
    PaymentEffectiveRecognitionEntity::class,PaymentUserDecisionEntity::class,PaymentReconciliationAliasEntity::class],version=13,exportSchema=false)
abstract class P03FinalV13Database:RoomDatabase(){abstract fun paymentDao():PaymentDao}

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceP03FinalMigrationTest {
    private val context get()=RuntimeEnvironment.getApplication()
    private fun file()=File(context.cacheDir,"p03final-${UUID.randomUUID()}.db")
    private fun old(f:File)=Room.databaseBuilder(context,P03FinalV13Database::class.java,f.absolutePath).allowMainThreadQueries().build()
    private fun current(f:File,m:Migration=NotificationDatabase.MIGRATION_13_14)=Room.databaseBuilder(context,NotificationDatabase::class.java,f.absolutePath).addMigrations(m).allowMainThreadQueries().build()
    private fun seed(f:File){val db=old(f);try{
        db.openHelper.writableDatabase.execSQL("INSERT INTO local_payment_bookings VALUES('synthetic-account','synthetic-event','synthetic-recognition','synthetic-original-id',8000,'EXPENSE','USD','synthetic',1000,'95555','bank_sms','SYNTH-CAPTURE','pending',1000)")
        db.openHelper.writableDatabase.execSQL("INSERT INTO payment_reconciliations VALUES('synthetic-account','synthetic-operation','digest','{}','staged','','{}','{}',1000,1000)")
    }finally{db.close()}}
    private fun inspect(f:File,version:Int){SQLiteDatabase.openDatabase(f.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use{db->
        assertEquals(version,db.version)
        db.rawQuery("PRAGMA integrity_check",null).use{assertTrue(it.moveToFirst());assertEquals("ok",it.getString(0))}
        db.rawQuery("SELECT transactionId,amountMinor,currency FROM local_payment_bookings",null).use{c->assertTrue(c.moveToFirst());assertEquals("synthetic-original-id",c.getString(0));assertEquals(8000L,c.getLong(1));assertEquals("USD",c.getString(2));assertFalse(c.moveToNext())}
    }}
    @Test fun thirteenToFourteenPreservesOldIdsAndStagedJournal(){val f=file();seed(f);val db=current(f);try{
        assertEquals("synthetic-original-id",db.paymentDao().localBookings("synthetic-account").single().transactionId)
        assertEquals("synthetic-operation",db.reconciliationDao().staged("synthetic-account").single().operationId)
        assertNull(db.reconciliationDao().supersession("synthetic-account","synthetic-original-id"))
    }finally{db.close()};inspect(f,NotificationDatabase.SCHEMA_VERSION)}
    @Test fun interruptedTableCreationRollsBackAndCanRetry(){val f=file();seed(f)
        val broken=object:Migration(13,14){override fun migrate(db:SupportSQLiteDatabase){NotificationDatabase.MIGRATION_13_14.migrate(db);db.execSQL("INSERT INTO synthetic_missing_final VALUES(1)")}}
        val attempt=current(f,broken);try{try{attempt.openHelper.writableDatabase;fail("injected DDL must fail")}catch(e:Exception){assertTrue(e.toString().contains("synthetic_missing_final"))}}finally{attempt.close()}
        inspect(f,13);SQLiteDatabase.openDatabase(f.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use{db->db.rawQuery("SELECT COUNT(*) FROM sqlite_master WHERE name='payment_booking_supersessions'",null).use{assertTrue(it.moveToFirst());assertEquals(0,it.getInt(0))}}
        val retry=current(f);try{assertEquals(NotificationDatabase.SCHEMA_VERSION,retry.openHelper.writableDatabase.version)}finally{retry.close()};inspect(f,NotificationDatabase.SCHEMA_VERSION)
    }
    @Test fun oldV13RoomOpenerFailsClosedWithoutDataLoss(){val f=file();seed(f);val upgraded=current(f);upgraded.openHelper.writableDatabase;upgraded.close()
        val previous=old(f);try{try{previous.openHelper.writableDatabase;fail("must not downgrade or clear")}catch(e:IllegalStateException){assertTrue(e.message.orEmpty().contains("${NotificationDatabase.SCHEMA_VERSION} to 13"))}}finally{previous.close()};inspect(f,NotificationDatabase.SCHEMA_VERSION)
    }
    @Test fun repeatedCreatePreservesSupersessionAndOriginalBooking(){val f=file();seed(f);val db=current(f);try{
        db.reconciliationDao().supersede(PaymentBookingSupersessionEntity("synthetic-account","synthetic-original-id","synthetic-canonical-id","synthetic-operation","{\"amount_minor\":8000}",2000))
        NotificationDatabase.MIGRATION_13_14.migrate(db.openHelper.writableDatabase)
        assertEquals("synthetic-canonical-id",db.reconciliationDao().supersession("synthetic-account","synthetic-original-id")!!.canonicalTransactionId)
        assertEquals(8000L,db.paymentDao().localBookings("synthetic-account").single().amountMinor)
    }finally{db.close()};inspect(f,NotificationDatabase.SCHEMA_VERSION)}
    @Test fun closedDatabaseBackupAndMatchingOutboxRestoreToIndependentTarget(){val original=file();seed(original);val queueFile=File(context.cacheDir,"queue-${UUID.randomUUID()}");val queue=OfflineNotificationQueue(queueFile)
        queue.enqueue("synthetic-operation","{\"synthetic\":true}");val db=current(original);db.openHelper.writableDatabase;db.close()
        val restored=file();original.copyTo(restored);val restoredQueue=File(context.cacheDir,"queue-${UUID.randomUUID()}");queueFile.copyTo(restoredQueue)
        val copy=current(restored);try{assertEquals("synthetic-operation",copy.reconciliationDao().staged("synthetic-account").single().operationId)}finally{copy.close()}
        assertEquals(queue.peekRequests(),OfflineNotificationQueue(restoredQueue).peekRequests());assertEquals(1,queue.pendingCount());inspect(original,NotificationDatabase.SCHEMA_VERSION);inspect(restored,NotificationDatabase.SCHEMA_VERSION)
    }
}
