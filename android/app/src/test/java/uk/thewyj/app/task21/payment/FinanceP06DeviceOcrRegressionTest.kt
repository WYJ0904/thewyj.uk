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
class FinanceP06DeviceOcrRegressionTest {
    @Test fun chatHeadingWithOcrPrefixOrTruncatedRecordIsAlwaysNegative() {
        for(header in listOf("|聊天记录","聊天记","｜聊天記錄","聊天記")) {
            val page=listOf(header,"交易详情","付款成功","CNY 100.00")
            assertTrue(header,PaymentPageEvidence.blocked(page))
            assertNull(header,PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm",page,1000),null,2))
        }
    }
    @Test fun firstReadChatCannotBeRescuedByASecondPositiveRead()=runBlocking {
        var calls=0
        val engine=object:ScalablePageOcrEngine {
            override suspend fun recognize(bitmap:Bitmap)=if(++calls==1)listOf("聊天记","交易详情","付散戌功","CNY 100.00") else listOf("付款详情","付款成功","CNY 100.00")
            override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long)=10000L
        }
        val bitmap=Bitmap.createBitmap(480,800,Bitmap.Config.ARGB_8888)
        try{assertNull(PaymentScreenshotVerifier(engine).verifyCurrent(bitmap,"com.tencent.mm",1000,null,2){true});assertEquals(1,calls)}finally{bitmap.recycle()}
    }
    @Test fun recognizedCompletionWithUnreadableUnitMustRequestIndependentPixels()=runBlocking {
        var calls=0
        val engine=object:ScalablePageOcrEngine {
            override suspend fun recognize(bitmap:Bitmap)=if(++calls==1)listOf("付款详情","付款成功","实付CN Y O,01") else listOf("付款详情","付款成功","实付 CNY 0.01")
            override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long)=1L
        }
        val bitmap=Bitmap.createBitmap(480,800,Bitmap.Config.ARGB_8888)
        try{assertEquals(1L,PaymentScreenshotVerifier(engine).verifyCurrent(bitmap,"com.tencent.mm",1000,null,2){true}?.amountMinor);assertEquals(2,calls)}finally{bitmap.recycle()}
    }
    @Test fun genuinelyMissingUnitKeepsTheFirstExactManualCandidateWithoutExtraReads()=runBlocking {
        for(amount in listOf("0.01","¥0.01")) {
            var calls=0
            val engine=object:ScalablePageOcrEngine {
                override suspend fun recognize(bitmap:Bitmap)=if(++calls==1)listOf("转账详情","已被合成用戶领取",amount,"转账时间","18:49") else listOf("转账洋惰","已被合成用戶领取",amount,"转账时间","18:49")
                override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long):Long?=null
            }
            val bitmap=Bitmap.createBitmap(480,800,Bitmap.Config.ARGB_8888)
            try{val result=PaymentScreenshotVerifier(engine).verifyCurrent(bitmap,"com.tencent.mm",1000,null,2){true}
                assertNotNull(amount,result);assertEquals("0.01",result!!.amountDecimalCandidate);assertNull(result.currency);assertFalse(result.completionConfirmed);assertEquals(1,calls)
            }finally{bitmap.recycle()}
        }
    }
    @Test fun pendingTypoLabelMayRetainMoneyButNeverCompletion() {
        val page=listOf("付款译情","待付款","付款歌金额 CNY 1.00")
        val result=PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm",page,1000),null,2)
        assertNotNull(result);assertEquals(100L,result!!.amountMinor);assertFalse(result.completionConfirmed)
    }
    @Test fun independentPendingCropKeepsExactUnitAndRejectsCompetingRoles() {
        assertEquals(100L,PaymentSecondaryOcrAmount.select(listOf("待付款","付歌全额 CNY 1.00"),"CNY"))
        assertEquals(100L,PaymentSecondaryOcrAmount.select(listOf("付款中","付歌全额 CNY 1.00"),"CNY"))
        assertNull(PaymentSecondaryOcrAmount.select(listOf("付款中","余额 CNY 1.00"),"CNY"))
        assertNull(PaymentSecondaryOcrAmount.select(listOf("付款中","付歌全额 CNY 1.00","手续费 CNY 0.10"),"CNY"))
        assertNull(PaymentSecondaryOcrAmount.select(listOf("付款中","付歌全额 USD 1.00"),"CNY"))
    }
    @Test fun transferTimeLabelNormalizationDoesNotInventStatusDateOrNumbers() {
        for(label in listOf("轉脹時間","轉賬時聞")) {
            val page=PaymentScreenshotVerifier.normalizeOcrLines(listOf("轉賬詳情","已被合成用戶領取","CNY 0.01",label,"18:49"))
            val result=PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm",page,1000),null,2)
            assertNotNull(result);assertTrue(label,result!!.completionConfirmed);assertEquals(1L,result.amountMinor);assertNull(result.occurredAtMs)
            assertFalse(PaymentPageEvidence.completed(page.filterNot {it=="已被合成用戶領取"}))
        }
    }
}
