package uk.thewyj.app.task21.payment

import android.graphics.BitmapFactory
import android.os.Looper
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.MlKit
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Separate cold-start diagnostic. The product's 10 second timeout is unchanged. */
class RawOcrDiagnosticTest {
    @Test fun directSdkThenUnchangedOracles() = runBlocking {
        val inst=InstrumentationRegistry.getInstrumentation()
        val out=File(inst.targetContext.filesDir,"raw-sdk-diagnostic").apply{mkdirs()}
        val bitmap=inst.context.assets.open("reference-original.png").use{BitmapFactory.decodeStream(it)}!!
        // The target provider initializes ML Kit before instrumentation starts.
        // Reinitialization is not idempotent in this pinned SDK.
        val recognizer=TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        val started=System.nanoTime()
        val row=JSONObject().put("diagnostic_only",true).put("product_timeout_changed",false)
        val task=recognizer.process(InputImage.fromBitmap(bitmap,0))
        try {
            val text=withContext(Dispatchers.IO) {
                assertNotEquals(Looper.getMainLooper(),Looper.myLooper())
                // Diagnostic readiness only: never used as a production OCR result.
                Tasks.await(task,60,TimeUnit.SECONDS)
            }
            row.put("status","PASS").put("sdk_lines",JSONArray(text.textBlocks.flatMap{it.lines}.map{it.text}))
        } catch(error:Exception) {
            row.put("status","FAIL").put("exception",error.javaClass.name).put("message",error.message)
            error.cause?.let{row.put("cause",it.javaClass.name).put("cause_message",it.message)}
        } finally {
            row.put("elapsed_ms",(System.nanoTime()-started)/1_000_000)
                .put("task_complete",task.isComplete).put("task_successful",task.isSuccessful)
            task.exception?.let{row.put("task_exception",it.javaClass.name).put("task_exception_message",it.message)}
            File(out,"direct.json").writeText(row.toString(2))
            if(task.isComplete)bitmap.recycle() else task.addOnCompleteListener{bitmap.recycle()}
            recognizer.close()
        }
        assertEquals("Direct SDK must become ready before frozen methods", "PASS",row.getString("status"))
        assertTrue("Nonempty raw SDK text required",row.getJSONArray("sdk_lines").length()>0)
        val original=ReferenceOcrProbeTest()
        original.degradedReferencesNeverBypassExactSourceBinding()
        original.sourcePixelViewsWithoutExpectedReferenceHints()
    }
}
