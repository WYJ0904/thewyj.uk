package uk.thewyj.app.task21.payment.ocr

import org.junit.Assert.*
import org.junit.Test

class ReceiptOcrEvidenceTest {
    private val frame = ReferenceFrame("synthetic.provider", "owner-A", "capture-A", 1000, "a".repeat(64), 1080, 2200)
    private val gate = ReceiptCaptureGate(ReceiptCaptureScope(frame.sourcePackage, frame.accountScope, frame.captureId), true, true)
    private fun read(vararg lines: String) = ReferenceRead(frame, "chinese:16.0.1", "full-native",
        lines.mapIndexed { i, text -> ReferenceLine(text, ReferenceBox(80, 100 + i * 100, 960, 150 + i * 100)) })
    private fun assess(vararg text: String) = ReceiptOcrEvidence.assess(listOf(read(*text)), gate)

    @Test fun allAmountsRetainTheirRolesAndOnlyCompletedExplicitPaidAmountIsSuggested() {
        val result = assess("付款成功", "原价 CNY 120.00", "优惠 CNY 30.00", "实付 CNY 90.00", "退款金额 CNY 5.00",
            "手续费 CNY 1.00", "账户余额 CNY 9999.00", "广告额度 CNY 8000.00", "信用额度 CNY 50000.00", "订单金额 CNY 120.00")
        assertEquals("90.00", result.paidAmount?.rawNumber)
        assertEquals(9, result.amounts.size)
        assertEquals(ReceiptAmountRole.entries.toSet(), result.amounts.map { it.role }.toSet())
        assertTrue(result.requiresManualReview)
    }

    @Test fun multipleSemanticFieldsOnOneLineAreNotOneBigAmount() {
        val result = assess("支付成功", "原价 CNY 100.00 优惠 CNY 10.00 实付 CNY 90.00")
        assertEquals("90.00", result.paidAmount?.rawNumber)
        assertEquals(3, result.amounts.size)
    }

    @Test fun balancesCreditsAdvertisingAndReferenceNumbersCannotBeActualPaidAmounts() {
        for (label in listOf("原价", "优惠", "退款金额", "手续费", "账户余额", "广告额度", "信用额度", "订单金额", "交易号")) {
            val result = assess("付款成功", label, "CNY 888888.00")
            assertNull(label, result.paidAmount)
            assertTrue(result.requiresManualReview)
        }
    }

    @Test fun pendingFailedLoadingRefundedAndMissingCompletionAreNotPaymentProof() {
        for (status in listOf("待支付", "支付中", "支付失败", "加载中", "退款成功", "交易详情", "payment pending")) {
            assertNull(status, assess(status, "实付 CNY 90.00").paidAmount)
            if (status != "交易详情") assertNull(status, assess("付款成功", status, "实付 CNY 90.00").paidAmount)
        }
    }

    @Test fun allSixIsoUnitsStayExplicitAndSymbolsOrMalformedDigitsDoNotGuessACurrency() {
        for (unit in listOf("CNY", "USD", "EUR", "HKD", "GBP", "JPY")) {
            val number = if (unit == "JPY") "900" else "90.00"
            assertEquals(unit, assess("支付成功", "实付 $unit $number").paidAmount?.currency)
        }
        for (value in listOf("¥ 90.00", "$ 90.00", "90.00", "CNY O0.00", "CNY 9O.00", "CNY 90.001", "CNY 9 0.00", "JPY 90.50", "CNY 90.00 USD")) {
            assertNull(value, assess("付款成功", "实付 $value").paidAmount)
        }
    }

    @Test fun differentAmountsOrModelsCannotResolveTheConflictByTakingTheLargest() {
        assertNull(assess("付款成功", "实付 CNY 90.00", "实付 CNY 900.00").paidAmount)
        val a = read("付款成功", "实付 CNY 90.00")
        val b = read("付款成功", "实付 CNY 900.00").copy(model = "latin:16.0.1")
        assertNull(ReceiptOcrEvidence.assess(listOf(a, b), gate).paidAmount)
    }

    @Test fun permissionIncompleteCaptureAndDifferentAccountsAppsProfilesOrCapturesStopSafely() {
        val original = read("付款成功", "实付 CNY 90.00")
        for (scope in listOf(gate.scope.copy(sourcePackage = "other.app"), gate.scope.copy(accountScope = "owner-B"), gate.scope.copy(captureId = "capture-B"))) {
            assertNull(ReceiptOcrEvidence.assess(listOf(original), gate.copy(scope = scope)).paidAmount)
        }
        assertNull(ReceiptOcrEvidence.assess(listOf(original), gate.copy(accessibilityGranted = false)).paidAmount)
        assertNull(ReceiptOcrEvidence.assess(listOf(original), gate.copy(completePage = false)).paidAmount)
        assertNull(ReceiptOcrEvidence.assess(listOf(original, original.copy(frame = frame.copy(accountScope = "owner-B"))), gate).paidAmount)
        assertNull(ReceiptOcrEvidence.assess(listOf(original.copy(anchor = original.lines.last())), gate).paidAmount)
    }

    @Test fun geometricLabelAssociationMustNotBorrowAnotherColumnOrConcatenateDigits() {
        val lines = listOf(ReferenceLine("付款成功", ReferenceBox(60, 50, 300, 100)),
            ReferenceLine("实付", ReferenceBox(60, 200, 140, 240)), ReferenceLine("CNY 90.00", ReferenceBox(180, 200, 380, 240)))
        val original = read().copy(lines = lines)
        assertEquals("90.00", ReceiptOcrEvidence.assess(listOf(original), gate).paidAmount?.rawNumber)
        assertNull(ReceiptOcrEvidence.assess(listOf(original.copy(lines = lines.dropLast(1) + lines.last().copy(box = ReferenceBox(700, 200, 1000, 240)))), gate).paidAmount)
        assertNull(assess("付款成功", "实付", "CNY 9", "0.00").paidAmount)
    }
}
