package uk.thewyj.app.task21.payment

import android.content.Context
import android.content.pm.LauncherApps
import android.os.Process
import android.os.UserHandle
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

/** The authenticated/persisted half of the service; foreground reads stay in the service. */
interface PaymentAccessibilityGateway {
    fun financeAccountId(): String?
    fun activeTicket(accountId: String, sourcePackage: String): PaymentTicket?
    fun activePackages(accountId: String, nowMs: Long): Set<String>
    fun enrich(accountId: String, ticketId: String, enrichment: PaymentEnrichment): EnrichmentOutcome
}

internal class AndroidPaymentAccessibilityGateway(private val context: Context) : PaymentAccessibilityGateway {
    private fun store() = RoomPaymentRecognitionStore(NotificationDatabase.get(context))
    override fun financeAccountId(): String? = NotificationSessionProvider(context).currentAccount()?.takeIf { it.financeEntitled }?.accountId
    override fun activeTicket(accountId: String, sourcePackage: String) = store().activeTicketForPackage(accountId, sourcePackage)
    override fun activePackages(accountId: String, nowMs: Long) = store().activeTicketPackages(accountId, nowMs)
    override fun enrich(accountId: String, ticketId: String, enrichment: PaymentEnrichment): EnrichmentOutcome {
        val store = store()
        val ticket = store.activeTicketForPackage(accountId, enrichment.sourcePackage)
        val record = ticket?.let { store.recognition(accountId, it.recognitionId) }
        val currentProfile = record?.sourceUid?.let {
            UserHandle.getUserHandleForUid(it) == Process.myUserHandle()
        } == true
        val sharedPackage = enrichment.sourcePackage == "com.tencent.mm" || runCatching {
            val launcher = context.getSystemService(LauncherApps::class.java)
            launcher == null || launcher.profiles.any { user ->
                user != Process.myUserHandle() && launcher.getActivityList(enrichment.sourcePackage, user).isNotEmpty()
            }
        }.getOrDefault(true)
        val uncertain = PaymentSourceIdentity.requiresManualReview(
            currentProfile, sharedPackage, record?.providerReference.orEmpty(), enrichment.providerReference.orEmpty())
        return AndroidPaymentRecognitionHook.get(context).onAccessibilityEnrichment(
            accountId, enrichment.copy(sourceInstanceUncertain = uncertain), ticketId)
    }
}

/** Accessibility exposes a package, not a reliable clone user identity. */
internal object PaymentSourceIdentity {
    fun requiresManualReview(currentProfile: Boolean, sharedPackage: Boolean, sourceReference: String, pageReference: String): Boolean {
        val sameReference = sourceReference.isNotBlank() && pageReference == sourceReference
        return (!currentProfile || sharedPackage) && !sameReference
    }
}

/** No exported component. Injection is compiled off in ordinary signed builds. */
object PaymentAccessibilityDeviceTest {
    @Volatile private var value: PaymentAccessibilityGateway? = null
    fun install(gateway: PaymentAccessibilityGateway?) {
        check(BuildConfig.DEBUG || BuildConfig.PAYMENT_DEVICE_TEST) { "Device tests require an explicitly built test candidate" }
        value = gateway
    }
    fun gateway(): PaymentAccessibilityGateway? = if (BuildConfig.DEBUG || BuildConfig.PAYMENT_DEVICE_TEST) value else null
}
