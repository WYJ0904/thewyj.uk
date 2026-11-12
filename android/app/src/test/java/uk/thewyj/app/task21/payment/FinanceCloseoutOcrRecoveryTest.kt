package uk.thewyj.app.task21.payment

import android.app.Application
import android.graphics.Bitmap
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceCloseoutOcrRecoveryTest {
    private class Reads(val rows:List<List<String>>,override val fullPageRetryReady:Boolean=true):ScalablePageOcrEngine {
        var calls=0;var confirmations=0;var last=emptyList<String>()
        override suspend fun recognize(bitmap:Bitmap)=rows[calls++.coerceAtMost(rows.lastIndex)].also{last=it}
        override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long):Long? {confirmations++;return PaymentSecondaryOcrAmount.select(last,"CNY")}
        override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long,currency:String):Long? {confirmations++;return PaymentSecondaryOcrAmount.select(last,currency)}
    }
    private fun verify(engine:Reads,current:()->Boolean={true}):PaymentEnrichment?{
        val bitmap=Bitmap.createBitmap(480,800,Bitmap.Config.ARGB_8888)
        return try{runBlocking{PaymentScreenshotVerifier(engine).verifyCurrent(bitmap,"com.tencent.mm",1000L,null,2,current)}}finally{bitmap.recycle()}
    }
    @Test fun wholePageRetryNeedsNewPixelEvidenceRatherThanSpellingCompletion(){
        val engine=Reads(listOf(listOf("付歉洋信","付軟成功","实付 CNY 0.01"),listOf("付款详情","付款成功","实付 CNY 0.01")))
        assertEquals(1L,verify(engine)!!.amountMinor);assertEquals(2,engine.calls);assertEquals(1,engine.confirmations)
    }
    @Test fun knownAmountCannotBeOverwrittenByAnotherScale(){
        val engine=Reads(listOf(listOf("付歉洋信","付軟成功","实付 CNY 0.01"),listOf("付款详情","付款成功","实付 CNY 0.02")))
        assertNull(verify(engine));assertEquals(2,engine.calls);assertEquals(0,engine.confirmations)
    }
    @Test fun firstMissingMoneyDoesNotAllowLaterScalesToDisagree(){
        val engine=Reads(listOf(listOf("待识别"),listOf("付歉洋信","付軟成功","实付 CNY 0.01"),listOf("付款详情","付款成功","实付 CNY 0.02")))
        assertNull(verify(engine));assertEquals(3,engine.calls);assertEquals(0,engine.confirmations)
    }
    @Test fun expiredScopeAndNegativePagePreventAdditionalConfirmation(){
        val stale=Reads(listOf(listOf("待识别"),listOf("付款详情","付款成功","实付 CNY 0.01")))
        assertNull(verify(stale){stale.calls<2});assertEquals(0,stale.confirmations)
        val negative=Reads(listOf(listOf("待识别"),listOf("账户余额","付款成功","实付 CNY 0.01")))
        assertNull(verify(negative));assertEquals(0,negative.confirmations)
    }
    @Test fun busySdkCannotQueueAFullPageRetry(){
        val engine=Reads(listOf(listOf("付歉洋信","付軟成功","实付 CNY 0.01")),false)
        assertNull(verify(engine));assertEquals(1,engine.calls)
    }
    @Test fun secondCropWithOnlyStatusAndOneBareAmountKeepsItsEstablishedUnit(){
        assertEquals(1L,PaymentSecondaryOcrAmount.select(listOf("已被合成用户领取","0.01"),"CNY"))
        assertNull(PaymentSecondaryOcrAmount.select(listOf("余额","0.01"),"CNY"))
        assertNull(PaymentSecondaryOcrAmount.select(listOf("订单号","0.01"),"CNY"))
        assertNull(PaymentSecondaryOcrAmount.select(listOf("0.01","18.49"),"CNY"))
    }
    @Test fun failedTransferRetainsMoneyWithoutAssertingCompletion()=runBlocking {
        val engine=object:AmountConfirmingOcrEngine {
            override suspend fun recognize(bitmap:Bitmap)=listOf("转账详情","转账失败","CNY 1.00")
            override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long)=100L
        }
        val image=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888)
        try{val result=PaymentScreenshotVerifier(engine).verifyCurrent(image,"com.tencent.mm",1000L,null,2){true}
            assertNotNull(result);assertEquals(100L,result!!.amountMinor);assertFalse(result.completionConfirmed)
        }finally{image.recycle()}
    }
    @Test fun undecodableOtherStatusCannotBecomeAProvenReceiver(){
        val result=PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm",
            listOf("交易详情","付軟成功","收款成功","CNY 0.01"),1000L),null,2)!!
        assertNull(result.direction)
        assertFalse(result.completionConfirmed)
    }
    @Test fun pendingMoneyLabelIsUsefulEvenWhenTheTitleWasNotDecoded(){
        for(lines in listOf(listOf("付款详倩","待付款","付款全额 CNY 1.00"),listOf("付款详惰","付款中","付款金额 CNY 1.00"))){
            val result=PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm",lines,1000L),null,2)
            assertNotNull(lines.toString(),result);assertEquals(100L,result!!.amountMinor);assertFalse(result.completionConfirmed)
        }
    }
    @Test fun unrecognisedCompetingPaymentLabelDoesNotAuthorizeTheOtherAmount(){
        val lines=listOf("付款详情","付款成功","实付 CNY 648.00","实陈支付 CNY 646.00")
        assertNull(PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm",lines,1000L),null,2))
    }
    @Test fun duplicateTraditionalBalanceHeadingMustRemainBlocked(){
        for(header in listOf("账户余额額","账戶余额額","賬戶餘額")){
            val page=listOf(header,"交易详情","付款成功","CNY 100.00")
            assertTrue(header,PaymentPageEvidence.blocked(page))
            assertNull(PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm",page,1000L),null,2))
        }
    }
}
