package uk.thewyj.app.finance

import android.app.Application
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import java.io.File
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.*

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class CurrencyCloseoutHistoryTest {
    private val context get()=RuntimeEnvironment.getApplication()
    private fun seed(file:File,currency:String){
        val schema=JSONObject(File("schemas/uk.thewyj.app.task21.store.NotificationDatabase/14.json").readText()).getJSONObject("database")
        FrozenRoomFixture.create(file,14).use {db->
            fun insert(table:String,values:Map<String,Any?>){
                val entities=schema.getJSONArray("entities");val entity=(0 until entities.length()).map(entities::getJSONObject).single{it.getString("tableName")==table}
                val fields=entity.getJSONArray("fields");val names=(0 until fields.length()).map{fields.getJSONObject(it).getString("columnName")}
                assertTrue(values.keys.toString(),names.containsAll(values.keys))
                val args=(0 until fields.length()).map{i->val field=fields.getJSONObject(i);val name=field.getString("columnName")
                    if(name in values)values[name] else if(!field.getBoolean("notNull"))null else if(field.getString("affinity")=="TEXT")"" else 0L}
                db.execSQL("INSERT INTO $table("+names.joinToString(",")+") VALUES("+names.joinToString(","){"?"}+")",args.toTypedArray())
            }
            insert("payment_recognitions",mapOf("recognitionId" to "legacy-rec","accountId" to "synthetic-history","state" to "FINANCE_RECORDED",
                "notificationId" to 7,"sourcePackage" to "com.tencent.mm","sourceType" to "NOTIFICATION","sourceEventId" to "notification#event#legacy-event",
                "uploadEventId" to "legacy-event","paymentChannel" to "wechat","amountMinor" to 10000L,"hasAmount" to 1,"currency" to currency,
                "direction" to "EXPENSE","providerReference" to "SYNTH-LEGACY-RECEIPT","createdAtMs" to 1000L,"updatedAtMs" to 1000L,
                "completionConfirmed" to 1,"referenceNamespace" to "wechat"))
            insert("local_payment_bookings",mapOf("accountId" to "synthetic-history","eventId" to "legacy-event","recognitionId" to "legacy-rec",
                "transactionId" to "synthetic-original-ledger-id","amountMinor" to 10000L,"direction" to "EXPENSE","currency" to currency,
                "occurredAtMs" to 1000L,"sourcePackage" to "com.tencent.mm","paymentChannel" to "wechat","providerReference" to "SYNTH-LEGACY-RECEIPT",
                "syncState" to "synced","createdAtMs" to 1000L))
            assertEquals(14,db.version)
            db.rawQuery("PRAGMA table_info(payment_recognitions)",null).use{c->while(c.moveToNext())assertNotEquals("currencyDecisionSource",c.getString(1))}
        }
    }
    private fun open(file:File)=Room.databaseBuilder(context,NotificationDatabase::class.java,file.absolutePath)
        .addMigrations(NotificationDatabase.MIGRATION_15_16,NotificationDatabase.MIGRATION_16_17,NotificationDatabase.MIGRATION_17_18).allowMainThreadQueries().build()
    @Test fun genuineFourteenCurrencyFactsSurviveUpgradeDefaultChangeAndColdReplay(){
        val file=File(context.cacheDir,"history-${UUID.randomUUID()}.sqlite");seed(file,"CNY")
        repeat(2){val db=open(file);try{val store=RoomPaymentRecognitionStore(db);assertEquals(18,db.openHelper.writableDatabase.version)
            val original=store.localBookings("synthetic-history").single();assertEquals(2,original.amountExponent)
            val c=PaymentRecognitionCoordinator(store,defaultCurrency={"JPY"},currencyPolicyVersion=2,now={1000L})
            c.onSourceEvent("synthetic-history","com.tencent.mm",PaymentSourceType.NOTIFICATION,"notification#event#legacy-event",
                "微信支付","支付成功 实付 ¥100.00 交易号 SYNTH-LEGACY-RECEIPT",uploadEventId="legacy-event")
            assertEquals(listOf(original),store.localBookings("synthetic-history"));assertEquals("",store.recognition("synthetic-history","legacy-rec")!!.identityReviewReason)
            assertEquals("synthetic-original-ledger-id",original.transactionId);assertEquals(1000L,original.occurredAtMs)
        }finally{db.close()}}
    }
    @Test fun genuineLegacyJpyWithoutExponentStaysUnreinterpreted(){
        val file=File(context.cacheDir,"history-${UUID.randomUUID()}.sqlite");seed(file,"JPY")
        val db=open(file);try{val row=RoomPaymentRecognitionStore(db).localBookings("synthetic-history").single()
            assertEquals("JPY",row.currency);assertEquals(10000L,row.amountMinor);assertNull(row.amountExponent)
            assertEquals("synthetic-original-ledger-id",row.transactionId)
        }finally{db.close()}
        SQLiteDatabase.openDatabase(file.absolutePath,null,SQLiteDatabase.OPEN_READONLY).use{db->
            db.rawQuery("PRAGMA integrity_check",null).use{assertTrue(it.moveToFirst());assertEquals("ok",it.getString(0))}}
    }
}
