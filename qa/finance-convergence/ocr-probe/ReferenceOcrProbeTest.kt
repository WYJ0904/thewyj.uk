package uk.thewyj.app.task21.payment
import android.graphics.*
import androidx.test.platform.app.InstrumentationRegistry
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.common.InputImage
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ReferenceOcrProbeTest {
 @Test fun sourcePixelViewsWithoutExpectedReferenceHints()=runBlocking {
  val inst=InstrumentationRegistry.getInstrumentation();val out=File(inst.targetContext.filesDir,"reference-probe-r2").apply{mkdirs()}
  val bitmap=inst.context.assets.open("reference-original.png").use{BitmapFactory.decodeStream(it)}!!
  val recognizer=TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build());val busy=AtomicBoolean();val rows=JSONArray()
  suspend fun view(name:String,image:Bitmap):List<com.google.mlkit.vision.text.Text.Line>{
   File(out,"$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}
   val text=withContext(Dispatchers.IO){PaymentOcrTaskLifetime.await(image,busy,{b->recognizer.process(InputImage.fromBitmap(b,0))})}
   val lines=text?.textBlocks?.flatMap{it.lines}.orEmpty();rows.put(JSONObject().put("view",name).put("width",image.width).put("height",image.height).put("lines",JSONArray(lines.map{it.text})))
   File(out,"views.json").writeText(rows.toString(2));return lines
  }
  try{
   val primary=view("original",bitmap)
   for(width in listOf(800,1600)){
    val image=Bitmap.createScaledBitmap(bitmap,width,(bitmap.height.toLong()*width/bitmap.width).toInt(),true)
    try{view("full-$width",image)}finally{image.recycle()}
   }
   val reference=primary.single{it.text.contains("交易号")};val bounds=reference.boundingBox!!
   val top=(bounds.top-bounds.height()).coerceAtLeast(0);val bottom=(bounds.bottom+bounds.height()).coerceAtMost(bitmap.height)
   val crop=Bitmap.createBitmap(bitmap,0,top,bitmap.width,bottom-top)
   try{
    for(width in listOf(1600,2160)){
     val image=Bitmap.createScaledBitmap(crop,width,(crop.height.toLong()*width/crop.width).toInt(),true)
     try{view("reference-$width",image)}finally{image.recycle()}
    }
    val image=Bitmap.createBitmap(crop.width*2,crop.height*2,Bitmap.Config.ARGB_8888)
    Canvas(image).drawBitmap(crop,null,Rect(0,0,image.width,image.height),Paint(Paint.ANTI_ALIAS_FLAG).apply{colorFilter=ColorMatrixColorFilter(ColorMatrix().apply{setSaturation(0f)})})
    try{view("reference-gray",image)}finally{image.recycle()}
   }finally{crop.recycle()}
   assertEquals(6,rows.length())
  }finally{bitmap.recycle();recognizer.close()}
 }
}
