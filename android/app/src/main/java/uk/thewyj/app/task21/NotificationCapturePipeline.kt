package uk.thewyj.app.task21

import android.content.Context
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.task21.payment.AndroidPaymentRecognitionHook
import uk.thewyj.app.task21.store.NotificationArchiveSinkFactory

/**
 * Single wiring point for the capture pipeline.
 *
 * The notification listener service and the in-app payment verification screen
 * must use the exact same coordinator, ingest queue and transport, otherwise a
 * booking could be queued in one place and flushed from another.
 */
object NotificationCapturePipeline {
    fun create(context: Context, provider: NotificationSessionProvider): NotificationCaptureCoordinator {
        val app = context.applicationContext
        return NotificationCaptureCoordinator(
            archiveFor = { accountId -> LocalNotificationArchive.inDirectory(app.filesDir, accountId) },
            queueFor = { accountId -> NotificationOfflineQueue.inDirectory(app.filesDir, accountId) },
            transport = HttpNotificationIngestTransport(BuildConfig.THEWYJ_BASE_URL),
            account = provider::currentAccount,
            archiveSink = NotificationArchiveSinkFactory.forContext(app),
            paymentHook = AndroidPaymentRecognitionHook.get(app),
        )
    }
}
