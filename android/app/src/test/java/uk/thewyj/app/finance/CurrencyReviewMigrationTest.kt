package uk.thewyj.app.finance

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
import uk.thewyj.app.task21.store.LocalPaymentBookingEntity
import uk.thewyj.app.task21.store.NotificationDatabase
import java.io.File
import java.util.UUID

@Database(entities=[LocalPaymentBookingEntity::class],version=15,exportSchema=false)
abstract class CurrencyOldRoom15:RoomDatabase()

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class CurrencyReviewMigrationTest {
    private val context get()=RuntimeEnvironment.getApplication()
    private fun file()=File(context.cacheDir,"r-${UUID.randomUUID().toString().take(8)}.db")
    private fun seed(file:File){FrozenRoomFixture.create(file,15).use{db ->
        db.execSQL("INSERT INTO local_payment_bookings VALUES('synthetic-owner','synthetic-event','synthetic-rec','synthetic-original-id',8000,'EXPENSE','USD','synthetic',1000,'cmb.pb','bank_card','SYNTH-CAPTURE','pending',1000)")
        db.execSQL("INSERT INTO payment_reconciliations VALUES('synthetic-owner','synthetic-operation','digest','{}','staged','','{}','{}',1000,1000)")
    }}
    private fun current(file:File,migration:Migration=NotificationDatabase.MIGRATION_15_16)=Room.databaseBuilder(context,NotificationDatabase::class.java,file.absolutePath).addMigrations(migration).allowMainThreadQueries().build()
    private fun verify(file:File,version:Int){SQLiteDatabase.openDatabase(file.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use{db->
        assertEquals(version,db.version)
        db.rawQuery("PRAGMA integrity_check",null).use{assertTrue(it.moveToFirst());assertEquals("ok",it.getString(0))}
        db.rawQuery("SELECT transactionId,amountMinor,currency FROM local_payment_bookings",null).use{assertTrue(it.moveToFirst());assertEquals("synthetic-original-id",it.getString(0));assertEquals(8000L,it.getLong(1));assertEquals("USD",it.getString(2));assertFalse(it.moveToNext())}
    }}
    @Test fun historicalFifteenUpgradesWithoutInventingReviewOrChangingReceipts(){val f=file();seed(f)
        repeat(2){val db=current(f);try{
            assertEquals(16,db.openHelper.writableDatabase.version)
            assertEquals("synthetic-operation",db.reconciliationDao().staged("synthetic-owner").single().operationId)
            db.openHelper.readableDatabase.query("SELECT COUNT(*) FROM payment_recognitions WHERE currencyReviewRequired<>0 OR currencyReviewNotified<>0 OR currencyDecisionSource<>''").use{assertTrue(it.moveToFirst());assertEquals(0,it.getInt(0))}
        }finally{db.close()}}
        verify(f,16)
    }
    @Test fun interruptedReviewUpgradeRollsBackAndRetriesWithOriginalRows(){val f=file();seed(f)
        val broken=object:Migration(15,16){override fun migrate(db:SupportSQLiteDatabase){NotificationDatabase.MIGRATION_15_16.migrate(db);db.execSQL("INSERT INTO synthetic_missing_review_table VALUES(1)")}}
        val first=current(f,broken);try{assertThrows(Exception::class.java){first.openHelper.writableDatabase}}finally{first.close()}
        verify(f,15)
        SQLiteDatabase.openDatabase(f.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use{db->db.rawQuery("PRAGMA table_info(payment_recognitions)",null).use{c->while(c.moveToNext())assertNotEquals("currencyReviewRequired",c.getString(1))}}
        val retry=current(f);try{retry.openHelper.writableDatabase}finally{retry.close()};verify(f,16)
    }
    @Test fun closedBackupAndOutboxRestoreAndOldVersionRefusesDowngrade(){val f=file();seed(f)
        val db=current(f);try{db.openHelper.writableDatabase}finally{db.close()}
        val outbox=File(context.cacheDir,"q-${UUID.randomUUID().toString().take(8)}")
        val queue=OfflineNotificationQueue(outbox);queue.enqueue("synthetic-operation","{\"synthetic\":true}")
        val restored=file();f.copyTo(restored);val copied=File(context.cacheDir,"q-${UUID.randomUUID().toString().take(8)}");outbox.copyTo(copied)
        val reopened=current(restored);try{assertEquals("synthetic-operation",reopened.reconciliationDao().staged("synthetic-owner").single().operationId)}finally{reopened.close()}
        assertEquals(queue.peekRequests(),OfflineNotificationQueue(copied).peekRequests())
        val old=Room.databaseBuilder(context,CurrencyOldRoom15::class.java,f.absolutePath).allowMainThreadQueries().build()
        try{val error=assertThrows(IllegalStateException::class.java){old.openHelper.writableDatabase};assertTrue(error.message.orEmpty().contains("16 to 15"))}finally{old.close()}
        verify(f,16);verify(restored,16)
    }
}
