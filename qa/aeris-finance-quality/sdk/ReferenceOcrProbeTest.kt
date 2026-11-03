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
 @Test fun degradedReferencesNeverBypassExactSourceBinding()=runBlocking {
  val inst=InstrumentationRegistry.getInstrumentation();val out=File(inst.targetContext.filesDir,"reference-corpus").apply{mkdirs()}
  val sdk=MlKitOcrEngine(inst.targetContext);val results=JSONArray()
  val specimens=listOf("letters" to "ABCDEFGHJKLMNPQR","digits" to "202610260123456789","mixed" to "AB0O1I2LZ2026",
   "original-alpha" to "SYNTH-P06-JOINT-123456","low-resolution" to "AB0O1I2LZ2026","blurred" to "AB0O1I2LZ2026",
   "occluded" to "AB0O1I2LZ2026","duplicate-references" to "202610260123456789")
  for((name,reference) in specimens){
   var image=Bitmap.createBitmap(1080,2200,Bitmap.Config.ARGB_8888)
   Canvas(image).apply{drawColor(Color.WHITE);val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.BLACK;textSize=54f;typeface=Typeface.create("sans-serif",Typeface.NORMAL)}
    val lines=listOf("付款详情","付款成功","本次扣除 CNY 90.00","原价 CNY 100.00","优惠 CNY 10.00","交易号 $reference")+(if(name=="duplicate-references")listOf("交易号 OTHER-REF-987654")else emptyList())
    lines.forEachIndexed{i,s->drawText(s,90f,150f+i*145f,paint)}
    if(name=="occluded")drawRect(420f,830f,700f,890f,Paint().apply{color=Color.WHITE})
   }
   if(name in listOf("low-resolution","blurred")){
    val smaller=Bitmap.createScaledBitmap(image,if(name=="blurred")270 else 400,if(name=="blurred")550 else 814,true);image.recycle();image=smaller
   }
   try{
    File(out,"$name.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}
    val lines=sdk.recognize(image);val record=PaymentRecognitionRecord("synthetic-corpus", "synthetic-owner", "WAITING_FOR_ENRICHMENT",1,"com.tencent.mm","NOTIFICATION","synthetic-event",paymentChannel="wechat",amountMinor=null,currency="CNY",direction="EXPENSE",merchant="",providerReference=reference,createdAtMs=1000,updatedAtMs=1000,sourceUid=10390)
    val ticket=PaymentTicketEngine(now={1000L}).create(record.accountId,record.recognitionId,record.sourcePackage,record.sourceEventId,"wechat").copy(sourceUid=10390)
    val packet=uk.thewyj.app.finance.FinanceAiEvidence.capture(record,ticket,null,PaymentPageSnapshot("com.tencent.mm",lines,1000),1000)
    val refs=PaymentScreenshotVerifier.normalizeOcrLines(lines).mapNotNull(PaymentText::providerReference).distinct()
    assertTrue(name,packet==null||refs.singleOrNull()==reference);assertNull(record.amountMinor)
    results.put(JSONObject().put("id",name).put("status","PASS").put("safety_contract","EXACT_REFERENCE_OR_MANUAL_NO_WRITE").put("decoder_exact",refs.singleOrNull()==reference).put("observer_captured",packet!=null).put("sdk_lines",JSONArray(lines)).put("synthetic_only",true).put("ledger_writes",0))
    File(out,"results.json").writeText(results.toString(2))
   }finally{image.recycle()}
  }
  assertEquals(8,results.length())
 }
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
