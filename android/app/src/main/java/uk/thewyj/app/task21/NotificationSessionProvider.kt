package uk.thewyj.app.task21

import android.content.Context
import uk.thewyj.app.core.auth.CredentialStorageException
import uk.thewyj.app.core.auth.DeviceIdentityStore
import uk.thewyj.app.core.auth.SecureCredentialStore
import uk.thewyj.app.task21.NotificationCaptureCoordinator.CaptureAccount

/**
 * Reads the current authenticated account directly from the Task 20 Keystore
 * protected credential store. This lets the NotificationListenerService judge
 * account/entitlement state even when MainActivity has never started, without
 * keeping a second session, a plaintext password, or a hardcoded entitlement.
 */
class NotificationSessionProvider(context: Context) {
    private val credentialStore = SecureCredentialStore(context.applicationContext)
    private val deviceIdentity = DeviceIdentityStore(context.applicationContext)

    fun currentAccount(): CaptureAccount? {
        val credentials = try {
            credentialStore.loadActive()
        } catch (_: CredentialStorageException) {
            return null
        } ?: return null

        val account = credentials.account
        val allFeatures = account.isAdmin || account.entitlements.contains("all_features_access")
        // Finance recognition and notification archiving are separate
        // capabilities: finance-only accounts classify in memory and never write
        // ordinary chat into the notification archive.
        val financeEntitled = allFeatures || account.entitlements.contains("finance_access")
        val archiveEntitled = allFeatures || account.entitlements.contains("notification_archive_access")
        if ((!financeEntitled && !archiveEntitled) || credentials.accessToken.isBlank()) return null
        return CaptureAccount(
            accountId = account.id,
            deviceId = deviceIdentity.getOrCreate(),
            sessionToken = credentials.accessToken,
            financeEntitled = financeEntitled,
            archiveEntitled = archiveEntitled,
        )
    }
}

