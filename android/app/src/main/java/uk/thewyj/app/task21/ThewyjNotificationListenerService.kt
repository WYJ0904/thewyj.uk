package uk.thewyj.app.task21

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.task21.store.NotificationArchiveSinkFactory
import uk.thewyj.app.task21.payment.AndroidPaymentRecognitionHook
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Notification listener. It captures the platform's notification identity
 * (key/id/tag/postTime/groupKey/channel) plus the local-only payload, and
 * delegates classification, archiving and enrichment tickets to the
 * coordinator. It does not read SMS or accessibility content.
 */
class ThewyjNotificationListenerService : NotificationListenerService() {
    /**
     * Capture must never wait for the network. `onNotificationPosted` writes to
     * Room on this single thread; uploads to the backend run on a separate
     * single thread guarded by [flushRunning] so a slow or unreachable API can
     * no longer delay (or drop) incoming notifications.
     */
    private val executor = Executors.newSingleThreadExecutor()
    private val uploadExecutor = Executors.newSingleThreadExecutor()
    private val flushRunning = AtomicBoolean(false)
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
            archiveSink = NotificationArchiveSinkFactory.forContext(this),
            paymentHook = AndroidPaymentRecognitionHook.get(this),
        )
        // A reconnect replays the currently active notifications; the store
        // treats an unchanged revision as a replay and stores nothing new.
        for (active in runCatching { activeNotifications }.getOrDefault(emptyArray())) {
            onNotificationPosted(active)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn ?: return
        if (notification.isOngoing) return
        val input = captureInput(notification)
        val capture = executor.submit { coordinator?.onNotification(input) }
        scheduleFlush(capture)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        val notification = sbn ?: return
        val input = captureInput(notification)
        executor.execute { coordinator?.onRemoved(input) }
    }

    override fun onDestroy() {
        executor.shutdown()
        uploadExecutor.shutdown()
        super.onDestroy()
    }

    private fun scheduleFlush(capture: java.util.concurrent.Future<*>? = null) {
        if (!flushRunning.compareAndSet(false, true)) return
        uploadExecutor.execute {
            try {
                runCatching { capture?.get(5, java.util.concurrent.TimeUnit.SECONDS) }
                // Drain in bounded rounds so notifications that arrive while an
                // upload is in flight are still delivered, without spinning on
                // a failing network.
                for (round in 0 until 3) {
                    val result = coordinator?.flushDetailed() ?: break
                    if (result.pending == 0 || result.authenticationRequired || result.retryableFailures > 0) break
                }
            } finally {
                flushRunning.set(false)
            }
        }
    }

    private fun captureInput(sbn: StatusBarNotification): NotificationCaptureInput {
        val extras = sbn.notification?.extras
        val textLines = extras?.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.map { it?.toString().orEmpty() }
            ?.filter { it.isNotBlank() }
            .orEmpty()
        return NotificationCaptureInput(
            sourcePackage = sbn.packageName.orEmpty(),
            sourceType = "notification",
            notificationKey = sbn.key.orEmpty(),
            notificationId = sbn.id,
            tag = sbn.tag.orEmpty(),
            groupKey = sbn.groupKey.orEmpty(),
            channelId = sbn.notification?.channelId.orEmpty(),
            postTime = sbn.postTime,
            isGroup = sbn.isGroup,
            isGroupSummary = sbn.notification != null &&
                (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0,
            title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty(),
            text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty(),
            bigText = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty(),
            subText = extras?.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString().orEmpty(),
            infoText = extras?.getCharSequence(Notification.EXTRA_INFO_TEXT)?.toString().orEmpty(),
            summaryText = extras?.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString().orEmpty(),
            textLines = textLines,
            receivedAtMs = System.currentTimeMillis(),
        )
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
