package uk.thewyj.app.task21

/**
 * Notification capture contracts. Full notification content stays on-device in
 * the local archive; only the structured parser output is eligible to leave the
 * device, and it never carries raw title/text/bigText/subText/extras.
 */
enum class CaptureCapability {
    NOTIFICATION_ACCESS,
    SMS_PERMISSION,
    ACCESSIBILITY_SERVICE,
}

enum class CapabilityState {
    NOT_IMPLEMENTED,
    NOT_GRANTED,
    GRANTED,
}

interface AndroidCapturePermissionGateway {
    fun state(capability: CaptureCapability): CapabilityState
    fun openSystemSettings(capability: CaptureCapability)
}

enum class FinanceDirection { INCOME, EXPENSE, REFUND, UNKNOWN }

/**
 * Everything a system notification gives us, captured without interpretation.
 *
 * [notificationKey] / [notificationId] / [tag] / [postTime] are the identity
 * inputs: two notifications with identical text but different identity are two
 * real notifications, and content is never used to merge them.
 */
data class NotificationCaptureInput(
    val sourcePackage: String,
    val sourceType: String = "notification",
    val notificationKey: String = "",
    val notificationId: Int = 0,
    val tag: String = "",
    val groupKey: String = "",
    val channelId: String = "",
    val postTime: Long = 0L,
    val isGroup: Boolean = false,
    val isGroupSummary: Boolean = false,
    val title: String = "",
    val text: String = "",
    val bigText: String = "",
    val subText: String = "",
    val infoText: String = "",
    val summaryText: String = "",
    val textLines: List<String> = emptyList(),
    val receivedAtMs: Long = 0L,
)

/**
 * Local archive writer. Implemented by the Room store; kept as an interface so
 * the capture pipeline stays testable without an Android database.
 */
interface NotificationArchiveSink {
    /** True when the capture was persisted (false = filtered out). */
    fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?): Boolean
    fun markRemoved(accountId: String, input: NotificationCaptureInput)
}

enum class NotificationEventType { TRANSACTION, REFUND, MARKETING, VERIFICATION, OTHER }

enum class ParseStatus { PARSED, CANDIDATE, UNPARSED }

/** Parser output. Raw notification text is intentionally absent. */
data class StructuredNotificationEvent(
    val eventId: String,
    val fingerprint: String,
    val sourcePackage: String,
    val eventType: NotificationEventType,
    val parserVersion: String,
    val parseStatus: ParseStatus,
    val direction: FinanceDirection,
    val amountMinor: Long,
    val currency: String,
    val paymentChannel: String,
    val merchant: String,
    val counterparty: String,
    val confidence: Int,
    val occurredAtMs: Long,
    val receivedAtMs: Long,
)

/** Local-only full notification content. Never uploaded, never logged. */
data class LocalNotificationRecord(
    val id: String,
    val eventId: String,
    val fingerprint: String,
    val sourcePackage: String,
    val title: String,
    val text: String,
    val bigText: String,
    val subText: String,
    val receivedAtMs: Long,
    val parseStatus: ParseStatus,
    val direction: FinanceDirection,
    val amountMinor: Long,
    val currency: String,
    val merchant: String,
    val confidence: Int,
)

interface LocalNotificationCaptureStore {
    fun clearForAccount(accountId: String)
}

interface FinanceCandidateQueue {
    fun clearForAccount(accountId: String)
}
