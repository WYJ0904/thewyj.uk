package uk.thewyj.app.task21.payment

import android.graphics.BitmapFactory
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** No expected strings, reference hints, substitutions, or financial authority. */
class LatinReferenceDiagnosticTest {
    @Test fun samePixelsWithIndependentLatinRecognizer()=runBlocking {
        val ctx=InstrumentationRegistry.getInstrumentation().targetContext
        val out=File(ctx.filesDir,"latin-diagnostic").apply{mkdirs()}
        val sdk=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val rows=JSONArray()
        val views=File(ctx.filesDir,"reference-probe-r2").listFiles()!!.filter{it.extension=="png"}.sortedBy{it.name}
        val corpus=File(ctx.filesDir,"reference-corpus").listFiles()!!.filter{it.extension=="png"}.sortedBy{it.name}
        assertEquals(6,views.size);assertEquals(8,corpus.size)
        try {
            for(file in views+corpus) {
                val bitmap=BitmapFactory.decodeFile(file.path)!!
                val row=JSONObject().put("group",if(file in views)"original-six" else "new-eight")
                    .put("view",file.nameWithoutExtension).put("model","bundled-latin-16.0.1")
                    .put("input_sha256",MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString(""){"%02x".format(it)})
                    .put("ledger_writes",0).put("expected_reference_hint",false)
                val started=System.nanoTime()
                try {
                    val text=withContext(Dispatchers.IO){Tasks.await(sdk.process(InputImage.fromBitmap(bitmap,0)),10,TimeUnit.SECONDS)}
                    row.put("status","EXECUTED").put("lines",JSONArray(text.textBlocks.flatMap{it.lines}.map{it.text}))
                } catch(error:Exception) {
                    row.put("status","FAIL").put("exception",error.javaClass.name).put("message",error.message)
                } finally {bitmap.recycle()}
                row.put("elapsed_ms",(System.nanoTime()-started)/1_000_000);rows.put(row)
                File(out,"results.json").writeText(rows.toString(2))
            }
        } finally {sdk.close()}
        assertEquals(14,rows.length())
    }
}
