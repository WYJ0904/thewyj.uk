package uk.thewyj.app.task21.payment

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import uk.thewyj.app.MainActivity
import uk.thewyj.app.R

/**
 * Posts the payment recognition status notifications.
 *
 * The channel is dedicated ("财务识别") and separate from the upload foreground
 * channel. When the user has not granted POST_NOTIFICATIONS the notifier reports
 * false; the recognition itself continues and the in-app list stays available.
 */
class AndroidPaymentStatusNotifier(private val context: Context) : PaymentStatusNotifier {
    private val manager get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    @SuppressLint("MissingPermission") // canPost() checks POST_NOTIFICATIONS; posting is also wrapped.
    override fun notify(message: PaymentStatusNotificationMessage): Boolean {
        if (!canPost()) return false
        ensureChannel()
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(message.title)
            .setContentText(message.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message.body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setContentIntent(openAppIntent(message.recognitionId))
        if (message.offerManualVerification) {
            builder.addAction(
                0,
                "核实交易金额",
                verificationIntent(message.recognitionId),
            )
        }
        // Task 24.x P0: "打开应用" used to launch the *source* app package
        // (e.g. com.tencent.mm). That is wrong twice over: the user expects
        // thewyj, and a disabled/removed source app made the tap do nothing at
        // all. thewyj actions now always target thewyj; the source app keeps a
        // clearly separate, explicitly labelled action.
        builder.addAction(
            0,
            "查看交易",
            openAppIntent(message.recognitionId),
        )
        if (message.openPackage.isNotBlank()) {
            sourceAppAction(message.openPackage)?.let { pending ->
                builder.addAction(
                    0,
                    "打开来源应用",
                    pending,
                )
            }
        }
        return runCatching {
            NotificationManagerCompat.from(context).notify(message.notificationId, builder.build())
            true
        }.getOrDefault(false)
    }

    override fun cancel(notificationId: Int) {
        runCatching { NotificationManagerCompat.from(context).cancel(notificationId) }
    }

    fun canPost(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val existing = manager.getNotificationChannel(CHANNEL_ID)
        if (existing != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "财务识别",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = "支付识别结果、金额核实与记账状态" },
        )
    }

    private fun openAppIntent(recognitionId: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (recognitionId.isNotBlank()) putExtra(EXTRA_RECOGNITION_ID, recognitionId)
        }
        return PendingIntent.getActivity(
            context,
            recognitionId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun verificationIntent(recognitionId: String): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(EXTRA_VERIFY_RECOGNITION_ID, recognitionId)
        }
        return PendingIntent.getActivity(
            context,
            recognitionId.hashCode() + 7,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun launchIntent(packageName: String): Intent? =
        context.packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

    /**
     * The 来源 App action is only offered when Android can actually launch that
     * package. A removed, disabled or suspended source app used to leave a
     * button that did nothing at all; the notification now simply omits it.
     */
    private fun sourceAppAction(packageName: String): PendingIntent? {
        val intent = launchIntent(packageName) ?: return null
        val enabled = runCatching {
            context.packageManager.getApplicationInfo(packageName, 0).enabled
        }.getOrDefault(false)
        val resolvable = runCatching {
            context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null
        }.getOrDefault(false)
        if (!SourceAppActionPolicy.shouldOffer(enabled = enabled, resolvable = resolvable)) return null
        return PendingIntent.getActivity(
            context,
            packageName.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        const val CHANNEL_ID = "thewyj_financial_recognition"
        const val EXTRA_RECOGNITION_ID = "thewyj_recognition_id"
        const val EXTRA_VERIFY_RECOGNITION_ID = "thewyj_verify_recognition_id"
    }
}

/** Pure decision so the "dead button" rule is unit-tested without a device. */
object SourceAppActionPolicy {
    fun shouldOffer(enabled: Boolean, resolvable: Boolean): Boolean = enabled && resolvable
}
