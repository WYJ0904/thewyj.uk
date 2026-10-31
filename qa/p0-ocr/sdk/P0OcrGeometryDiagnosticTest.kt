package uk.thewyj.app.task21.payment

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import androidx.test.platform.app.InstrumentationRegistry
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Synthetic source pixels only. No expected reference enters detection, cropping or OCR. */
class P0OcrGeometryDiagnosticTest {
    private val rows = JSONArray()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private var folder = "p0-ocr-geometry"
    private val out get() = File(inst.targetContext.filesDir,folder).apply { mkdirs() }
    private val modelBusy = mapOf("chinese" to AtomicBoolean(),"latin" to AtomicBoolean())
    private val referenceLabel = Regex("交易号|交易號|订单号|訂單號|流水号|流水號|参考号|參考號|reference|transaction",RegexOption.IGNORE_CASE)
    // Union all observed ASCII fragments, including short chunks. Selecting
    // only long elements could crop away a real prefix split by the detector.
    private val opaqueElement = Regex("[A-Za-z0-9._-]+")

    private fun bounds(rect:Rect?):Any = rect?.let { JSONArray(listOf(it.left,it.top,it.right,it.bottom)) } ?: JSONObject.NULL
    private fun hash(bytes:ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun rowLine(line:Text.Line):JSONObject = JSONObject().put("text",line.text).put("box",bounds(line.boundingBox))
        .put("confidence",line.confidence).put("angle",line.angle).put("language",line.recognizedLanguage)
        .put("elements",JSONArray(line.elements.map { e -> JSONObject().put("text",e.text).put("box",bounds(e.boundingBox)) }))

    private suspend fun read(model:String,client:TextRecognizer,view:String,bitmap:Bitmap,rotation:Int=0):Text? {
        val file=File(out,"$view.png")
        if(!file.exists())file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
        val started=System.nanoTime()
        val row=JSONObject().put("model",model).put("view",view).put("width",bitmap.width).put("height",bitmap.height)
            .put("bitmap_config",bitmap.config?.name).put("color_space",bitmap.colorSpace?.name)
            .put("density",bitmap.density).put("has_alpha",bitmap.hasAlpha()).put("input_rotation",rotation)
            .put("png_sha256",hash(file.readBytes())).put("expected_reference_hint",false).put("ledger_writes",0)
        val result=withContext(Dispatchers.IO) {
            PaymentOcrTaskLifetime.await(bitmap,modelBusy.getValue(model),{ b -> client.process(InputImage.fromBitmap(b,rotation)) })
        }
        val rawLines=result?.textBlocks?.flatMap { it.lines }?.map { it.text }.orEmpty()
        val parsed=PaymentPageSemantics.extract(PaymentPageSnapshot("synthetic.qa.ocr",rawLines,0L),null,2)
        row.put("semantic_fields",JSONObject().put("amount_minor",parsed?.amountMinor?:JSONObject.NULL)
            .put("currency",parsed?.currency?:JSONObject.NULL).put("direction",parsed?.direction?.name?:JSONObject.NULL)
            .put("provider_reference",parsed?.providerReference?:JSONObject.NULL).put("completion_confirmed",parsed?.completionConfirmed?:false)
            .put("page_state",PaymentPageEvidence.classify(rawLines).name).put("os_source_proven",false)
            .put("settlement_authority_proven",false).put("automatic_booking_authorized",false))
        row.put("elapsed_ms",(System.nanoTime()-started)/1_000_000).put("status",if(result==null)"SDK_FAILED_OR_TIMED_OUT" else "EXECUTED")
            .put("lines",JSONArray(result?.textBlocks?.flatMap { it.lines }?.map(::rowLine).orEmpty()))
        rows.put(row);File(out,"results.json").writeText(rows.toString(2))
        return result
    }

    private fun padded(image:Bitmap,rect:Rect,pad:Int):Bitmap {
        val left=(rect.left-pad).coerceAtLeast(0);val top=(rect.top-pad).coerceAtLeast(0)
        val right=(rect.right+pad).coerceAtMost(image.width);val bottom=(rect.bottom+pad).coerceAtMost(image.height)
        require(right>left&&bottom>top)
        return Bitmap.createBitmap(image,left,top,right-left,bottom-top)
    }

    @Test fun coldProcessOriginalDirect()=runBlocking {
        folder="p0-ocr-cold"
        val bytes=inst.context.assets.open("reference-original.png").use { it.readBytes() }
        val bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.size)
        val sdk=TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        try {
            File(out,"context.json").writeText(JSONObject().put("process_cold",true).put("device_rebooted",false)
                .put("raw_asset_sha256",hash(bytes)).put("product_timeout_ms",PaymentOcrTaskLifetime.TIMEOUT_MS).toString(2))
            val result=read("chinese",sdk,"cold-source",bitmap)
            assertNotNull("Cold task must complete within the existing product timeout",result)
            assertTrue("Actual recognized text required",result!!.textBlocks.flatMap { it.lines }.isNotEmpty())
        }finally {bitmap.recycle();sdk.close()}
    }

    @Test fun originalFrozenMethodsThenUnhintedGeometry()=runBlocking {
        // These methods and the image remain byte-for-byte unchanged.
        ReferenceOcrProbeTest().degradedReferencesNeverBypassExactSourceBinding()
        ReferenceOcrProbeTest().sourcePixelViewsWithoutExpectedReferenceHints()
        val bytes=inst.context.assets.open("reference-original.png").use { it.readBytes() }
        val bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.size)
        val chinese=TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        val latin=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        try {
            val baseline=read("chinese",chinese,"source-identity",bitmap)
            read("latin",latin,"source-identity",bitmap)
            val referenceLines=baseline?.textBlocks?.flatMap { it.lines }?.filter { referenceLabel.containsMatchIn(it.text) }.orEmpty()
            val geometry=JSONObject().put("original_png_sha256",hash(bytes)).put("labelled_line_count",referenceLines.size)
                .put("selection_uses_only_observed_labels_and_element_geometry",true)
                .put("lines",JSONArray(referenceLines.map(::rowLine)))
            File(out,"geometry.json").writeText(geometry.toString(2))
            for((index,line)in referenceLines.withIndex()) {
                val box=line.boundingBox?:continue
                val regions=mutableListOf("line-$index" to padded(bitmap,box,box.height().coerceAtLeast(8)))
                val tokenBoxes=line.elements.filter { opaqueElement.matches(it.text) && it.text.any(Char::isLetterOrDigit) }.mapNotNull { it.boundingBox }
                if(tokenBoxes.isNotEmpty()) {
                    val token=Rect(tokenBoxes.first());tokenBoxes.drop(1).forEach(token::union)
                    regions += "value-$index" to padded(bitmap,token,(box.height()/2).coerceAtLeast(8))
                }
                for((name,crop)in regions)try {
                    for((view,targetHeight)in listOf("native" to box.height(),"glyph24" to 24,"glyph36" to 36,"glyph48" to 48)) {
                        val width=(crop.width.toDouble()*targetHeight/box.height().coerceAtLeast(1)).toInt().coerceAtLeast(1)
                        val scaled=Bitmap.createScaledBitmap(crop,width,(crop.height.toLong()*width/crop.width).toInt().coerceAtLeast(1),true)
                        try { read("chinese",chinese,"$name-$view",scaled);read("latin",latin,"$name-$view",scaled) }
                        finally { if(scaled!==crop)scaled.recycle() }
                    }
                    val gray=Bitmap.createBitmap(crop.width,crop.height,Bitmap.Config.ARGB_8888)
                    Canvas(gray).drawBitmap(crop,0f,0f,Paint().apply { colorFilter=ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) }) })
                    try { read("chinese",chinese,"$name-gray",gray);read("latin",latin,"$name-gray",gray) }finally { gray.recycle() }
                }finally { if(crop!==bitmap)crop.recycle() }
            }
            val rgb565=bitmap.copy(Bitmap.Config.RGB_565,false)
            try { read("chinese",chinese,"source-rgb565",rgb565);read("latin",latin,"source-rgb565",rgb565) }finally { rgb565.recycle() }
            for(degrees in listOf(90,180,270)) {
                val rotated=Bitmap.createBitmap(bitmap,0,0,bitmap.width,bitmap.height,Matrix().apply{postRotate(degrees.toFloat())},true)
                try { read("chinese",chinese,"rotation-$degrees-corrected",rotated,(360-degrees)%360);read("latin",latin,"rotation-$degrees-corrected",rotated,(360-degrees)%360) }
                finally { if(rotated!==bitmap)rotated.recycle() }
            }
            assertTrue("Raw diagnostic must complete at least original+geometry+orientation controls",rows.length()>=10)
        }finally {bitmap.recycle();chinese.close();latin.close()}
    }
}
