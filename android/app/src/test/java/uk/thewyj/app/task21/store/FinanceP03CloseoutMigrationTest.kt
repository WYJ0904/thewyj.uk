package uk.thewyj.app.task21.store

import android.app.Application
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.NotificationOfflineQueue
import uk.thewyj.app.task21.payment.PaymentRecognitionCoordinator
import uk.thewyj.app.task21.payment.PaymentSourceType

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FinanceP03CloseoutMigrationTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val owner = "synthetic-closeout-migration"
    private fun file(tag: String): File {
        val id=UUID.randomUUID().toString().take(8)
        val result=File(context.cacheDir, "s-$tag-$id.db")
        println("QA_SQLITE_PATH_LENGTH short=${result.absolutePath.length} priorLong=${File(context.cacheDir, "synthetic-$tag-${UUID.randomUUID()}.db").absolutePath.length}")
        return result
    }
    private fun old(file: File) = Room.databaseBuilder(context, CloseoutV11Database::class.java, file.absolutePath).allowMainThreadQueries().build()
    private fun current(file: File, migration: Migration = NotificationDatabase.MIGRATION_11_12) =
        Room.databaseBuilder(context, NotificationDatabase::class.java, file.absolutePath).addMigrations(migration, NotificationDatabase.MIGRATION_12_13).allowMainThreadQueries().build()
    private inline fun <T : androidx.room.RoomDatabase, R> T.closed(block: (T) -> R): R = try { block(this) } finally { close() }
    private fun seed(file: File) {
        old(file).closed { db ->
            db.openHelper.writableDatabase.execSQL("INSERT INTO payment_recognitions (recognitionId,accountId,state,notificationId,sourcePackage,sourceType,sourceEventId,uploadEventId,paymentChannel,amountMinor,hasAmount,currency,direction,merchant,providerReference,createdAtMs,updatedAtMs,completionConfirmed,sourceUid) VALUES ('synthetic-old-rec','$owner','FINANCE_RECORDED',7,'com.tencent.mm','NOTIFICATION','synthetic-old-source','synthetic-old-event','wechat',3400,1,'CNY','EXPENSE','synthetic','SYNTH-OLD-REFERENCE',1000,1000,1,-1)")
            db.openHelper.writableDatabase.execSQL("INSERT INTO local_payment_bookings (accountId,eventId,recognitionId,transactionId,amountMinor,direction,currency,merchant,occurredAtMs,sourcePackage,paymentChannel,providerReference,syncState,createdAtMs) VALUES ('$owner','synthetic-old-event','synthetic-old-rec','synthetic-old-transaction',3400,'EXPENSE','CNY','synthetic',1000,'com.tencent.mm','wechat','SYNTH-OLD-REFERENCE','pending',1000)")
        }
    }
    private fun inspect(file: File, version: Int, count: Int = 1) {
        SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { db ->
            assertEquals(version, db.version)
            db.rawQuery("SELECT transactionId,amountMinor,currency FROM local_payment_bookings WHERE eventId='synthetic-old-event'", null).use {
                assertTrue(it.moveToFirst());assertEquals("synthetic-old-transaction",it.getString(0));assertEquals(3400L,it.getLong(1));assertEquals("CNY",it.getString(2)) }
            db.rawQuery("SELECT COUNT(*) FROM local_payment_bookings",null).use { assertTrue(it.moveToFirst());assertEquals(count,it.getInt(0)) }
        }
    }
    @Test fun realV11UpgradeRetainsAllOldIdsAndDefaultsWithoutInventingEvidence() {
        val file=file("upgrade");seed(file)
        current(file).closed { db ->
            val r=RoomPaymentRecognitionStore(db).recognition(owner,"synthetic-old-rec")!!
            assertEquals("",r.lifecycleOperation);assertEquals(0L,r.lifecycleRevision)
            assertEquals("SYNTH-OLD-REFERENCE",r.providerReference)
        }
        inspect(file,13)
    }
    @Test fun actualV11RoomOpenerFailsClosedOnV12WithoutDeletingData() {
        val file=file("downgrade");seed(file);current(file).closed { it.openHelper.writableDatabase }
        val old=old(file)
        try {
            try { old.openHelper.writableDatabase;fail("v11 must not open v12") }
            catch(e:IllegalStateException) { assertTrue(e.message.orEmpty().contains("13")&&e.message.orEmpty().contains("11")) }
        } finally { old.close() }
        inspect(file,13)
        current(file).closed { assertEquals(1,RoomPaymentRecognitionStore(it).localBookings(owner).size) }
    }
    @Test fun interruptedUpgradeRollsBackAndCanRetryWithTheSameOutbox() {
        val file=file("interrupted");seed(file)
        val queueDir=File(context.cacheDir,"synthetic-queue-${UUID.randomUUID()}")
        val queue=NotificationOfflineQueue.inDirectory(queueDir,owner)
        queue.enqueueRequest("synthetic-old-event","/api/notification/ingest","{\"synthetic\":true}")
        val before=queue.peekRequests()
        val fault=object:Migration(11,12) { override fun migrate(db:SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE payment_recognitions ADD COLUMN synthetic_probe TEXT NOT NULL DEFAULT ''")
            error("SYNTHETIC_CLOSEOUT_INTERRUPTION")
        } }
        val db=current(file,fault)
        try {
            try { db.openHelper.writableDatabase;fail("injected fault must fail") }
            catch(e:IllegalStateException) { assertTrue(e.message.orEmpty().contains("SYNTHETIC_CLOSEOUT_INTERRUPTION")) }
        } finally { db.close() }
        inspect(file,11)
        SQLiteDatabase.openDatabase(file.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use { raw ->
            raw.rawQuery("PRAGMA table_info(payment_recognitions)",null).use { while(it.moveToNext())assertNotEquals("synthetic_probe",it.getString(1)) }
        }
        current(file).closed { it.openHelper.writableDatabase }
        inspect(file,13)
        assertEquals(before,NotificationOfflineQueue.inDirectory(queueDir,owner).peekRequests())
    }
    @Test fun repeatedMigrationFailsAtomicallyAndNormalReopenNeverRerunsIt() {
        val file=file("repeat");seed(file);current(file).closed { db ->
            val raw=db.openHelper.writableDatabase
            raw.beginTransaction()
            try {
                try { NotificationDatabase.MIGRATION_11_12.migrate(raw);fail("raw DDL replay must be refused") }
                catch(e:android.database.sqlite.SQLiteException) { assertTrue(e.message.orEmpty().contains("duplicate column")) }
            } finally { raw.endTransaction() }
        }
        inspect(file,13)
        current(file).closed { assertEquals(1,RoomPaymentRecognitionStore(it).localBookings(owner).size) }
    }
    @Test fun closedSnapshotsRestoreV11AndV12SeparatelyAndKeepNewWritesFenced() {
        val active=file("active");seed(active)
        fun queueDir()=File(context.cacheDir,"q${UUID.randomUUID().toString().take(8)}")
        fun queueHashes(dir:File)=dir.walkTopDown().filter{it.isFile}.associate{it.relativeTo(dir).path to
            java.util.Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(it.readBytes()))}
        val activeQueue=queueDir()
        val queue=NotificationOfflineQueue.inDirectory(activeQueue,owner)
        queue.enqueueRequest("synthetic-old-event","/api/notification/ingest","{\"synthetic\":true}")
        val queueV11=queueDir();assertTrue(activeQueue.copyRecursively(queueV11))
        val oldBackup=file("v11-snapshot");active.copyTo(oldBackup)
        val oldHash=MessageDigest.getInstance("SHA-256").digest(oldBackup.readBytes())
        current(active).closed { db ->
            PaymentRecognitionCoordinator(RoomPaymentRecognitionStore(db)).onSourceEvent(owner,"com.tencent.mm",PaymentSourceType.NOTIFICATION,
                "synthetic-new-event","微信支付","支付成功 CNY 28.00 交易号 SYNTH-NEW-REFERENCE")
            val newEvent=RoomPaymentRecognitionStore(db).localBookings(owner).single{it.eventId!="synthetic-old-event"}.eventId
            queue.enqueueRequest(newEvent,"/api/notification/ingest","{\"synthetic\":true}")
        }
        inspect(active,13,2)
        val newBackup=file("v12-snapshot");active.copyTo(newBackup)
        val queueV12=queueDir();assertTrue(activeQueue.copyRecursively(queueV12))
        val restoredOld=file("old-restored");oldBackup.copyTo(restoredOld)
        assertArrayEquals(oldHash,MessageDigest.getInstance("SHA-256").digest(restoredOld.readBytes()))
        old(restoredOld).closed { assertEquals(11,it.openHelper.writableDatabase.version) }
        inspect(restoredOld,11,1) // Snapshot predates the new write: never call this a lossless downgrade.
        val oldQueueRestored=queueDir();assertTrue(queueV11.copyRecursively(oldQueueRestored))
        assertEquals(queueHashes(queueV11),queueHashes(oldQueueRestored))
        assertEquals(1,NotificationOfflineQueue.inDirectory(oldQueueRestored,owner).peekRequests().size)
        val restoredNew=file("new-restored");newBackup.copyTo(restoredNew)
        current(restoredNew).closed { assertEquals(2,RoomPaymentRecognitionStore(it).localBookings(owner).size) }
        val newQueueRestored=queueDir();assertTrue(queueV12.copyRecursively(newQueueRestored))
        assertEquals(queueHashes(queueV12),queueHashes(newQueueRestored))
        assertEquals(queue.peekRequests(),NotificationOfflineQueue.inDirectory(newQueueRestored,owner).peekRequests())
        assertEquals(2,NotificationOfflineQueue.inDirectory(newQueueRestored,owner).peekRequests().size)
        inspect(restoredNew,13,2);inspect(active,13,2)
    }
}
