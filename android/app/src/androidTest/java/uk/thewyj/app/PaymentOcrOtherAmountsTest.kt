package uk.thewyj.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.task21.payment.MlKitOcrEngine
import uk.thewyj.app.task21.payment.PaymentScreenshotVerifier

/** Synthetic receipt renderings exercise the bundled model on hardware without making payments. */
@RunWith(AndroidJUnit4::class)
class PaymentOcrOtherAmountsTest {
    @Test fun otherRequestedAmountsSurviveBothNativeOcrScales() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        for ((amount, minor) in listOf("0.10" to 10L, "1.00" to 100L, "10.00" to 1000L, "10.01" to 1001L)) {
            val bitmap = Bitmap.createBitmap(1080, 1600, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap); canvas.drawColor(Color.WHITE)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; textSize = 70f }
            canvas.drawText("交易详情", 120f, 180f, paint)
            canvas.drawText("付款成功", 120f, 360f, paint)
            paint.textSize = 150f
            canvas.drawText("¥$amount", 180f, 650f, paint)
            val result = runBlocking { PaymentScreenshotVerifier(MlKitOcrEngine(context)).verify(bitmap, "com.tencent.mm", System.currentTimeMillis()) }
            bitmap.recycle()
            assertEquals("synthetic hardware OCR ¥$amount", minor, result?.amountMinor)
        }
    }
}
