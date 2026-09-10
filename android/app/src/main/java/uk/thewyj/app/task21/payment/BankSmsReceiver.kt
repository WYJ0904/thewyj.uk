package uk.thewyj.app.task21.payment

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import uk.thewyj.app.task21.NotificationSessionProvider
import java.util.concurrent.Executors

/**
 * Bank SMS capture. Only newly received SMS are parsed, only for
 * finance-entitled accounts, and the parser rejects OTP, marketing and balance
 * reminders. Raw SMS text stays on the device.
 */
class BankSmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val pending = goAsync()
        val appContext = context.applicationContext
        executor.execute {
            try {
                val messages = runCatching { Telephony.Sms.Intents.getMessagesFromIntent(intent) }.getOrDefault(emptyArray())
                if (messages.isEmpty()) return@execute
                val account = runCatching { NotificationSessionProvider(appContext).currentAccount() }.getOrNull()
                if (account == null || !account.financeEntitled) return@execute
                val sender = messages.firstOrNull()?.displayOriginatingAddress.orEmpty()
                val body = messages.joinToString(" ") { it.displayMessageBody.orEmpty() }.trim()
                val receivedAt = messages.firstOrNull()?.timestampMillis ?: System.currentTimeMillis()
                if (body.isEmpty()) return@execute
                AndroidPaymentRecognitionHook.get(appContext)
                    .onSms(account.accountId, sender, body, receivedAt)
            } catch (error: Throwable) {
                Log.w("T22PAY", "sms handling failed: ${error.javaClass.simpleName}")
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        private val executor = Executors.newSingleThreadExecutor()
    }
}
