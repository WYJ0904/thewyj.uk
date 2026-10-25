package uk.thewyj.app.task21.payment

import android.app.Application
import android.graphics.Bitmap
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.FinanceDirection

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34], application=Application::class)
class FinanceP05PageEvidenceTest {
    private fun extract(lines: List<String>, unit: String?="CNY", policy: Int=2) =
        PaymentPageSemantics.extract(PaymentPageSnapshot("com.tencent.mm",lines,1000L),unit,policy)
    private fun verify(lines: List<String>, unit: String?="CNY", agreed: Boolean=true): PaymentEnrichment? {
        val engine=object: AmountConfirmingOcrEngine {
            override suspend fun recognize(bitmap: Bitmap)=lines
            override suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long)=if(agreed)expectedMinor else null
            override suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long,currency: String)=if(agreed)expectedMinor else null
        }
        val bitmap=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888)
        return try { runBlocking { PaymentScreenshotVerifier(engine).verify(bitmap,"com.tencent.mm",1000L,unit,2) } } finally {bitmap.recycle()}
    }
    @Test fun receivedByOtherIsOutgoingOnlyOnIdentifiedTransferReceipt() {
        val page=listOf("转账详情","已被合成用户领取","¥0.01","转账时间","18:49")
        assertEquals(FinanceDirection.EXPENSE,verify(page)!!.direction)
        assertTrue(verify(page)!!.completionConfirmed)
        assertNull(verify(listOf("聊天")+page))
        assertNull(PaymentPageEvidence.transferDirection(listOf("交易详情","已被合成用户领取","CNY 0.01")))
    }
    @Test fun oneCentFormsAndSeparatedSymbolUseSameCompletePage() {
        for(amount in listOf(listOf("¥0.01"),listOf("￥0.01"),listOf("0.01元"),listOf("0.01"),listOf("¥","0.01"),listOf("ＣＮＹ ０．０１"))) {
            val page=listOf("转账详情","已被合成用户领取")+amount+listOf("转账时间","18:49")
            assertEquals(amount.toString(),1L,verify(page)!!.amountMinor)
        }
    }
    @Test fun missingSymbolStillRequiresExplicitCurrencyDecision() {
        val page=listOf("转账详情","已被合成用户领取","0.01","转账时间","18:49")
        assertNull(verify(page,null))
        assertNull(verify(page,"JPY"))
        assertEquals(1L,verify(page,"CNY")!!.amountMinor)
    }
    @Test fun missingGlyphConfirmationRegionFollowsSemanticAmountNotScreenCoordinates() {
        val lines=listOf("转账详情","已被合成用户领取","0.01","转账时间","18.49")
        assertEquals(setOf(2),PaymentOcrTransferAmount.semanticAmountIndices(lines))
        assertEquals(1L,PaymentPageAmountSelection.select(lines).amountMinor)
        assertTrue(PaymentOcrTransferAmount.semanticAmountIndices(listOf("账单详情","余额CNY352.00")).isEmpty())
    }
    @Test fun actualPaidWinsOverOriginalDiscountBalanceAndFee() {
        for(lines in listOf(listOf("原价698元","优惠50元","实付648元","余额352元","手续费2元"),
            listOf("原价698元，优惠50元，实付648元，余额352元，手续费2元"))) {
            assertEquals(64800L,extract(listOf("交易详情","付款成功")+lines)!!.amountMinor)
        }
    }
    @Test fun actualPaidRoleUsesEachIsoUnitAndDoesNotSumOtherPageAmounts() {
        for(unit in listOf("CNY","USD","EUR","HKD","GBP","JPY")) {
            val whole=unit=="JPY"
            val result=verify(listOf("交易详情","付款成功","原价 $unit ${if(whole)"698" else "6.98"}",
                "优惠 $unit ${if(whole)"50" else "0.50"}","实付 $unit ${if(whole)"648" else "6.48"}","余额 $unit ${if(whole)"352" else "3.52"}"),null)
            assertNotNull(unit,result);assertEquals(unit,result!!.currency);assertEquals(648L,result.amountMinor)
        }
    }
    @Test fun completedInlineCurrencySuffixKeepsAllSixIsoUnits() {
        for(unit in listOf("CNY","USD","EUR","HKD","GBP","JPY")) {
            val number=if(unit=="JPY")"100" else "1.00"
            val result=verify(listOf("交易详情","已扣款 $number $unit"),null)!!
            assertEquals(unit,result.currency);assertEquals(100L,result.amountMinor);assertTrue(result.completionConfirmed)
        }
    }
    @Test fun oneVerifierSerializesBothOcrPassesAcrossConcurrentRequests()=runBlocking {
        val release=CompletableDeferred<Unit>();var calls=0
        val engine=object:AmountConfirmingOcrEngine {
            override suspend fun recognize(bitmap:Bitmap):List<String>{val n=++calls;if(n==1)release.await();return listOf("交易详情","付款成功","CNY $n.00")}
            override suspend fun confirmAmount(bitmap:Bitmap,expectedMinor:Long)=expectedMinor
        }
        val verifier=PaymentScreenshotVerifier(engine);val image=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888)
        try {
            val first=async(start=CoroutineStart.UNDISPATCHED){verifier.verifyCurrent(image,"com.tencent.mm",1000L,"CNY",2){true}}
            val second=async(start=CoroutineStart.UNDISPATCHED){verifier.verifyCurrent(image,"com.tencent.mm",1000L,"CNY",2){true}}
            assertEquals(1,calls);release.complete(Unit)
            assertEquals(100L,first.await()!!.amountMinor);assertEquals(200L,second.await()!!.amountMinor)
        } finally {image.recycle()}
    }
    @Test fun conflictingPrimaryOrTwoUnlabelledAmountsAreNotGuessed() {
        assertNull(verify(listOf("账单详情","付款成功","实付¥648.00","实际支付¥646.00")))
        assertNull(verify(listOf("账单详情","付款成功","¥648.00","¥646.00")))
        assertNull(verify(listOf("账单详情","付款成功","实付¥646.00"),agreed=false))
    }
    @Test fun allNonDetailHeadingsBlockEmbeddedCompletedAmounts() {
        for(header in listOf("交易记录","账单列表","历史账单","账户余额","账户资产","优惠活动","加载中","正在跳转","聊天")) {
            val page=listOf(header,"账单详情","付款成功","CNY 648.00")
            assertNull(header,verify(page));assertNull(header,extract(page))
        }
    }
    @Test fun pendingAndFailedTransferNeverBecomeSettled() {
        for(header in listOf("支付详情","付款详情","收款詳情")) {
            val pending=verify(listOf(header,"待支付","付款金额 CNY 0.01"),null)
            assertNotNull(header,pending);assertEquals(1L,pending!!.amountMinor);assertFalse(pending.completionConfirmed)
        }
        for(status in listOf("待你收款","待对方收款","转账处理中","转账失败","转账取消","尚未收款")) {
            val e=extract(listOf("转账详情",status,"CNY 0.01","转账时间","18:49"))
            assertNotNull(status,e);assertEquals(1L,e!!.amountMinor);assertFalse(status,e.completionConfirmed)
        }
    }
    @Test fun feeOrArrivalTimeLabelsDoNotProveSettlement() {
        for(status in listOf("到账成功","到賬成功","入账成功"))assertTrue(extract(listOf("交易详情",status,"CNY 0.01"))!!.completionConfirmed)
        for(note in listOf("扣款规则","到账时间 18:49","退款到账时间")) {
            val result=extract(listOf("账单详情",note,"CNY 0.01"))!!
            assertFalse(note,result.completionConfirmed)
        }
    }
    @Test fun actualPaymentStatusWinsOverRefundHelpAndConflictingStatusesStayUnknown() {
        assertEquals(FinanceDirection.EXPENSE,verify(listOf("账单详情","付款成功","CNY 648.00","退款说明：可以申请原路退款"))!!.direction)
        assertNull(verify(listOf("账单详情","付款成功","收款成功","CNY 0.01"))!!.direction)
        assertEquals(FinanceDirection.REFUND,verify(listOf("转账详情","退款成功","已存入零钱","CNY 0.01","转账时间","18:49"))!!.direction)
    }
    @Test fun sensitivePageIsNeverEvidenceAndSourceTextIsNotPersisted() {
        for(label in listOf("请输入支付密码","验证码","银行卡号"))assertNull(verify(listOf("交易详情","付款成功","CNY 648.00",label)))
    }
    @Test fun observationClockDoesNotInventMissingTransactionDateOrProviderIdentity() {
        val page=listOf("转账详情","已被合成用户领取","CNY 0.01","转账时间","18:49")
        val result=extract(page)!!
        assertNull(result.occurredAtMs);assertNull(result.providerReference)
        assertTrue(PaymentSourceIdentity.requiresManualReview(true,false,"SYNTH-REF","SYNTH-REF",true))
        assertTrue(PaymentSourceIdentity.requiresManualReviewForObservation(false,true,"SYNTH-REF","SYNTH-REF",false,false))
        assertFalse(PaymentSourceIdentity.requiresManualReviewForObservation(false,true,"SYNTH-REF","SYNTH-REF",false,true))
    }
    @Test fun fullWidthAndThousandsAreExactButMissingDecimalIsNotRepaired() {
        assertEquals(123456L,verify(listOf("交易详情","付款成功","实付 ￥１,２３４．５６"))!!.amountMinor)
        assertEquals(64800L,verify(listOf("交易详情","付款成功","CNY 648"))!!.amountMinor)
        assertNull(verify(listOf("交易详情","付款成功","CNY 64.800")))
    }
    @Test fun decimalCommaMustNotMultiplyAmountAndJpyPrecisionIsStillStrict() {
        assertEquals(10050L,verify(listOf("交易详情","付款成功","实付 CNY 100,50"))!!.amountMinor)
        assertEquals(123456L,verify(listOf("交易详情","付款成功","实付 EUR 1,234.56"),null)!!.amountMinor)
        assertNull(verify(listOf("交易详情","付款成功","实付 JPY 1.00"),null))
    }
    @Test fun balanceFeeAndUncertainGroupingCannotBecomeActualPaid() {
        for(line in listOf("余额 CNY 352.00","手续费 CNY 2.00","实付 CNY 1，234.56"))
            assertNull(line,verify(listOf("账单详情","付款成功",line)))
        assertEquals(100L,verify(listOf("账单详情","付款成功 CNY 1.00"))!!.amountMinor)
    }
    @Test fun asynchronousContentSwitchDropsResultEvenInSameWindow()=runBlocking {
        val release=CompletableDeferred<Unit>();val epoch=PaymentPageEvidenceEpoch();val token=epoch.capture()
        val engine=object: OcrEngine {override suspend fun recognize(bitmap: Bitmap):List<String>{release.await();return listOf("交易详情","付款成功","CNY 0.01")}}
        val bitmap=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888)
        try {
            val result=async(start=CoroutineStart.UNDISPATCHED) {PaymentScreenshotVerifier(engine).verifyCurrent(bitmap,"com.tencent.mm",1000L,"CNY",2){epoch.current(token)}}
            epoch.invalidate();release.complete(Unit);assertNull(result.await())
            assertTrue(epoch.current(epoch.capture()))
        } finally {bitmap.recycle()}
    }
    @Test fun expiredAccountOrTicketCallbackIsDiscardedWithoutRealSleep()=runBlocking {
        var now=1000L;val engine=PaymentTicketEngine(now={now});val ticket=engine.create("owner","rec","com.tencent.mm","event","wechat")
        val bitmap=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888);val release=CompletableDeferred<Unit>()
        val ocr=object:OcrEngine {override suspend fun recognize(bitmap:Bitmap):List<String>{release.await();return listOf("交易详情","付款成功","CNY 0.01")}}
        try {
            val result=async(start=CoroutineStart.UNDISPATCHED){PaymentScreenshotVerifier(ocr).verifyCurrent(bitmap,"com.tencent.mm",now,"CNY",2){engine.isActive(ticket)}}
            now=ticket.expiresAtMs+1;release.complete(Unit);assertNull(result.await())
        } finally {bitmap.recycle()}
    }
    @Test fun finiteBudgetIsSharedAcrossPageChangesAndCancelledOnBackground() {
        val pool=PaymentPageRetryPool();val original=pool.budget("owner","ticket",0)
        repeat(8){i->assertTrue(pool.budget("owner","ticket",i*1000L).beginAttempt(i*1000L))}
        assertFalse(original.beginAttempt(8000));assertNull(original.nextDelayMs(8000));pool.clear();assertFalse(original.beginAttempt(9000))
        assertEquals(90000L,PaymentTicketEngine.DEFAULT_TTL_MS)
        assertTrue(PaymentPageRetry("boundary",0).beginAttempt(90000));assertFalse(PaymentPageRetry("late",0).beginAttempt(90001))
    }

    @Test fun liveOcrRetainsUnresolvedCandidateButCompatibilityVerifierStillRejectsUnknownUnit()=runBlocking {
        val lines=listOf("转账详情","已被合成用户领取","¥0.01","转账时间","18:49")
        assertNull(verify(lines,null))
        val bitmap=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888)
        val ocr=object:OcrEngine {override suspend fun recognize(bitmap:Bitmap)=lines}
        try {
            val pending=PaymentScreenshotVerifier(ocr).verifyCurrent(bitmap,"com.tencent.mm",1000L,null,2){true}!!
            assertEquals("0.01",pending.amountDecimalCandidate);assertNull(pending.currency);assertNull(pending.amountMinor)
            assertFalse(pending.completionConfirmed);assertNull(pending.providerReference)
        } finally {bitmap.recycle()}
    }
}
