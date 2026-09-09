package uk.thewyj.app.task21

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import uk.thewyj.app.BuildConfig
import java.util.concurrent.Executors

/**
 * Notification listener service. Real capture requires the user to grant
 * notification access and a physical device; this class only extracts fields
 * and delegates to the testable coordinator, and it does not read SMS or
 * accessibility content.
 */
class ThewyjNotificationListenerService : NotificationListenerService() {
    private val executor = Executors.newSingleThreadExecutor()
    private var coordinator: NotificationCaptureCoordinator? = null
    private var sessionProvider: NotificationSessionProvider? = null

    override fun onListenerConnected() {
        super.onListenerConnected()
        val provider = sessionProvider ?: NotificationSessionProvider(this).also { sessionProvider = it }
        coordinator = coordinator ?: NotificationCaptureCoordinator(
            archiveFor = { accountId -> LocalNotificationArchive.inDirectory(filesDir, accountId) },
            queueFor = { accountId -> NotificationOfflineQueue.inDirectory(filesDir, accountId) },
            transport = HttpNotificationIngestTransport(BuildConfig.THEWYJ_BASE_URL),
            account = provider::currentAccount,
        )
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.isOngoing) return
        val extras = sbn.notification.extras
        val sourcePackage = sbn.packageName ?: ""
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""
        val receivedAtMs = System.currentTimeMillis()
        executor.execute {
            coordinator?.onNotification(sourcePackage, title, text, bigText, subText, receivedAtMs)
            coordinator?.flush()
        }
    }
}

class NotificationAccessGateway(private val context: Context) : AndroidCapturePermissionGateway {
    override fun state(capability: CaptureCapability): CapabilityState {
        if (capability != CaptureCapability.NOTIFICATION_ACCESS) return CapabilityState.NOT_IMPLEMENTED
        return if (isNotificationAccessGranted()) CapabilityState.GRANTED else CapabilityState.NOT_GRANTED
    }

    override fun openSystemSettings(capability: CaptureCapability) {
        if (capability != CaptureCapability.NOTIFICATION_ACCESS) return
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    private fun isNotificationAccessGranted(): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners",
        ) ?: return false
        val component = ComponentName(context, ThewyjNotificationListenerService::class.java)
        return enabled.split(":").any { ComponentName.unflattenFromString(it) == component }
    }
}
