package uk.thewyj.app.qa.v62;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class NativePreviewLoginTest {
  @Test public void loginViaActualNativeUiOnly() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    String pkg = "uk.thewyj.app.v62spatialqa";
    assertEquals(pkg, context.getPackageName());
    File file = new File(context.getFilesDir(), "v62-native-qa-credentials.json");
    JSONObject credentials;
    try { credentials = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)); }
    finally { file.delete(); }
    assertEquals("validation", credentials.getString("scope"));
    String username = credentials.getString("username"), secret = credentials.getString("secret");
    UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    context.startActivity(new Intent().setClassName(pkg, "uk.thewyj.app.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    SystemClock.sleep(8000);
    assertTrue(device.wait(Until.hasObject(By.clazz("android.widget.EditText").pkg(pkg)), 20000));
    List<UiObject2> fields = device.findObjects(By.clazz("android.widget.EditText").pkg(pkg));
    assertEquals(2, fields.size());
    fields.get(0).setText(username);
    SystemClock.sleep(8000);
    assertEquals("UI ACTION_SET_TEXT must preserve the exact ASCII username", username, fields.get(0).getText());
    fields.get(1).setText(secret);
    SystemClock.sleep(8000);
    // ACTION_SET_TEXT does not open the IME. Back here would leave AuthScreen.
    SystemClock.sleep(8000);
    UiObject2 submit = device.findObject(By.text("安全登录").pkg(pkg));
    assertNotNull(submit);
    long start = SystemClock.elapsedRealtime();
    submit.click();
    boolean authenticated = device.wait(Until.hasObject(By.text("主页").pkg(pkg)), 20000);
    long elapsed = SystemClock.elapsedRealtime() - start;
    JSONObject result = new JSONObject().put("actual_native_ui_submission", true).put("exact_username_input", true)
      .put("authenticated_shell", authenticated).put("login_observed_ms", elapsed)
      .put("credential_file_deleted", !file.exists()).put("synthetic_account", true)
      .put("session_injected", false).put("ledger_writes_by_test", 0);
    Files.write(new File(context.getFilesDir(), "v62-native-login-result.json").toPath(), result.toString(2).getBytes(StandardCharsets.UTF_8));
    assertTrue("Actual native authentication must reach its home shell within 20 seconds", authenticated);
  }
}
