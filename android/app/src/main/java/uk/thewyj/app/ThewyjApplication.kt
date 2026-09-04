package uk.thewyj.app

import android.app.Application
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import uk.thewyj.app.core.auth.DeviceIdentityStore
import uk.thewyj.app.core.auth.SecureCredentialStore
import uk.thewyj.app.core.network.ThewyjApiClient
import uk.thewyj.app.core.session.SessionRefreshWorker
import uk.thewyj.app.core.session.SessionRepository
import uk.thewyj.app.core.web.WebSessionBridge
import java.util.concurrent.TimeUnit

class ThewyjApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AppGraph.initialize(this)
        scheduleSessionMaintenance()
    }

    private fun scheduleSessionMaintenance() {
        val request = PeriodicWorkRequestBuilder<SessionRefreshWorker>(12, TimeUnit.HOURS, 2, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            SessionRefreshWorker.UNIQUE_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }
}

object AppGraph {
    lateinit var sessionRepository: SessionRepository
        private set

    fun initialize(application: Application) {
        if (::sessionRepository.isInitialized) return
        sessionRepository = SessionRepository(
            store = SecureCredentialStore(application),
            deviceIdentity = DeviceIdentityStore(application),
            api = ThewyjApiClient(),
            webSession = WebSessionBridge(application, BuildConfig.THEWYJ_BASE_URL),
        )
    }
}
