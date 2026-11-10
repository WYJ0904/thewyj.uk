package uk.thewyj.app.qa.financep04navigator;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import dalvik.system.PathClassLoader;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import com.google.android.gms.tasks.Tasks;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import java.lang.reflect.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Metadata/menu-only navigation. A selected 0.01 receipt is the only text export scope. */
@RunWith(AndroidJUnit4.class)
public class NavigatorTest {
  static final String QA="uk.thewyj.app.qa.financep04closure";
  static final Set<String> LABELS=new HashSet<>(Arrays.asList("我","服务","钱包","账单","搜索","筛选","按金额","全部账单","取消","返回"));
  Instrumentation inst=InstrumentationRegistry.getInstrumentation();
  String shell(String command)throws Exception {
    try(InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(inst.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).executeShellCommand(command))){return new String(in.readAllBytes(),StandardCharsets.UTF_8);}
  }
  void walk(AccessibilityNodeInfo n,List<AccessibilityNodeInfo> out){if(n==null||out.size()>=4096)return;out.add(n);for(int i=0;i<n.getChildCount();i++)walk(n.getChild(i),out);}
  boolean meSelected(List<AccessibilityNodeInfo> nodes,Rect screen){
    for(AccessibilityNodeInfo n:nodes){Rect b=new Rect();n.getBoundsInScreen(b);if(b.centerY()<screen.height()*.90)continue;
      if(!"我".contentEquals(n.getText()==null?"":n.getText()))continue;
      AccessibilityNodeInfo p=n;for(int i=0;i<4&&p!=null;i++,p=p.getParent())if(p.isSelected()||p.isChecked())return true;
    }return false;
  }
  String hash(byte[] value)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value))s.append(String.format("%02x",b));return s.toString();}
  ClassLoader productLoader()throws Exception{
    assertEquals(PackageManager.SIGNATURE_MATCH,inst.getTargetContext().getPackageManager().checkSignatures(inst.getTargetContext().getPackageName(),QA));
    android.content.pm.ApplicationInfo info=inst.getTargetContext().getPackageManager().getApplicationInfo(QA,0);
    return new PathClassLoader(info.sourceDir,info.nativeLibraryDir,getClass().getClassLoader());
  }
  Object suspendCall(ClassLoader loader,Object receiver,Method method,Object... parameters)throws Exception{
    Class<?> continuation=loader.loadClass("kotlin.coroutines.Continuation");CountDownLatch done=new CountDownLatch(1);Object[] result=new Object[1];
    Object context=loader.loadClass("kotlin.coroutines.EmptyCoroutineContext").getField("INSTANCE").get(null);
    Object bridge=Proxy.newProxyInstance(loader,new Class<?>[]{continuation},(proxy,m,args)->{
      if(m.getName().equals("getContext"))return context;
      if(m.getName().equals("resumeWith")){result[0]=args[0];done.countDown();return null;}
      if(m.getName().equals("toString"))return "FinanceQAContinuation";
      if(m.getName().equals("hashCode"))return System.identityHashCode(proxy);
      if(m.getName().equals("equals"))return proxy==args[0];return null;
    });
    Object[] values=Arrays.copyOf(parameters,parameters.length+1);values[parameters.length]=bridge;
    Object returned=method.invoke(receiver,values);
    Object marker=loader.loadClass("kotlin.coroutines.intrinsics.CoroutineSingletons").getField("COROUTINE_SUSPENDED").get(null);
    if(returned!=marker)return returned;
    assertTrue("Bounded actual OCR coroutine",done.await(15,TimeUnit.SECONDS));
    if(result[0]!=null&&result[0].getClass().getName().equals("kotlin.Result$Failure"))throw new AssertionError("Actual OCR coroutine failed: "+result[0].getClass().getName());
    return result[0];
  }
  Object fullProductOcr(android.graphics.Bitmap bitmap,String currency,JSONObject proof)throws Exception{
    ClassLoader loader=productLoader();Class<?> engineType=loader.loadClass("uk.thewyj.app.task21.payment.MlKitOcrEngine");
    Object engine=engineType.getConstructor(android.content.Context.class).newInstance(inst.getTargetContext());
    Class<?> verifierType=loader.loadClass("uk.thewyj.app.task21.payment.PaymentScreenshotVerifier");
    Object verifier=verifierType.getConstructor(loader.loadClass("uk.thewyj.app.task21.payment.OcrEngine")).newInstance(engine);
    if(proof.optBoolean("synthetic_bitmap")){
      // Diagnostic text is permitted only for these generated, non-private bitmaps.
      Method recognize=null;for(Method m:engineType.getMethods())if(m.getName().equals("recognize"))recognize=m;
      List<?> raw=(List<?>)suspendCall(loader,engine,recognize,bitmap);proof.put("synthetic_ocr_lines",new JSONArray(raw));
      Object companion=verifierType.getField("Companion").get(null);
      List<?> normalized=(List<?>)companion.getClass().getMethod("normalizeOcrLines",List.class).invoke(companion,raw);
      Class<?> snapshot=loader.loadClass("uk.thewyj.app.task21.payment.PaymentPageSnapshot");
      Object page=snapshot.getConstructor(String.class,List.class,long.class,List.class).newInstance("com.tencent.mm",normalized,System.currentTimeMillis(),Collections.emptyList());
      Class<?> semantics=loader.loadClass("uk.thewyj.app.task21.payment.PaymentPageSemantics");
      Object primary=semantics.getMethod("extract",snapshot,String.class,int.class).invoke(semantics.getField("INSTANCE").get(null),page,currency,2);
      moneyFields(proof,"primary_",primary);
      if(primary!=null){Object minor=primary.getClass().getMethod("getAmountMinor").invoke(primary);Object unit=primary.getClass().getMethod("getCurrency").invoke(primary);
        if(minor!=null){
          Field regionsField=engineType.getDeclaredField("amountRegions");regionsField.setAccessible(true);
          List<?> regions=(List<?>)regionsField.get(engine);JSONArray crops=new JSONArray();
          for(Object region:regions){Field boundsField=region.getClass().getDeclaredField("bounds");boundsField.setAccessible(true);Rect bounds=(Rect)boundsField.get(region);
            int pad=Math.max(8,bounds.height()/3),left=Math.max(0,bounds.left-pad),top=Math.max(0,bounds.top-pad),right=Math.min(bitmap.getWidth(),bounds.right+pad),bottom=Math.min(bitmap.getHeight(),bounds.bottom+pad);
            android.graphics.Bitmap crop=android.graphics.Bitmap.createBitmap(bitmap,left,top,right-left,bottom-top);
            int width=Math.min(1600,crop.getWidth()*2);android.graphics.Bitmap scaled=android.graphics.Bitmap.createScaledBitmap(crop,width,Math.max(1,crop.getHeight()*width/crop.getWidth()),true);
            com.google.mlkit.vision.text.TextRecognizer diagnostic=TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
            try{Text text=Tasks.await(diagnostic.process(InputImage.fromBitmap(scaled,0)),10,TimeUnit.SECONDS);JSONArray lines=new JSONArray();for(Text.TextBlock b:text.getTextBlocks())for(Text.Line l:b.getLines())lines.put(l.getText());crops.put(new JSONObject().put("bounds",bounds.toShortString()).put("ocr_lines",lines));}
            finally{diagnostic.close();scaled.recycle();crop.recycle();}
          }proof.put("synthetic_second_scale_regions",crops);
          Method confirm=null;for(Method m:engineType.getMethods())if(m.getName().equals("confirmAmount")&&m.getParameterCount()==4)confirm=m;
          if(confirm!=null){Object value=suspendCall(loader,engine,confirm,bitmap,minor,unit);proof.put("synthetic_confirmation_minor",value==null?JSONObject.NULL:value);}
        }
      }
    }
    Method selected=null;for(Method method:verifierType.getMethods())if(method.getName().equals("verify")&&(selected==null||method.getParameterCount()>selected.getParameterCount()))selected=method;
    assertNotNull(selected);
    if(selected.getParameterCount()==6){proof.put("runtime_currency_policy",2);return suspendCall(loader,verifier,selected,bitmap,"com.tencent.mm",System.currentTimeMillis(),currency,2);}
    proof.put("runtime_currency_policy",1).put("context_forwarded",false);
    return suspendCall(loader,verifier,selected,bitmap,"com.tencent.mm",System.currentTimeMillis());
  }
  void moneyFields(JSONObject proof,String prefix,Object enrichment)throws Exception{
    proof.put(prefix+"parsed",enrichment!=null);if(enrichment==null)return;
    for(String field:new String[]{"AmountMinor","Currency","Direction","CompletionConfirmed","Confidence"}){
      Object value=enrichment.getClass().getMethod("get"+field).invoke(enrichment);proof.put(prefix+field,value==null?JSONObject.NULL:value instanceof Enum?value.toString():value);
    }
  }
  void save(String name,JSONObject value)throws Exception{
    assertTrue(name.matches("[a-z0-9-]+"));File dir=new File(inst.getTargetContext().getFilesDir(),"closure-proof");dir.mkdirs();File f=new File(dir,name+".json");assertTrue("Preserve prior probe",f.createNewFile());try(FileOutputStream s=new FileOutputStream(f)){s.write(value.toString(2).getBytes(StandardCharsets.UTF_8));}
  }
  static class OcrSafetyFixture {
    final String id,currency,outcome,direction;final String[] lines,required;
    OcrSafetyFixture(String id,String currency,String outcome,String direction,String[] lines,String[] required){
      this.id=id;this.currency=currency;this.outcome=outcome;this.direction=direction;this.lines=lines;this.required=required;
    }
  }
  String compactSyntheticOcr(JSONArray lines)throws Exception{
    StringBuilder text=new StringBuilder();for(int i=0;i<lines.length();i++)text.append(lines.getString(i));
    return text.toString().toUpperCase(Locale.ROOT).replaceAll("\\s+","").replace('￥','¥');
  }
  JSONArray rawSyntheticSdkLines(android.graphics.Bitmap bitmap)throws Exception{
    com.google.mlkit.vision.text.TextRecognizer sdk=TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
    try{Text text=Tasks.await(sdk.process(InputImage.fromBitmap(bitmap,0)),10,TimeUnit.SECONDS);JSONArray lines=new JSONArray();
      for(Text.TextBlock block:text.getTextBlocks())for(Text.Line line:block.getLines())lines.put(line.getText());return lines;
    }finally{sdk.close();}
  }
  void ocrSafetyMatrix(String name)throws Exception{
    // These are generated pixels, never substituted recognizer output. The old seven fixtures remain separate.
    OcrSafetyFixture[] fixtures={
      new OcrSafetyFixture("ambiguous-yen-without-default",null,"reject","",new String[]{"交易详情","支付成功","¥100.00"},new String[]{"交易详情","支付成功","¥100.00"}),
      new OcrSafetyFixture("yen-conflicts-with-usd-default","USD","reject","",new String[]{"交易详情","支付成功","¥100.00"},new String[]{"交易详情","支付成功","¥100.00"}),
      new OcrSafetyFixture("jpy-fraction-is-invalid",null,"reject","",new String[]{"交易详情","支付成功","JPY 100.50"},new String[]{"交易详情","支付成功","JPY100.50"}),
      new OcrSafetyFixture("explicit-usd-eur-conflict",null,"reject","",new String[]{"交易详情","支付成功","USD 1.00","EUR 2.00"},new String[]{"交易详情","支付成功","USD1.00","EUR2.00"}),
      new OcrSafetyFixture("multiple-amounts-without-decisive-label",null,"reject","",new String[]{"交易详情","支付成功","CNY 1.00","CNY 2.00"},new String[]{"交易详情","支付成功","CNY1.00","CNY2.00"}),
      new OcrSafetyFixture("chat-is-not-a-payment-page","USD","reject","",new String[]{"聊天","晚上给你","USD 1.00"},new String[]{"聊天","USD1.00"}),
      new OcrSafetyFixture("product-price-is-not-a-payment-page","USD","reject","",new String[]{"商品详情","商品价格","USD 1.00","立即购买"},new String[]{"商品价格","USD1.00","立即购买"}),
      new OcrSafetyFixture("password-page-is-not-evidence","USD","reject","",new String[]{"交易详情","支付成功","USD 1.00","请输入支付密码"},new String[]{"交易详情","支付成功","USD1.00","密码"}),
      new OcrSafetyFixture("pending-incoming-must-not-complete",null,"pending","INCOME",new String[]{"转账详情","待你收款","CNY 0.01","转账时间"},new String[]{"转账详情","待你收款","CNY0.01","转账时间"}),
      new OcrSafetyFixture("pending-outgoing-must-not-complete",null,"pending","EXPENSE",new String[]{"转账详情","待对方收款","CNY 0.01","转账时间"},new String[]{"转账详情","待对方收款","CNY0.01","转账时间"})
    };
    JSONArray rows=new JSONArray();int failures=0,notTested=0;
    for(OcrSafetyFixture fixture:fixtures){
      android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(1000,1400,android.graphics.Bitmap.Config.ARGB_8888);
      android.graphics.Canvas canvas=new android.graphics.Canvas(bitmap);canvas.drawColor(android.graphics.Color.WHITE);
      android.graphics.Paint paint=new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);paint.setColor(android.graphics.Color.BLACK);
      int[] baselines={140,260,480,680,880};for(int i=0;i<fixture.lines.length;i++){
        paint.setTextSize(fixture.lines[i].matches(".*[0-9].*")?100:64);canvas.drawText(fixture.lines[i],100,baselines[i],paint);
      }
      JSONObject row=new JSONObject().put("id",fixture.id).put("synthetic_bitmap",true).put("synthetic_input_lines",new JSONArray(Arrays.asList(fixture.lines)))
        .put("default_currency",fixture.currency==null?JSONObject.NULL:fixture.currency).put("expected_outcome",fixture.outcome)
        .put("required_observed_ocr",new JSONArray(Arrays.asList(fixture.required)));
      try{
        JSONArray sdkLines=rawSyntheticSdkLines(bitmap);row.put("synthetic_sdk_raw_lines",sdkLines);
        Object result=fullProductOcr(bitmap,fixture.currency,row);moneyFields(row,"",result);
        String sdk=compactSyntheticOcr(sdkLines),engine=compactSyntheticOcr(row.getJSONArray("synthetic_ocr_lines"));JSONArray missing=new JSONArray();
        for(String required:fixture.required){String key=required.toUpperCase(Locale.ROOT).replaceAll("\\s+","").replace('￥','¥');
          if(!sdk.contains(key)||!engine.contains(key))missing.put(required);
        }
        row.put("missing_observed_ocr",missing).put("sdk_and_product_input_verified",missing.length()==0);
        if(missing.length()!=0){row.put("status","NOT_TESTED").put("reason","Actual SDK/product OCR did not retain required scenario evidence; null output is not a safety PASS");notTested++;}
        else{
          boolean ok;
          if(fixture.outcome.equals("reject")){
            ok=result==null;row.put("assertion","Product enrichment must be null after the required evidence is actually recognized");
          }else{
            row.put("expected_currency","CNY").put("expected_minor",1).put("expected_direction",fixture.direction).put("expected_completion",false);
            ok=result!=null&&row.optLong("AmountMinor",-1)==1L&&"CNY".equals(row.optString("Currency"))
              &&fixture.direction.equals(row.optString("Direction"))&&row.has("CompletionConfirmed")&&!row.getBoolean("CompletionConfirmed");
            row.put("assertion","Exact CNY 0.01 and side-specific direction may enrich; completion must remain false");
          }
          row.put("status",ok?"PASS":"FAIL");if(!ok)failures++;
        }
      }catch(Throwable error){row.put("status","FAIL").put("error_type",error.getClass().getSimpleName());failures++;}
      finally{bitmap.recycle();}rows.put(row);
    }
    save(name,new JSONObject().put("cases",rows).put("count",fixtures.length).put("failures",failures).put("not_tested",notTested)
      .put("actual_installed_product_ocr",true).put("real_payment",false).put("scope","Generated bitmaps through bundled SDK and the installed product verifier; no injected OCR output or financial write"));
    assertEquals("All required scenario evidence must actually be recognized",0,notTested);
    assertEquals("Currency, context and pending-completion safety assertions",0,failures);
  }
  @Test public void scopedOperation()throws Exception {
    Bundle args=InstrumentationRegistry.getArguments();String op=args.getString("operation","inspect");String name=args.getString("proof_name");assertNotNull(name);
    UiAutomation ui=inst.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
    android.accessibilityservice.AccessibilityServiceInfo service=ui.getServiceInfo();
    service.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
    ui.setServiceInfo(service);
    AccessibilityNodeInfo root=ui.getRootInActiveWindow();assertNotNull("Active window required",root);
    if(op.equals("qa-ocr-safety")){ocrSafetyMatrix(name);return;}
    if(op.equals("qa-ocr-money")){
      String[][] fixtures={{"CNY","¥100.00","CNY","10000"},{"JPY","¥100","JPY","100"},{"USD","$1.00","USD","100"},{"EUR","€1.00","EUR","100"},{"HKD","HK$1.00","HKD","100"},{"GBP","£1.00","GBP","100"},{"UNKNOWN","¥1.00","","0"}};
      JSONArray rows=new JSONArray();int failures=0;
      for(String[] fixture:fixtures){
        android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(900,1200,android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas canvas=new android.graphics.Canvas(bitmap);canvas.drawColor(android.graphics.Color.WHITE);
        android.graphics.Paint paint=new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);paint.setColor(android.graphics.Color.BLACK);paint.setTextSize(64);
        canvas.drawText("交易详情",100,140,paint);canvas.drawText("支付成功",100,260,paint);paint.setTextSize(100);canvas.drawText(fixture[1],100,480,paint);
        JSONObject row=new JSONObject().put("currency",fixture[0]).put("input_text",fixture[1]).put("default_currency",fixture[2]).put("expected_minor",Long.parseLong(fixture[3])).put("synthetic_bitmap",true);
        try{Object result=fullProductOcr(bitmap,fixture[2].isEmpty()?null:fixture[2],row);moneyFields(row,"",result);
          boolean ok=fixture[0].equals("UNKNOWN")?result==null:result!=null&&fixture[0].equals(row.optString("Currency"))&&row.optLong("AmountMinor",-1)==Long.parseLong(fixture[3]);
          row.put("status",ok?"PASS":"FAIL");if(!ok)failures++;
        }catch(Throwable error){row.put("status","FAIL").put("error_type",error.getClass().getSimpleName());failures++;}finally{bitmap.recycle();}rows.put(row);
      }
      save(name,new JSONObject().put("cases",rows).put("count",7).put("failures",failures).put("actual_installed_product_ocr",true).put("real_payment",false));
      assertEquals("Original units, account context and second-scale confirmation",0,failures);return;
    }
    if(op.equals("qa-screen")){
      assertEquals(QA,String.valueOf(root.getPackageName()));
      android.os.PowerManager power=inst.getTargetContext().getSystemService(android.os.PowerManager.class);
      android.app.KeyguardManager keyguard=inst.getTargetContext().getSystemService(android.app.KeyguardManager.class);
      assertFalse("Start normally unlocked",keyguard.isKeyguardLocked());
      shell("input keyevent 223");long end=android.os.SystemClock.elapsedRealtime()+5000;
      while(power.isInteractive()&&android.os.SystemClock.elapsedRealtime()<end)Thread.sleep(100);
      assertFalse("Actual display off",power.isInteractive());shell("input keyevent 224");
      // Public OS dismissal succeeds only when the existing trust/unlock state permits it.
      shell("wm dismiss-keyguard");long start=android.os.SystemClock.elapsedRealtime();
      while((!power.isInteractive()||keyguard.isKeyguardLocked())&&android.os.SystemClock.elapsedRealtime()-start<20000)Thread.sleep(100);
      JSONObject proof=new JSONObject().put("screen_off_observed",true).put("interactive",power.isInteractive())
        .put("keyguard_locked",keyguard.isKeyguardLocked()).put("restore_ms",android.os.SystemClock.elapsedRealtime()-start)
        .put("authentication_bypassed",false).put("mode","Separate UiAutomation process; normal OS trust only");
      save(name,proof);assertTrue(power.isInteractive());assertFalse("Owner identity required if secure keyguard remains",keyguard.isKeyguardLocked());return;
    }
    if(op.equals("qa-lifecycle")){
      assertEquals(QA,String.valueOf(root.getPackageName()));JSONArray rounds=new JSONArray();
      for(int round=0;round<30;round++){
        long start=android.os.SystemClock.elapsedRealtime();
        String before=shell("run-as "+QA+" cat files/finance-p04-closure/platform.ndjson");
        int stopped=0,resumedCount=0;for(String line:before.split("\n")){if(line.contains("\"state\":\"STOPPED\""))stopped++;if(line.contains("\"state\":\"RESUMED\""))resumedCount++;}
        shell("input keyevent 3");long until=android.os.SystemClock.elapsedRealtime()+20000;int seen=stopped;
        while(seen<=stopped&&android.os.SystemClock.elapsedRealtime()<until){seen=0;for(String line:shell("run-as "+QA+" cat files/finance-p04-closure/platform.ndjson").split("\n"))if(line.contains("\"state\":\"STOPPED\""))seen++;if(seen<=stopped)Thread.sleep(100);}
        assertTrue("Fresh actual MainActivity STOPPED callback",seen>stopped);
        shell("am start -n "+QA+"/uk.thewyj.app.MainActivity");until=android.os.SystemClock.elapsedRealtime()+20000;seen=resumedCount;
        while(seen<=resumedCount&&android.os.SystemClock.elapsedRealtime()<until){seen=0;for(String line:shell("run-as "+QA+" cat files/finance-p04-closure/platform.ndjson").split("\n"))if(line.contains("\"state\":\"RESUMED\""))seen++;if(seen<=resumedCount)Thread.sleep(100);}
        assertTrue("Fresh actual MainActivity RESUMED callback",seen>resumedCount);
        rounds.put(new JSONObject().put("round",round+1).put("status","PASS").put("ms",android.os.SystemClock.elapsedRealtime()-start));
      }
      save(name,new JSONObject().put("rounds",rounds).put("count",30).put("mode","Normal MainActivity, separate instrumentation target").put("historical_root_cause","INCONCLUSIVE; this is new regression evidence"));return;
    }
    assertEquals("com.tencent.mm",String.valueOf(root.getPackageName()));
    String activities=shell("dumpsys activity activities");String resumed="";
    for(String line:activities.split("\n"))if((line.contains("mResumedActivity:")||line.contains("topResumedActivity="))&&line.contains("com.tencent.mm/"))resumed=line.trim();
    assertFalse("OS source activity required",resumed.isEmpty());
    List<AccessibilityNodeInfo> nodes=new ArrayList<>();walk(root,nodes);Rect screen=new Rect();root.getBoundsInScreen(screen);
    JSONObject result=new JSONObject().put("operation",op).put("package","com.tencent.mm").put("os_activity",resumed)
      .put("captured_at_ms",System.currentTimeMillis()).put("nodes",nodes.size()).put("unrelated_text_exported",false).put("financial_write",false);
    if(op.equals("inspect")||op.equals("menu")){
      if(op.equals("menu")&&resumed.contains("LauncherUI"))assertTrue("Me tab must be selected before inspecting menu labels",meSelected(nodes,screen));
      Set<String> ids=new TreeSet<>(),labels=new TreeSet<>();
      for(AccessibilityNodeInfo n:nodes){if(n.getViewIdResourceName()!=null)ids.add(n.getViewIdResourceName());Rect b=new Rect();n.getBoundsInScreen(b);
        // Never read chat-row text on LauncherUI. Bottom navigation labels only.
        if(resumed.contains("LauncherUI")&&(!op.equals("menu")||b.centerY()<screen.height()*.25)&&b.centerY()<screen.height()*.90)continue;
        String text=String.valueOf(n.getText());if(LABELS.contains(text))labels.add(text);
      }
      result.put("resource_ids",new JSONArray(ids)).put("allowed_labels",new JSONArray(labels)).put("raw_text_captured",false);save(name,result);return;
    }
    if(op.equals("click")){
      String label=args.getString("label");assertTrue("Only nonfinancial menu actions",LABELS.contains(label));
      if(resumed.contains("LauncherUI"))assertTrue(label.equals("我")||label.equals("服务"));
      if(resumed.contains("LauncherUI")&&label.equals("服务"))assertTrue("Me tab required",meSelected(nodes,screen));
      List<AccessibilityNodeInfo> matches=new ArrayList<>();
      for(AccessibilityNodeInfo n:nodes){Rect b=new Rect();n.getBoundsInScreen(b);
        if(label.equals("我")&&b.centerY()<screen.height()*.90)continue;
        if(resumed.contains("LauncherUI")&&label.equals("服务")&&b.centerY()<screen.height()*.25)continue;
        if(label.contentEquals(n.getText()==null?"":n.getText()))matches.add(n);
      }
      assertEquals("Unambiguous observed menu control",1,matches.size());AccessibilityNodeInfo target=matches.get(0);
      while(target!=null&&!target.isClickable())target=target.getParent();assertNotNull(target);
      result.put("clicked_label",label).put("clicked",target.performAction(AccessibilityNodeInfo.ACTION_CLICK));assertTrue(result.getBoolean("clicked"));save(name,result);return;
    }
    if(op.equals("receipt")){
      // No chat containers, wallet home, payment/claim buttons or generic WebViews.
      assertTrue("Selected transfer/bill detail only",resumed.contains("RemittanceDetailUI")||resumed.contains("WalletOrderInfoNewUI"));
      List<String> lines=new ArrayList<>();List<List<String>> groups=new ArrayList<>();for(AccessibilityNodeInfo n:nodes){CharSequence t=n.getText();if(t!=null&&!t.toString().trim().isEmpty())lines.add(t.toString().trim());}
      byte[] png=null;
      if(lines.isEmpty()){
        android.graphics.Bitmap bitmap=ui.takeScreenshot();assertNotNull("System screenshot unavailable; never bypass secure-window restrictions",bitmap);
        com.google.mlkit.vision.text.TextRecognizer recognizer=TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        try{
          Text recognized=Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap,0)),10,TimeUnit.SECONDS);
          for(Text.TextBlock block:recognized.getTextBlocks()){
            List<String> group=new ArrayList<>();for(Text.Line line:block.getLines()){group.add(line.getText());lines.add(line.getText());}groups.add(group);
          }
          ByteArrayOutputStream encoded=new ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,encoded);png=encoded.toByteArray();
          result.put("amount_read_method","Actual bundled ML Kit Chinese 16.0.1 on system screenshot").put("ocr_blocks",groups.size());
        }finally{recognizer.close();bitmap.recycle();}
      }else result.put("amount_read_method","Actual accessibility nodes");
      String joined=String.join("\n",lines);assertTrue("Only the owner's existing 0.01 transaction",joined.matches("(?s).*0[.]01.*"));
      assertFalse(joined.contains("验证码")||joined.contains("支付密码"));
      JSONObject raw=new JSONObject().put("source",result).put("text_lines",new JSONArray(lines));
      if(png!=null){raw.put("screenshot_png_base64",android.util.Base64.encodeToString(png,android.util.Base64.NO_WRAP));result.put("screenshot_sha256",hash(png));}
      byte[] bytes=raw.toString().getBytes(StandardCharsets.UTF_8);
      result.put("receipt_markers",new JSONObject().put("received",joined.contains("已收款")||joined.matches("(?s).*已被.{0,32}领取.*"))
        .put("waiting",joined.contains("待收款")||joined.contains("待你确认")||joined.contains("等待对方收款")||joined.contains("确认收款"))
        .put("returned",joined.contains("已退还")||joined.contains("已退回")));
      File folder=new File(inst.getTargetContext().getFilesDir(),"closure-proof");folder.mkdirs();File keyFile=new File(folder,"receipt-key.bin");byte[] key;
      if(keyFile.exists()){try(FileInputStream f=new FileInputStream(keyFile)){key=f.readAllBytes();}}else{key=new byte[32];new SecureRandom().nextBytes(key);try(FileOutputStream f=new FileOutputStream(keyFile)){f.write(key);}}
      byte[] nonce=new byte[12];new SecureRandom().nextBytes(nonce);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new javax.crypto.spec.SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce));
      File encrypted=new File(folder,name+".aesgcm");assertTrue(encrypted.createNewFile());try(FileOutputStream f=new FileOutputStream(encrypted)){f.write(nonce);f.write(cipher.doFinal(bytes));}
      result.put("raw_sha256",hash(bytes)).put("cipher_sha256",hash(java.nio.file.Files.readAllBytes(encrypted.toPath()))).put("encrypted_evidence",encrypted.getName());
      assertEquals(PackageManager.SIGNATURE_MATCH,inst.getTargetContext().getPackageManager().checkSignatures(inst.getTargetContext().getPackageName(),QA));
      android.content.pm.ApplicationInfo info=inst.getTargetContext().getPackageManager().getApplicationInfo(QA,0);
      ClassLoader loader=new PathClassLoader(info.sourceDir,info.nativeLibraryDir,getClass().getClassLoader());
      Class<?> snapshot=loader.loadClass("uk.thewyj.app.task21.payment.PaymentPageSnapshot");
      Object page=snapshot.getConstructor(String.class,List.class,long.class,List.class).newInstance("com.tencent.mm",lines,System.currentTimeMillis(),groups);
      Class<?> semantics=loader.loadClass("uk.thewyj.app.task21.payment.PaymentPageSemantics");
      Object enrichment=semantics.getMethod("extract",snapshot,String.class,int.class).invoke(semantics.getField("INSTANCE").get(null),page,"CNY",2);
      result.put("parser","Exact installed QA product PaymentPageSemantics.extract; source not modified").put("default_currency","CNY owner-declared").put("parsed",enrichment!=null);
      if(enrichment!=null){for(String field:new String[]{"AmountMinor","Currency","Direction","CompletionConfirmed","Confidence"}){
          Object value=enrichment.getClass().getMethod("get"+field).invoke(enrichment);result.put(field,value==null?JSONObject.NULL:value instanceof Enum?value.toString():value);
        }
        Object reference=enrichment.getClass().getMethod("getProviderReference").invoke(enrichment);
        result.put("provider_reference_sha256",reference==null?JSONObject.NULL:hash(reference.toString().getBytes(StandardCharsets.UTF_8)));
      }
      if(png!=null){android.graphics.Bitmap exact=android.graphics.BitmapFactory.decodeByteArray(png,0,png.length);
        try{moneyFields(result,"full_product_",fullProductOcr(exact,"CNY",result));}finally{exact.recycle();}
      }
      result.put("raw_text_captured",true).put("raw_text_exported_plain",false).put("ledger_rows_created",0);
      save(name,result);return;
    }
    throw new AssertionError("Operation not allowlisted");
  }
}
