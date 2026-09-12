package uk.thewyj.app.task21

import android.content.Context
import java.util.concurrent.Executor
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.task21.payment.AndroidPaymentRecognitionHook
import uk.thewyj.app.task21.screenshot.ScreenshotMediaObserver
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

    /**
     * MediaStore screenshot fallback (Task 24.1 R4). It shares the listener's
     * capture executor so a notification callback and its MediaStore row are
     * serialised: the two origins can then merge into one archive event instead
     * of racing each other.
     */
    fun createScreenshotObserver(
        context: Context,
        provider: NotificationSessionProvider,
        executor: Executor,
    ): ScreenshotMediaObserver {
        val app = context.applicationContext
        return ScreenshotMediaObserver(
            context = app,
            account = provider::currentAccount,
            sink = { NotificationArchiveSinkFactory.forContext(app) },
            executor = executor,
        )
    }
}
