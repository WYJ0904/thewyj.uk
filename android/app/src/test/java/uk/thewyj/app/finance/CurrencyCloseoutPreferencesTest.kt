package uk.thewyj.app.finance

import android.app.Application
import androidx.room.Room
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.IngestResponse
import uk.thewyj.app.task21.NotificationIngestTransport
import uk.thewyj.app.task21.FinanceDirection
import uk.thewyj.app.task21.payment.*

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class CurrencyCloseoutPreferencesTest {
    private val context get()=RuntimeEnvironment.getApplication()
    private lateinit var db:CurrencyReferenceDatabase
    private lateinit var repository:CurrencyReferenceRepository
    private val owner="synthetic-closeout-prefs"
    @Before fun setup(){db=Room.inMemoryDatabaseBuilder(context,CurrencyReferenceDatabase::class.java).allowMainThreadQueries().build();repository=CurrencyReferenceRepository(db)}
    @After fun close(){db.close();context.getSharedPreferences("wyj-currency-context",0).edit().clear().commit()}
    private fun response(default:String,revision:String)=object:NotificationIngestTransport {
        override fun post(path:String,sessionToken:String,body:String)=IngestResponse(false,503,"{}")
        override fun get(path:String,sessionToken:String)=IngestResponse(true,200,"""{"preferences":{"account_currency":"CNY","display_currency":"USD","default_currency":"$default","revision":$revision}}""")
    }
    @Test fun equalRevisionCannotRewritePersistedAccountCurrencyChoice(){
        assertTrue(repository.refreshPreferences(owner,"synthetic",response("USD","7"),context))
        assertFalse(repository.refreshPreferences(owner,"synthetic",response("JPY","7"),context))
        assertEquals("USD",db.currencies().preferences(owner)!!.defaultCurrency)
        assertEquals("USD",CurrencyRuntimePreferences.defaultCurrency(context,owner))
    }
    @Test fun negativeAndFractionalRevisionDoNotPublishAFalseDefault(){
        for(revision in listOf("-1","1.5")){
            assertFalse(revision,repository.refreshPreferences(owner,"synthetic",response("JPY",revision),context))
            assertNull(db.currencies().preferences(owner));assertNull(CurrencyRuntimePreferences.defaultCurrency(context,owner))
        }
    }
    @Test fun explicitUnknownUnitCannotFallBackToAccountCny(){
        val parsed=CurrencyDecision.apply(ParsedPaymentMessage(PaymentRecognitionStatus.PAYMENT_LIKELY,
            direction=FinanceDirection.EXPENSE),"付款成功 币种 XYZ 100.00","CNY",true)
        assertNotEquals("CNY",parsed.currency);assertNull(parsed.amountMinor)
        assertEquals("unsupported_iso_currency",parsed.reviewReason)
    }
    @Test fun identicalRetryIsIdempotentAndOlderResponseCannotRollBackContext(){
        assertTrue(repository.refreshPreferences(owner,"synthetic",response("USD","8"),context))
        assertTrue(repository.refreshPreferences(owner,"synthetic",response("USD","8"),context))
        assertFalse(repository.refreshPreferences(owner,"synthetic",response("JPY","7"),context))
        assertEquals(8L,db.currencies().preferences(owner)!!.revision)
        assertEquals("USD",CurrencyRuntimePreferences.defaultCurrency(context,owner))
        assertNull(CurrencyRuntimePreferences.defaultCurrency(context,"other-synthetic-account"))
    }
    @Test fun runtimePublicationIsDurableMonotonicAndAccountScoped(){
        fun snapshot(account:String,unit:String,revision:Long)=CachedCurrencyPreferences(account,"CNY","USD",unit,revision)
        assertTrue(CurrencyRuntimePreferences.publish(context,snapshot(owner,"USD",9)))
        assertFalse(CurrencyRuntimePreferences.publish(context,snapshot(owner,"JPY",8)))
        assertFalse(CurrencyRuntimePreferences.publish(context,snapshot(owner,"JPY",9)))
        assertTrue(CurrencyRuntimePreferences.publish(context,snapshot("another-owner","EUR",1)))
        assertEquals(9L,context.getSharedPreferences("wyj-currency-context",0).getLong("$owner:revision",-1))
        assertEquals("USD",CurrencyRuntimePreferences.defaultCurrency(context,owner))
        assertEquals("EUR",CurrencyRuntimePreferences.defaultCurrency(context,"another-owner"))
    }
    @Test fun committedRoomDefaultCanRecoverMissingMirrorWithoutNetwork(){
        db.currencies().putPreferences(CachedCurrencyPreferences(owner,"CNY","USD","USD",9))
        assertNull(CurrencyRuntimePreferences.defaultCurrency(context,owner))
        val offline=object:NotificationIngestTransport {
            override fun post(path:String,sessionToken:String,body:String)=IngestResponse(false,503,"{}")
            override fun get(path:String,sessionToken:String)=IngestResponse(false,503,"{}")
        }
        assertFalse(repository.refreshPreferences(owner,"synthetic",offline,context))
        assertEquals("USD",CurrencyRuntimePreferences.defaultCurrency(context,owner))
        assertEquals(9L,context.getSharedPreferences("wyj-currency-context",0).getLong("$owner:revision",-1))
        assertNull(CurrencyRuntimePreferences.defaultCurrency(context,"no-proof-owner"))
    }
    @Test fun corruptMirrorCannotCrashParsingAndCommittedMetadataRepairsIt(){
        context.getSharedPreferences("wyj-currency-context",0).edit().putInt("$owner:default",3).putString("$owner:revision","broken").commit()
        assertNull(CurrencyRuntimePreferences.defaultCurrency(context,owner))
        db.currencies().putPreferences(CachedCurrencyPreferences(owner,"CNY","USD","JPY",2))
        assertTrue(repository.recoverPreferences(owner,context))
        assertEquals("JPY",CurrencyRuntimePreferences.defaultCurrency(context,owner))
    }
    @Test fun explicitCurrencyAlwaysOverridesADifferentAccountDefault(){
        for(unit in CurrencyMoney.digits.keys)for(default in listOf("CNY","JPY")){
            val number=if(unit=="JPY")"100" else "1.00"
            val parsed=CurrencyDecision.apply(ParsedPaymentMessage(PaymentRecognitionStatus.PAYMENT_LIKELY,
                direction=FinanceDirection.EXPENSE),"付款成功 $unit $number",default,true)
            assertEquals(unit,parsed.currency);assertEquals(100L,parsed.amountMinor);assertFalse(parsed.currencyReviewRequired)
        }
        val merchant=CurrencyDecision.apply(ParsedPaymentMessage(PaymentRecognitionStatus.PAYMENT_LIKELY),"付款成功 CNY 1.00 商户 XYZ","JPY",true)
        assertEquals("CNY",merchant.currency);assertEquals(100L,merchant.amountMinor)
    }
    @Test fun referenceMetadataAndMerchantWordsCannotSupplyCurrencyOrMoney(){
        for(metadata in listOf("交易号 SYNTH-CNY","交易号 USD123456","商户 CNYSHOP")){
            val result=CurrencyDecision.apply(ParsedPaymentMessage(PaymentRecognitionStatus.PAYMENT_LIKELY,
                direction=FinanceDirection.EXPENSE),"付款成功 ¥100.00 $metadata",null,true)
            assertNull(metadata,result.currency);assertNull(metadata,result.amountMinor)
            assertEquals(metadata,"currency_review_required",result.reviewReason)
        }
    }
    @Test fun realExplicitUnitSurvivesCurrencyCodesEmbeddedInReferences(){
        val parsed=CurrencyDecision.apply(ParsedPaymentMessage(PaymentRecognitionStatus.PAYMENT_LIKELY,
            direction=FinanceDirection.EXPENSE),"付款成功 USD 1.00 交易号 CNY123456",null,true)
        assertEquals("USD",parsed.currency);assertEquals(100L,parsed.amountMinor);assertEquals("",parsed.reviewReason)
    }
}
