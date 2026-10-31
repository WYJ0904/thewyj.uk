package uk.thewyj.app.task21.payment

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test

/** Diagnostic replay of unchanged original PNGs, never a provider proof or a ledger write. */
class CloseoutScaleProbeTest {
    @Test fun inspectWholePageSdkAtIndependentPixelScales()=runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val out=File(context.filesDir,"closeout-scale-probe-r1");check(out.mkdirs())
        val sdk=MlKitOcrEngine(context)
        for(id in listOf("cny-cent","pending-pay","processing","direction-conflict","traditional")){
            val original=BitmapFactory.decodeFile(File(context.filesDir,"closeout-r1/$id.png").absolutePath)
            try{for(width in listOf(1080,1600,2160,800)){
                val scaled=if(width==original.width)original else Bitmap.createScaledBitmap(original,width,original.height*width/original.width,true)
                try{
                    val lines=sdk.recognize(scaled)
                    File(out,"observations.ndjson").appendText(JSONObject().put("id",id).put("width",width)
                        .put("sdk_lines",JSONArray(lines)).put("synthetic_only",true).put("ledger_writes",0).toString()+"\n")
                }finally{if(scaled!==original)scaled.recycle()}
            }}finally{original.recycle()}
        }
    }
}
