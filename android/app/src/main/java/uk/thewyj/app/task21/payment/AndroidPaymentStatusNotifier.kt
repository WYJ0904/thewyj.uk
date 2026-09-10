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
        if (message.openPackage.isNotBlank()) {
            launchIntent(message.openPackage)?.let { intent ->
                builder.addAction(0, "打开应用", PendingIntent.getActivity(
                    context,
                    message.notificationId + 1,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ))
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

    companion object {
        const val CHANNEL_ID = "thewyj_financial_recognition"
        const val EXTRA_RECOGNITION_ID = "thewyj_recognition_id"
        const val EXTRA_VERIFY_RECOGNITION_ID = "thewyj_verify_recognition_id"
    }
}
