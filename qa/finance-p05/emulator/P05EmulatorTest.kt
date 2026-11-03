package uk.thewyj.app.task21.payment

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.SystemClock
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runners.MethodSorters
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.MainActivity
import uk.thewyj.app.task21.FinanceDirection

/** Actual bundled SDK pixels, deliberately synthetic; no payment/profile proof or ledger. */
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class P05EmulatorTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val runId get() = InstrumentationRegistry.getArguments().getString("p05Run", "r1").also { require(it.matches(Regex("r[0-9]+"))) }
    private fun output(name: String) = File(context.filesDir, "p05-$runId-$name")

    private class ObservedEngine(private val sdk: MlKitOcrEngine) : AmountConfirmingOcrEngine {
        var lines = emptyList<String>()
        var confirmation: Long? = null
        override suspend fun recognize(bitmap: Bitmap): List<String> = sdk.recognize(bitmap).also { lines = it }
        override suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long): Long? =
            sdk.confirmAmount(bitmap, expectedMinor).also { confirmation = it }
        override suspend fun confirmAmount(bitmap: Bitmap, expectedMinor: Long, currency: String): Long? =
            sdk.confirmAmount(bitmap, expectedMinor, currency).also { confirmation = it }
    }

    private fun image(lines: List<String>): Bitmap {
        val bitmap = Bitmap.createBitmap(1080, 1600, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            textSize = 54f
        }
        lines.forEachIndexed { index, text ->
            canvas.drawText(text, 90f, 150f + index * 145f, paint)
        }
        return bitmap
    }

    private fun vector(id: String, lines: List<String>, minor: Long, currency: String) {
        val bitmap = image(lines)
        output("$id.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val engine = ObservedEngine(MlKitOcrEngine(context))
        val started = SystemClock.elapsedRealtime()
        val result = try {
            runBlocking { PaymentScreenshotVerifier(engine).verifyCurrent(bitmap, context.packageName, 1234L, null, 2) { true } }
        } finally { bitmap.recycle() }
        val pass = result?.amountMinor == minor && result.currency == currency &&
            result.direction == FinanceDirection.EXPENSE && result.completionConfirmed && engine.confirmation == minor
        val row = JSONObject().put("id", id).put("status", if (pass) "PASS" else "FAIL")
            .put("duration_ms", SystemClock.elapsedRealtime() - started).put("input", JSONArray(lines))
            .put("sdk_lines", JSONArray(engine.lines)).put("expected_minor", minor).put("expected_currency", currency)
            .put("confirmed_minor", engine.confirmation ?: JSONObject.NULL)
            .put("actual_minor", result?.amountMinor ?: JSONObject.NULL).put("actual_currency", result?.currency ?: JSONObject.NULL)
            .put("direction", result?.direction?.name ?: JSONObject.NULL).put("completion", result?.completionConfirmed ?: false)
            .put("provider_proof", false).put("ledger_writes", 0)
        output("emulator.ndjson").appendText(row.toString() + "\n")
        assertEquals(row.toString(), minor, result?.amountMinor)
        assertEquals(row.toString(), currency, result?.currency)
        assertEquals(row.toString(), FinanceDirection.EXPENSE, result?.direction)
        assertTrue(row.toString(), result?.completionConfirmed == true)
        assertEquals(row.toString(), minor, engine.confirmation)
    }

    @Test fun test01_coldBundledSdkCnyOneCent() = vector("cold-cent",
        listOf("付款详情", "付款成功", "实付 CNY 0.01", "转账时间 18:49"), 1L, "CNY")

    @Test fun test02_splitCurrencyAndAmount() = vector("split-cent",
        listOf("付款详情", "付款成功", "CNY", "0.01", "转账时间 18:49"), 1L, "CNY")

    @Test fun test03_jpyIntegerUnit() = vector("jpy",
        listOf("付款详情", "付款成功", "实付 JPY 100"), 100L, "JPY")

    @Test fun test04_actualPaidAmongOtherAmounts() = vector("roles",
        listOf("付款详情", "付款成功", "原价 CNY 698.00", "优惠 CNY 50.00", "实付 CNY 648.00", "余额 CNY 352.00", "手续费 CNY 0.00"),
        64800L, "CNY")

    @Test fun test05_mainActivityStopResumeRecreate() {
        assertEquals("https://isolated-finance.invalid", BuildConfig.THEWYJ_BASE_URL)
        val cycles = JSONArray()
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            repeat(3) { iteration ->
                val started = SystemClock.elapsedRealtime()
                scenario.moveToState(Lifecycle.State.CREATED)
                assertEquals(Lifecycle.State.CREATED, scenario.state)
                scenario.moveToState(Lifecycle.State.RESUMED)
                assertEquals(Lifecycle.State.RESUMED, scenario.state)
                scenario.recreate()
                assertEquals(Lifecycle.State.RESUMED, scenario.state)
                cycles.put(JSONObject().put("round", iteration + 1).put("duration_ms", SystemClock.elapsedRealtime() - started)
                    .put("stop", "CREATED").put("resume", "RESUMED").put("recreated", true))
            }
        } finally { scenario.close() }
        assertEquals(Lifecycle.State.DESTROYED, scenario.state)
        output("emulator.ndjson").appendText(JSONObject().put("id", "main-activity")
            .put("status", "PASS").put("cycles", cycles).put("closed", "DESTROYED").put("authenticated", false).toString() + "\n")
    }
}
