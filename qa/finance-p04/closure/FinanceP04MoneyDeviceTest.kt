package uk.thewyj.app.qa.finance
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.finance.CurrencyMoney
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.*
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class FinanceP04MoneyDeviceTest {
    private val c get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun sixCurrenciesSurviveActualAndroidRoomCloseAndReopen() {
        assertEquals("uk.thewyj.app.qa.financep04closure",c.packageName)
        val name="p04-six-units-${UUID.randomUUID()}.db"
        fun open()=Room.databaseBuilder(c,NotificationDatabase::class.java,name).allowMainThreadQueries().build()
        val owner="synthetic-p04-device-units"
        var db=open()
        val ids=mutableSetOf<String>()
        try {
            val store=RoomPaymentRecognitionStore(db)
            val coordinator=PaymentRecognitionCoordinator(store,currencyPolicyVersion=2,now={1000L})
            CurrencyMoney.digits.forEach{(currency,exponent)->
                val text=if(exponent==0)"1" else "0.01"
                val result=coordinator.onSourceEvent(owner,"com.tencent.mm",PaymentSourceType.NOTIFICATION,
                    "notification#event#synthetic-device-$currency","微信支付",
                    "支付成功 实付 $currency $text 交易号 SYNTH-DEVICE-$currency",uploadEventId="synthetic-device-$currency")
                assertEquals(PaymentRecognitionState.FINANCE_RECORDED,result.state)
                ids.add(store.localBookings(owner).single{it.currency==currency}.transactionId)
            }
            assertEquals(6,ids.size)
        } finally {db.close()}
        db=open()
        try {
            val rows=RoomPaymentRecognitionStore(db).localBookings(owner)
            assertEquals(6,rows.size)
            assertEquals(CurrencyMoney.digits.keys,rows.map{it.currency}.toSet())
            assertTrue(rows.all{it.amountMinor==1L})
            assertEquals(ids,rows.map{it.transactionId}.toSet())
            assertEquals(16,db.openHelper.writableDatabase.version)
        } finally {db.close()}
        FinanceDeviceSupport.record(c,"DEVICE-P04-SIX-ROOM",JSONObject().put("currencies",6).put("minor_each",1).put("ids_preserved",true).put("schema",16))
    }
    @Test fun preciseJpyAndTwoDecimalUnitsRejectOverprecision() {
        assertEquals(1L,CurrencyMoney.parse("1","JPY"))
        CurrencyMoney.digits.keys.filter{it!="JPY"}.forEach{
            assertEquals(1L,CurrencyMoney.parse("0.01",it))
            assertThrows(IllegalArgumentException::class.java){CurrencyMoney.parse("1.239",it)}
        }
        assertThrows(IllegalArgumentException::class.java){CurrencyMoney.parse("1.1","JPY")}
        assertThrows(IllegalArgumentException::class.java){CurrencyMoney.parse("1","XXX")}
        assertEquals(-1L,CurrencyMoney.parse("-0.01","CNY"))
        assertEquals(0L,CurrencyMoney.parse("0","JPY"))
    }
    @Test fun referenceRoundingAndCrossRateStayExactOnDevice() {
        assertEquals(0L,CurrencyMoney.convert(1,"USD","CNY","0.5"))
        assertEquals(2L,CurrencyMoney.convert(3,"USD","CNY","0.5"))
        assertEquals(-2L,CurrencyMoney.convert(-3,"USD","CNY","0.5"))
        assertEquals(1L,CurrencyMoney.convert(1,"JPY","CNY","0.01"))
        assertEquals(70000L,CurrencyMoney.cross(10000,"USD","CNY","1","7"))
        assertThrows(IllegalArgumentException::class.java){CurrencyMoney.convert(1,"USD","CNY","0")}
        assertThrows(IllegalArgumentException::class.java){CurrencyMoney.convert(1,"USD","CNY","NaN")}
    }
}
