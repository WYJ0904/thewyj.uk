package uk.thewyj.app.core.session

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import uk.thewyj.app.AppGraph

class SessionRefreshWorker(
    appContext: Context,
    workerParameters: WorkerParameters,
) : CoroutineWorker(appContext, workerParameters) {
    override suspend fun doWork(): Result = when (AppGraph.sessionRepository.refresh()) {
        RefreshWorkResult.SUCCESS, RefreshWorkResult.SIGNED_OUT -> Result.success()
        RefreshWorkResult.RETRY -> Result.retry()
    }

    companion object {
        const val UNIQUE_WORK_NAME = "thewyj-device-session-maintenance-v1"
    }
}
