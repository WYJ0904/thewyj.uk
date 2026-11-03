package uk.thewyj.app.task21.payment

import android.graphics.*
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognizer
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test

/** Diagnostic raw reads only; it cannot book and supplies no expected value to OCR. */
class FinanceP06SdkProbeTest {
    @Test fun observeIndependentSecondaryPixels()=runBlocking {
        val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
        val attempt=InstrumentationRegistry.getArguments().getString("closeoutAttempt","r99")!!
        val out=File(context.filesDir,"closeout-$attempt").apply{mkdirs()}
        val cases=JSONArray(instrumentation.context.assets.open("closeout-cases.json").bufferedReader().use{it.readText()})
        for(i in 0 until cases.length()){
            val case=cases.getJSONObject(i);if(case.getString("id") !in setOf("pending-pay","processing","full-width","traditional"))continue
            val lines=case.getJSONArray("lines");val bitmap=Bitmap.createBitmap(1080,2200,Bitmap.Config.ARGB_8888)
            Canvas(bitmap).apply{drawColor(Color.WHITE);val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.BLACK;textSize=54f;typeface=Typeface.create("sans-serif",Typeface.NORMAL)};repeat(lines.length()){drawText(lines.getString(it),90f,150f+it*145f,paint)}}
            val sdk=MlKitOcrEngine(context);val primary=sdk.recognize(bitmap)
            val regionsField=sdk.javaClass.getDeclaredField("amountRegions").apply{isAccessible=true}
            val regions=(regionsField.get(sdk) as List<*>).take(4)
            val recognizer=sdk.javaClass.getDeclaredField("recognizer").apply{isAccessible=true}.get(sdk) as TextRecognizer
            val reads=JSONArray()
            for(region in regions){
                checkNotNull(region);val cls=region.javaClass
                val bounds=cls.getDeclaredField("bounds").apply{isAccessible=true}.get(region) as Rect
                val text=cls.getDeclaredField("text").apply{isAccessible=true}.get(region) as String
                val padding=(bounds.height()/3).coerceAtLeast(8)
                val left=(bounds.left-padding).coerceAtLeast(0);val top=(bounds.top-maxOf(padding,bounds.height()*3)).coerceAtLeast(0)
                val right=(bounds.right+padding).coerceAtMost(bitmap.width);val bottom=(bounds.bottom+padding).coerceAtMost(bitmap.height)
                if(right<=left||bottom<=top)continue
                val crop=Bitmap.createBitmap(bitmap,left,top,right-left,bottom-top);val width=(crop.width*2).coerceAtMost(1600)
                val scaled=Bitmap.createScaledBitmap(crop,width,(crop.height*width/crop.width).coerceAtLeast(1),true)
                val task=recognizer.process(InputImage.fromBitmap(scaled,0))
                try{
                    val raw=Tasks.await(task,10,TimeUnit.SECONDS).textBlocks.flatMap{it.lines.map{line->line.text}}
                    reads.put(JSONObject().put("region_text",text).put("raw_secondary",JSONArray(raw)).put("normalized",JSONArray(PaymentScreenshotVerifier.normalizeOcrLines(raw))))
                }finally{
                    if(task.isComplete){if(scaled!==crop)scaled.recycle();crop.recycle()}
                    else task.addOnCompleteListener{if(scaled!==crop)scaled.recycle();crop.recycle()}
                }
            }
            File(out,"sdk-probe.ndjson").appendText(JSONObject().put("id",case.getString("id")).put("primary",JSONArray(primary)).put("secondary_probes",reads)
                .put("kind","DIAGNOSTIC_NOT_BUSINESS_ACCEPTANCE").put("ledger_writes",0).put("expected_value_supplied_to_sdk",false).toString()+"\n")
            bitmap.recycle()
        }
    }
}
