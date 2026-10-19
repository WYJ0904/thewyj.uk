package uk.thewyj.app.task21.store

import android.app.Application
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.NotificationOfflineQueue
import uk.thewyj.app.task21.payment.*

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FinanceP03PersistenceTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private fun oldFile(): File {
        val file = File(context.cacheDir, "synthetic-p03-old-${UUID.randomUUID()}.db")
        val schema = JSONObject(File("schemas/uk.thewyj.app.task21.store.NotificationDatabase/10.json").readText()).getJSONObject("database")
        SQLiteDatabase.openOrCreateDatabase(file, null).use { db ->
            val entities = schema.getJSONArray("entities")
            for (i in 0 until entities.length()) {
                val entity = entities.getJSONObject(i)
                db.execSQL(entity.getString("createSql").replace("${'$'}{TABLE_NAME}", entity.getString("tableName")))
                val indices = entity.optJSONArray("indices") ?: org.json.JSONArray()
                for (j in 0 until indices.length()) db.execSQL(indices.getJSONObject(j).getString("createSql").replace("${'$'}{TABLE_NAME}", entity.getString("tableName")))
            }
            db.execSQL("CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)")
            db.execSQL("INSERT INTO room_master_table (id,identity_hash) VALUES(42,?)", arrayOf(schema.getString("identityHash")))
            db.execSQL("INSERT INTO payment_recognitions (recognitionId,accountId,state,notificationId,sourcePackage,sourceType,sourceEventId,uploadEventId,paymentChannel,amountMinor,hasAmount,currency,direction,merchant,providerReference,createdAtMs,updatedAtMs,completionConfirmed,sourceUid) VALUES ('synthetic-p03-old-rec','synthetic-p03-old-owner','FINANCE_RECORDED',7,'com.tencent.mm','NOTIFICATION','notification#event#synthetic-p03-old-event','synthetic-p03-old-event','wechat',64800,1,'CNY','EXPENSE','synthetic merchant','SYNTH-OLD-REF',1000,1000,1,-1)")
            db.execSQL("INSERT INTO local_payment_bookings (accountId,eventId,recognitionId,transactionId,amountMinor,direction,currency,merchant,occurredAtMs,sourcePackage,paymentChannel,providerReference,syncState,createdAtMs) VALUES ('synthetic-p03-old-owner','synthetic-p03-old-event','synthetic-p03-old-rec','synthetic-p03-old-transaction',64800,'EXPENSE','CNY','synthetic merchant',1000,'com.tencent.mm','wechat','SYNTH-OLD-REF','pending',1000)")
            db.version = 10
        }
        return file
    }
    @Test fun additiveV10UpgradeKeepsOldIdsCurrencyAndOutboxThenReplaysOneBooking() {
        val file = oldFile()
        val queueDir = File(context.cacheDir, "synthetic-p03-queue-${UUID.randomUUID()}")
        val queue = NotificationOfflineQueue.inDirectory(queueDir, "synthetic-p03-old-owner")
        repeat(3) { queue.enqueueRequest("synthetic-p03-old-event", "/api/notification/ingest", "{\"synthetic\":true}") }
        val db = Room.databaseBuilder(context, NotificationDatabase::class.java, file.absolutePath)
            .addMigrations(NotificationDatabase.MIGRATION_10_11, NotificationDatabase.MIGRATION_11_12).allowMainThreadQueries().build()
        try {
            val store = RoomPaymentRecognitionStore(db)
            val old = store.recognition("synthetic-p03-old-owner", "synthetic-p03-old-rec")!!
            assertEquals("", old.identityReviewReason)
            assertEquals("", old.financialPhase)
            assertEquals("CNY", old.currency)
            val c = PaymentRecognitionCoordinator(store, now = { 1000L })
            repeat(30) { c.onSourceEvent(old.accountId, "com.tencent.mm", PaymentSourceType.NOTIFICATION,
                "synthetic-new-alias-$it", "微信支付", "支付成功 实付¥648.00 交易号 SYNTH-OLD-REF") }
            val bookings = store.localBookings(old.accountId)
            assertEquals(1, bookings.size)
            assertEquals("synthetic-p03-old-transaction", bookings.single().transactionId)
            assertEquals("synthetic-p03-old-event", bookings.single().eventId)
            assertEquals(64800L, bookings.single().amountMinor)
            assertEquals(1, NotificationOfflineQueue.inDirectory(queueDir, old.accountId).peekRequests().size)
        } finally { db.close() }
    }
    @Test fun failedMigrationRollsBackDdlAndPreservesOriginalV10Rows() {
        val file = oldFile()
        val failing = object : Migration(10, 11) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE payment_recognitions ADD COLUMN synthetic_failure_probe TEXT NOT NULL DEFAULT ''")
                error("SYNTHETIC_MIGRATION_FAILURE")
            }
        }
        val db = Room.databaseBuilder(context, NotificationDatabase::class.java, file.absolutePath)
            .addMigrations(failing, NotificationDatabase.MIGRATION_11_12).allowMainThreadQueries().build()
        try {
            try { db.openHelper.writableDatabase; fail("migration must fail") } catch (e: IllegalStateException) {
                assertTrue(e.message.orEmpty().contains("SYNTHETIC_MIGRATION_FAILURE")) }
        } finally { db.close() }
        SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READWRITE).use { old ->
            assertEquals(10, old.version)
            old.rawQuery("SELECT transactionId,amountMinor FROM local_payment_bookings", null).use {
                assertTrue(it.moveToFirst());assertEquals("synthetic-p03-old-transaction", it.getString(0));assertEquals(64800L, it.getLong(1)) }
            old.rawQuery("PRAGMA table_info(payment_recognitions)", null).use { columns ->
                while (columns.moveToNext()) assertNotEquals("synthetic_failure_probe", columns.getString(1)) }
        }
    }
    @Test fun concurrentReferenceAliasesUseOneAtomicRecognitionAndLedger() {
        val db = Room.inMemoryDatabaseBuilder(context, NotificationDatabase::class.java).allowMainThreadQueries().build()
        val pool = Executors.newFixedThreadPool(6)
        try {
            val store = RoomPaymentRecognitionStore(db)
            val jobs = (0 until 30).map { i -> pool.submit {
                PaymentRecognitionCoordinator(store, now = { 1000L }).onSourceEvent("synthetic-concurrent-owner", "com.tencent.mm",
                    PaymentSourceType.NOTIFICATION, "synthetic-concurrent-event-$i", "微信支付", "支付成功¥648.00 交易号 SYNTH-CONCURRENT-REF") } }
            jobs.forEach { it.get(30, java.util.concurrent.TimeUnit.SECONDS) }
            assertEquals(1, store.localBookings("synthetic-concurrent-owner").size)
            assertEquals(1, db.paymentDao().recognitionCount("synthetic-concurrent-owner"))
        } finally { pool.shutdownNow();db.close() }
    }
}
