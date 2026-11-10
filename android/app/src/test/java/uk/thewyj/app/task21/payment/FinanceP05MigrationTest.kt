package uk.thewyj.app.task21.payment

import android.app.Application
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceP05MigrationTest {
    private fun legacy(name:String) {
        val context=RuntimeEnvironment.getApplication();context.deleteDatabase(name)
        val candidates=generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }.take(7)
            .flatMap { dir->listOf(File(dir,"schemas/uk.thewyj.app.task21.store.NotificationDatabase/16.json"),
                File(dir,"app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/16.json"),
                File(dir,"android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/16.json")).asSequence() }
        val schema=JSONObject(candidates.first { it.isFile }.readText()).getJSONObject("database")
        context.getDatabasePath(name).parentFile!!.mkdirs()
        val db=SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name),null)
        try {
            val entities=schema.getJSONArray("entities")
            for(i in 0 until entities.length()) {
                val entity=entities.getJSONObject(i);val table=entity.getString("tableName")
                db.execSQL(entity.getString("createSql").replace("\${TABLE_NAME}",table))
                val indices=entity.optJSONArray("indices") ?: org.json.JSONArray()
                for(j in 0 until indices.length())db.execSQL(indices.getJSONObject(j).getString("createSql").replace("\${TABLE_NAME}",table))
            }
            val setup=schema.getJSONArray("setupQueries");for(i in 0 until setup.length())db.execSQL(setup.getString(i))
            db.execSQL("INSERT INTO payment_tickets VALUES('legacy-ticket','owner','rec','com.tencent.mm','event','wechat',100,1,'currency','ENRICHED',1,1000,91000,100,1,'EXPENSE','','SYNTH-OLD',1000)")
            db.version=16
        } finally {db.close()}
    }
    private fun open(name:String,migration:Migration=NotificationDatabase.MIGRATION_16_17)=
        Room.databaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java,name)
            .addMigrations(migration).allowMainThreadQueries().build()

    @Test fun migrationPreservesOldIdsAndNeverInventsLostCurrencyOrCompletionProof() {
        val name="p05-migration.db";legacy(name)
        repeat(2) {
            val db=open(name)
            try {
                assertEquals(NotificationDatabase.SCHEMA_VERSION,db.openHelper.writableDatabase.version)
                val restored=RoomPaymentRecognitionStore(db).ticket("owner","legacy-ticket")!!
                assertEquals("event",restored.sourceEventId);assertEquals(100L,restored.enrichment!!.amountMinor)
                assertNull(restored.enrichment!!.currency);assertFalse(restored.enrichment!!.completionConfirmed)
                assertTrue(restored.enrichment!!.sourceInstanceUncertain);assertEquals(91000L,restored.expiresAtMs)
                assertEquals(PaymentPageRetry.MAX_ATTEMPTS,restored.scanAttempts)
            } finally {db.close()}
        }
        RuntimeEnvironment.getApplication().deleteDatabase(name)
    }
    @Test fun interruptedMigrationRollsBackAndCanRetryWithoutClearingData() {
        val name="p05-interrupted.db";legacy(name)
        val failing=object:Migration(16,17){override fun migrate(db:SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE payment_tickets ADD COLUMN enrichedCurrency TEXT NOT NULL DEFAULT ''")
            error("SYNTHETIC_MIGRATION_INTERRUPTION")
        }}
        val broken=open(name,failing)
        try { assertTrue(runCatching { broken.openHelper.writableDatabase }.isFailure) } finally {broken.close()}
        val recovered=open(name)
        try {assertNotNull(RoomPaymentRecognitionStore(recovered).ticket("owner","legacy-ticket"))}finally {recovered.close()}
        RuntimeEnvironment.getApplication().deleteDatabase(name)
    }
    @Test fun oldVersionOpenerFailsClosedAfterUpgrade() {
        val name="p05-downgrade.db";legacy(name);val upgraded=open(name);upgraded.openHelper.writableDatabase;upgraded.close()
        val old=object:SQLiteOpenHelper(RuntimeEnvironment.getApplication(),name,null,16){
            override fun onCreate(db:SQLiteDatabase) {error("Existing database must be preserved")}
            override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int) {error("No destructive upgrade")}
        }
        try {assertTrue(runCatching {old.writableDatabase}.isFailure)}finally {old.close();RuntimeEnvironment.getApplication().deleteDatabase(name)}
    }
}
