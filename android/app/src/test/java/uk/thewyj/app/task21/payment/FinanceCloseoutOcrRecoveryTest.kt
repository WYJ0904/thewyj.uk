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
}
