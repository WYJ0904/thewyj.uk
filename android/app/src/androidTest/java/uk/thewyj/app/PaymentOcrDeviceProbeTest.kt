package uk.thewyj.app

import android.app.UiAutomation
import android.graphics.BitmapFactory
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.task21.payment.MlKitOcrEngine
import uk.thewyj.app.task21.payment.PaymentScreenshotVerifier
import java.io.File

/** Opt-in, local device probe. Input images and OCR prose are never checked in or logged. */
@RunWith(AndroidJUnit4::class)
class PaymentOcrDeviceProbeTest {
    @Test fun suppliedPaymentImageKeepsItsExactMinorUnits() {
        val args = InstrumentationRegistry.getArguments()
        val path = args.getString("paymentImage").orEmpty()
        assumeTrue("supply a local payment image to run the probe", path.isNotBlank())
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        val context = instrumentation.targetContext
        require(path.matches(Regex("[/A-Za-z0-9_.-]+")))
        val bitmap = BitmapFactory.decodeFile(File(path).absolutePath) ?: automation.executeShellCommand("cat $path").use { descriptor ->
            java.io.FileInputStream(descriptor.fileDescriptor).use { requireNotNull(BitmapFactory.decodeStream(it)) }
        }
        val engine = MlKitOcrEngine(context)
        val raw = runBlocking { engine.recognize(bitmap) }
        val normalized = PaymentScreenshotVerifier.normalizeOcrLines(raw)
        val textClass = Class.forName("uk.thewyj.app.task21.payment.PaymentText")
        val textObject = textClass.getDeclaredField("INSTANCE").also { it.isAccessible = true }.get(null)
        val amounts = textClass.getDeclaredMethod("amountsMinor", String::class.java).also { it.isAccessible = true }
        val moneyOnly = Regex("[¥￥]\\s*[0-9OoIlSsZzBbGg,. ]{1,18}|^[0-9]{1,7}\\.[0-9]{1,2}$")
        raw.forEachIndexed { i, line ->
            val snippets = moneyOnly.findAll(line).map { it.value.trim() }.toList()
            if (snippets.isNotEmpty()) Log.i("AerisPayDiag", "probe line=$i money=$snippets")
            val values = amounts.invoke(textObject, normalized.getOrNull(i).orEmpty())
            if (values?.toString() != "[]") Log.i("AerisPayDiag", "probe line=$i minor=$values")
        }
        Log.i("AerisPayDiag", "probe joinedMinor=${amounts.invoke(textObject, normalized.joinToString(" "))}")
        Log.i("AerisPayDiag", "probe lines=${raw.size} normalized=${normalized.size} context=${PaymentScreenshotVerifier.looksLikePaymentPage(normalized)}")
        val result = runBlocking { PaymentScreenshotVerifier(engine).verify(bitmap, "com.tencent.mm", System.currentTimeMillis()) }
        bitmap.recycle()
        Log.i("AerisPayDiag", "probe amountMinor=${result?.amountMinor} confidence=${result?.confidence}")
        assertEquals(args.getString("expectedMinor", "1").toLong(), result?.amountMinor)
    }
}
