package uk.thewyj.app.task21

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.task21.screenshot.ScreenshotEvidence
import uk.thewyj.app.task21.screenshot.ScreenshotMediaObserver
import uk.thewyj.app.task21.store.NotificationArchiveSinkFactory
import uk.thewyj.app.task21.store.NotificationMediaStore
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
    private var screenshotObserver: ScreenshotMediaObserver? = null
    private val mediaStore by lazy { NotificationMediaStore(applicationContext) }
    private var networkRetryRegistered = false

    /**
     * Test seam: replaces the real drain. Production leaves this null and every
     * trigger runs [scheduleFlush].
     */
    internal var pendingFlushOverride: (() -> Unit)? = null

    /**
     * A captured notification that could not be uploaded (offline, timeout) used
     * to wait for the *next* notification before anything retried it: the queue
     * had no network-recovery trigger and an empty shade replayed nothing. The
     * money was already identified on the device but stayed out of Finance until
     * the user opened the archive or a new notification arrived.
     */
    internal val networkRetryCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            requestPendingFlush()
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        val provider = sessionProvider ?: NotificationSessionProvider(this).also { sessionProvider = it }
        // Same pipeline instance wiring as the in-app verification screen.
        coordinator = coordinator ?: NotificationCapturePipeline.create(this, provider)
        // A reconnect replays the currently active notifications; the store
        // treats an unchanged revision as a replay and stores nothing new.
        for (active in runCatching { activeNotifications }.getOrDefault(emptyArray())) {
            onNotificationPosted(active)
        }
        // Samsung replaces its screenshot notification in place, so the
        // notification callback alone cannot prove how many screenshots exist.
        // MediaStore is observed as an independent source while the full image
        // read grant is held.
        val observer = screenshotObserver
            ?: NotificationCapturePipeline.createScreenshotObserver(this, provider, executor)
                .also { screenshotObserver = it }
        observer.start()
        registerNetworkRetry()
        // Always try to drain the pending ingest queue, even when the shade is
        // empty and nothing is replayed: this is the process-start/rebind path.
        requestPendingFlush()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn ?: return
        val input = captureInput(notification)
        // Archive by default: ongoing/progress/system/group-summary notices are
        // real notifications in the shade and must be recorded unless the user
        // explicitly disabled the app in the selector.
        val traceId = CaptureTrace.traceId(input.notificationKey, input.sourcePackage, input.notificationId)
        CaptureTrace.begin(traceId, input.sourcePackage, input.postTime, input.channelId)
        val capture = executor.submit { coordinator?.onNotification(input) }
        scheduleFlush(capture)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        val notification = sbn ?: return
        val input = captureInput(notification)
        executor.execute { coordinator?.onRemoved(input) }
    }

    override fun onDestroy() {
        unregisterNetworkRetry()
        screenshotObserver?.stop()
        executor.shutdown()
        uploadExecutor.shutdown()
        super.onDestroy()
    }

    /**
     * Android may drop the listener while the device is idle. Rebind so the app
     * keeps receiving notifications instead of silently going stale until the
     * user reopens the app.
     */
    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        runCatching {
            requestRebind(ComponentName(this, ThewyjNotificationListenerService::class.java))
        }
    }

    internal fun requestPendingFlush() {
        val override = pendingFlushOverride
        if (override != null) {
            override()
            return
        }
        scheduleFlush()
    }

    private fun registerNetworkRetry() {
        if (networkRetryRegistered) return
        val manager = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return
        networkRetryRegistered = runCatching {
            manager.registerDefaultNetworkCallback(networkRetryCallback)
            true
        }.getOrDefault(false)
    }

    private fun unregisterNetworkRetry() {
        if (!networkRetryRegistered) return
        networkRetryRegistered = false
        val manager = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return
        runCatching { manager.unregisterNetworkCallback(networkRetryCallback) }
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
        val flags = sbn.notification?.flags ?: 0
        // Task 24.1 P0-1: screenshots and image notifications must keep their
        // picture (and must never be dropped just because the body is empty).
        val picture = runCatching {
            (extras?.get(Notification.EXTRA_PICTURE) as? android.graphics.Bitmap)
                ?: (extras?.get(Notification.EXTRA_LARGE_ICON_BIG) as? android.graphics.Bitmap)
                ?: (extras?.get(Notification.EXTRA_LARGE_ICON) as? android.graphics.Bitmap)
        }.getOrNull()
        val mediaHint = runCatching {
            extras?.containsKey(Notification.EXTRA_PICTURE) == true ||
                extras?.containsKey(Notification.EXTRA_PICTURE_ICON) == true ||
                extras?.containsKey(Notification.EXTRA_LARGE_ICON_BIG) == true
        }.getOrDefault(false)
        val title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val bigText = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()
        val screenshotEvent = ScreenshotEvidence.isScreenshotEvent(
            sourcePackage = sbn.packageName.orEmpty(),
            channelId = sbn.notification?.channelId.orEmpty(),
            title = title,
            text = text,
            bigText = bigText,
            hasMedia = picture != null || mediaHint,
        )
        // Only screenshots pay for the pixel fingerprint: One UI reuses one
        // notification key for every capture, so their evidence - not the key -
        // decides whether this is a new snapshot or a replay.
        val mediaFingerprint = if (screenshotEvent) mediaStore.fingerprint(picture) else ""
        if (screenshotEvent) {
            CaptureTrace.stage(
                CaptureTrace.traceId(sbn.key.orEmpty(), sbn.packageName.orEmpty(), sbn.id),
                "screenshot-detected",
                "origin=notification pkg=${sbn.packageName.orEmpty()} " +
                    "media=${if (picture != null) "bitmap" else if (mediaHint) "hint" else "none"} " +
                    "evidence=${mediaFingerprint.ifBlank { "-" }}",
            )
        }
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
            // The classification layer uses the real platform flags: ongoing and
            // foreground-service status must never flood the archive.
            isOngoing = (flags and Notification.FLAG_ONGOING_EVENT) != 0,
            isForegroundService = (flags and Notification.FLAG_FOREGROUND_SERVICE) != 0,
            title = title,
            text = text,
            bigText = bigText,
            subText = extras?.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString().orEmpty(),
            infoText = extras?.getCharSequence(Notification.EXTRA_INFO_TEXT)?.toString().orEmpty(),
            summaryText = extras?.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString().orEmpty(),
            textLines = textLines,
            mediaBitmap = picture,
            mediaState = when {
                picture != null -> "available"
                mediaHint -> "unavailable"
                else -> "none"
            },
            screenshotEvent = screenshotEvent,
            mediaFingerprint = mediaFingerprint,
            eventTimeMs = sbn.notification?.`when` ?: 0L,
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
