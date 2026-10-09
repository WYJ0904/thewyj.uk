package uk.thewyj.app;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.HashSet;
import java.util.Set;
import java.util.ArrayList;
import java.util.List;
import android.app.UiAutomation;
import android.os.ParcelFileDescriptor;
import java.nio.charset.StandardCharsets;

/** Test APK's own process: only Android/Java runtime, no shared target-app classes. */
public class FormalNotificationObserver extends NotificationListenerService {
    public static void fixtureFile(UiAutomation automation, String path, String content) throws Exception {
        if (!path.startsWith("/sdcard/Android/data/uk.thewyj.app.test/files/")) throw new IllegalArgumentException("Fixture path required");
        ParcelFileDescriptor[] descriptors = automation.executeShellCommandRw("tee " + path);
        try (ParcelFileDescriptor.AutoCloseOutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(descriptors[1])) {
            output.write(content.getBytes(StandardCharsets.UTF_8));
        }
        try (ParcelFileDescriptor.AutoCloseInputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptors[0])) {
            byte[] buffer = new byte[4096];
            while (input.read(buffer) >= 0) { }
        }
    }
    public static List<JSONObject> verifiedJournal(String raw, int id) {
        List<JSONObject> result = new ArrayList<>();
        for (String line : raw.split("\n")) {
            try {
                JSONObject entry = new JSONObject(line);
                if (entry.optInt("id") == id && entry.optString("title").contains("金额核实成功")) result.add(entry);
            } catch (Exception ignored) { }
        }
        return result;
    }
    @Override public void onListenerConnected() {
        File directory = getExternalFilesDir(null);
        if (directory == null) return;
        directory.mkdirs();
        try (FileWriter writer = new FileWriter(new File(directory, "formal-observer-ready"))) {
            writer.write("ready");
        } catch (Exception ignored) { }
    }
    @Override public void onNotificationPosted(StatusBarNotification notification) {
        if (!"uk.thewyj.app".equals(notification.getPackageName())) return;
        File directory = getExternalFilesDir(null);
        if (directory == null) return;
        Set<Integer> allowed = new HashSet<>();
        try (BufferedReader reader = new BufferedReader(new FileReader(new File(directory, "formal-notification-ids")))) {
            String line;
            while ((line = reader.readLine()) != null) allowed.add(Integer.parseInt(line));
        } catch (Exception ignored) { return; }
        if (!allowed.contains(notification.getId())) return;
        try {
            CharSequence title = notification.getNotification().extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence body = notification.getNotification().extras.getCharSequence(Notification.EXTRA_TEXT);
            JSONObject entry = new JSONObject().put("id", notification.getId()).put("post_time", notification.getPostTime())
                .put("title", title == null ? "" : title.toString()).put("body", body == null ? "" : body.toString());
            synchronized (this) {
                try (FileWriter writer = new FileWriter(new File(directory, "formal-fixture-notifications.jsonl"), true)) {
                    writer.write(entry.toString()); writer.write('\n');
                }
            }
        } catch (Exception ignored) { }
    }
}
