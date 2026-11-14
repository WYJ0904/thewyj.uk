package uk.thewyj.app.finance

import android.app.Application
import androidx.room.Room
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.payment.PaymentParserRegistry
import uk.thewyj.app.task21.payment.PaymentRecognitionCoordinator
import uk.thewyj.app.task21.payment.PaymentSourceType
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import java.io.File

/** Original fixtures and assertions; declared defaults are now explicitly forwarded. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class CurrencyFrozenDefaultsTest {
    @Test fun declaredDefaultsAndMixedRolesUseTheOriginalSixInputsAndExpectations() {
        val cases=JSONObject(File("../../qa/finance-p02/fixtures/matrix.json").readText()).getJSONArray("cases")
        val ids=setOf("D004","D008","D012","D016","D020","D024");val results=JSONArray()
        for(index in 0 until cases.length()){
            val fixture=cases.getJSONObject(index);val id=fixture.getString("case_id");if(id !in ids)continue
            val default=fixture.getString("default_currency");val pkg=fixture.getString("package")
            val type=if(pkg=="sms")PaymentSourceType.SMS else PaymentSourceType.NOTIFICATION
            val parsed=PaymentParserRegistry.parse(pkg,type,fixture.getString("title"),fixture.getString("text"),capturedAtMs=1000L,defaultCurrency=default,currencyPolicyVersion=2)
            val db=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java).allowMainThreadQueries().build()
            try{
                val store=RoomPaymentRecognitionStore(db)
                PaymentRecognitionCoordinator(store,now={1000L},defaultCurrency={default},currencyPolicyVersion=2).onSourceEvent("synthetic-p04-frozen-owner",pkg,type,"synthetic-p04-$id",fixture.getString("title"),fixture.getString("text"))
                val expected=fixture.getJSONObject("expected");val bookings=store.localBookings("synthetic-p04-frozen-owner")
                val actual=JSONObject().put("currency",parsed.currency).put("amount_minor",parsed.amountMinor).put("direction",parsed.direction?.name).put("records",bookings.size)
                results.put(JSONObject().put("case_id",id).put("fixture",fixture).put("actual",actual).put("driver","declared default forwarded; currency policy 2"))
                assertEquals(id,expected.getLong("amount_minor"),parsed.amountMinor);assertEquals(id,expected.getString("currency"),parsed.currency)
                assertEquals(id,expected.getString("direction"),parsed.direction?.name);assertEquals(id,expected.getInt("records"),bookings.size)
            }finally{db.close()}
        }
        assertEquals(6,results.length())
        val output=System.getenv("FINANCE_P04_OUTPUT")?.let(::File)
            ?: File("../../docs/migration-evidence/finance-p04/cloud/jvm-${System.currentTimeMillis()}")
        output.mkdirs()
        val evidence=File(output,"frozen-defaults-forwarded.json")
        check(evidence.createNewFile()) { "Preserve existing P04 evidence" }
        evidence.writeText(results.toString(2)+"\n")
    }
}
