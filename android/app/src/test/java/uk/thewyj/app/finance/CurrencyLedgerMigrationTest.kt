package uk.thewyj.app.finance

import android.app.Application
import android.database.sqlite.SQLiteDatabase
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.store.LocalPaymentBookingEntity
import uk.thewyj.app.task21.store.NotificationDatabase
import java.io.File
import java.util.UUID

@Database(entities = [LocalPaymentBookingEntity::class], version = 14, exportSchema = false)
abstract class OldCurrencyRoom14 : RoomDatabase()

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class CurrencyLedgerMigrationTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun seed(): File {
        val file = File(context.cacheDir, "synthetic-p04-room-${UUID.randomUUID()}.db")
        val schema = JSONObject(File("schemas/uk.thewyj.app.task21.store.NotificationDatabase/14.json").readText()).getJSONObject("database")
        val db = SQLiteDatabase.openOrCreateDatabase(file, null)
        try {
            val entities = schema.getJSONArray("entities")
            for (index in 0 until entities.length()) {
                val entity = entities.getJSONObject(index); val name = entity.getString("tableName")
                db.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}", name))
                val indices = entity.optJSONArray("indices") ?: org.json.JSONArray()
                for (i in 0 until indices.length()) db.execSQL(indices.getJSONObject(i).getString("createSql").replace("\${TABLE_NAME}", name))
            }
            val setup = schema.getJSONArray("setupQueries"); for (i in 0 until setup.length()) db.execSQL(setup.getString(i))
            for ((event,currency,amount) in listOf(Triple("synthetic-cny","CNY",64800),Triple("synthetic-jpy","JPY",12345)))
                db.execSQL("INSERT INTO local_payment_bookings VALUES(?,?,? ,?,?, 'EXPENSE',?,'synthetic',1000,'cmb.pb','bank_card','SYNTH-P04','pending',1000)", arrayOf<Any?>("synthetic-owner",event,"synthetic-rec-$event","synthetic-tx-$event",amount,currency))
            db.version = 14
        } finally { db.close() }
        return file
    }
    private fun current(file: File, migration: Migration = NotificationDatabase.MIGRATION_14_15) = Room.databaseBuilder(context,NotificationDatabase::class.java,file.absolutePath)
        .addMigrations(migration).allowMainThreadQueries().build()
    @Test fun upgradePreservesMoneyAndSeparatesUnprovenLegacyJpyUnits() {
        val file = seed(); val db = current(file)
        try {
            assertEquals(NotificationDatabase.SCHEMA_VERSION,db.openHelper.writableDatabase.version)
            val cny=db.paymentDao().localBooking("synthetic-owner","synthetic-cny")!!
            assertEquals(64800L,cny.amountMinor);assertEquals("synthetic-tx-synthetic-cny",cny.transactionId)
            val jpy=db.paymentDao().localBooking("synthetic-owner","synthetic-jpy")!!;assertEquals(12345L,jpy.amountMinor)
            assertEquals(2,CurrencyLedgerUnits.read(db.openHelper.readableDatabase,cny.accountId,cny.eventId,cny.currency))
            assertNull(CurrencyLedgerUnits.read(db.openHelper.readableDatabase,jpy.accountId,jpy.eventId,jpy.currency))
            NotificationDatabase.MIGRATION_14_15.migrate(db.openHelper.writableDatabase)
            assertEquals(2,db.paymentDao().localBookings("synthetic-owner").size)
        } finally { db.close() }
    }
    @Test fun interruptedUpgradeRollsBackAndRetriesWithoutLosingOriginalRows() {
        val file=seed()
        val broken=object:Migration(14,15){override fun migrate(db:SupportSQLiteDatabase){NotificationDatabase.MIGRATION_14_15.migrate(db);db.execSQL("INSERT INTO synthetic_missing_table VALUES(1)")}}
        val first=current(file,broken);try{assertThrows(Exception::class.java){first.openHelper.writableDatabase}}finally{first.close()}
        val raw=SQLiteDatabase.openDatabase(file.absolutePath,null,SQLiteDatabase.OPEN_READONLY);try{assertEquals(14,raw.version);raw.rawQuery("SELECT amountMinor FROM local_payment_bookings WHERE eventId='synthetic-jpy'",null).use{assertTrue(it.moveToFirst());assertEquals(12345L,it.getLong(0))}}finally{raw.close()}
        val retry=current(file);try{assertEquals(NotificationDatabase.SCHEMA_VERSION,retry.openHelper.writableDatabase.version);assertEquals(2,retry.paymentDao().localBookings("synthetic-owner").size)}finally{retry.close()}
    }
    @Test fun oldVersionCannotDowngradeOrClearTheNewLedger() {
        val file=seed();current(file).let{it.openHelper.writableDatabase;it.close()}
        val old=Room.databaseBuilder(context,OldCurrencyRoom14::class.java,file.absolutePath).allowMainThreadQueries().build()
        try{val error=assertThrows(IllegalStateException::class.java){old.openHelper.writableDatabase};assertTrue(error.message.orEmpty().contains("${NotificationDatabase.SCHEMA_VERSION} to 14"))}finally{old.close()}
        val reopened=current(file);try{assertEquals(2,reopened.paymentDao().localBookings("synthetic-owner").size)}finally{reopened.close()}
    }
}
