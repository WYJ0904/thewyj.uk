package uk.thewyj.app.task21

import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome

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
    /** `Notification.FLAG_ONGOING_EVENT`: continuous status, never a message. */
    val isOngoing: Boolean = false,
    /** `Notification.FLAG_FOREGROUND_SERVICE`: the app is running a service. */
    val isForegroundService: Boolean = false,
    val title: String = "",
    val text: String = "",
    val bigText: String = "",
    val subText: String = "",
    val infoText: String = "",
    val summaryText: String = "",
    val textLines: List<String> = emptyList(),
    /**
     * Picture Android exposed on the notification, already written to local
     * storage. `mediaState` is "none" (no picture), "available" (stored) or
     * "unavailable" (the notification claimed a picture we could not read).
     */
    val mediaPath: String = "",
    val mediaMime: String = "",
    val mediaState: String = "none",
    /**
     * Bitmap Android exposed on the notification, kept only in memory until the
     * archive sink writes it to private storage. Never uploaded.
     */
    val mediaBitmap: android.graphics.Bitmap? = null,
    /**
     * True when this notification is the system screenshot notice. Screenshots
     * get an evidence identity instead of the platform notification key,
     * because One UI reuses that key for every screenshot it takes.
     */
    val screenshotEvent: Boolean = false,
    /** Evidence fingerprint of the picture (`ms:` / `uri:` / `nfb:`). */
    val mediaFingerprint: String = "",
    /** Explicit archive identity for evidence-driven captures. */
    val identityOverride: String = "",
    /** `Notification.when`, used only for the degraded screenshot identity. */
    val eventTimeMs: Long = 0L,
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

    /**
     * Task 24.1 R4: a screenshot that reached the device through MediaStore
     * rather than the shade (Samsung replaces its screenshot notification in
     * place, so the listener alone loses every later capture). The default keeps
     * test doubles source compatible and reports SKIPPED instead of pretending
     * the screenshot was archived.
     */
    fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent): ScreenshotArchiveOutcome =
        ScreenshotArchiveOutcome.SKIPPED

    /**
     * Canonical finance state for the archived snapshot (`pending`, `confirmed`,
     * `ignored`, `failed`). The default no-op keeps test doubles source
     * compatible; the Room sink persists it.
     */
    fun markFinanceOutcome(accountId: String, sourceEventId: String, state: String, transactionId: String = ""): Boolean = false

    /**
     * Local recognition identity ("notification#<identity>#<postTime>") of the
     * archived capture uploaded under [sourceEventId], or "" when unknown.
     *
     * A pending hint uploaded before the recognition learned its hint event id
     * keeps `uploadEventId = ""`; the server pull can only close it through this
     * archive link. The default keeps test doubles source compatible.
     */
    fun recognitionSourceEventId(accountId: String, sourceEventId: String): String = ""
}

/**
 * Local-only screenshot evidence resolved from MediaStore. The image itself is
 * copied into the app's private storage by the sink; nothing here is uploaded.
 */
data class ScreenshotMediaEvent(
    /** `ms:<rowId>` (or `uri:<sha>` when the row id is unknown). */
    val fingerprint: String,
    val rowId: Long,
    /** App that owns the screenshot row; the system capture app by default. */
    val sourcePackage: String,
    val appLabel: String,
    val title: String,
    val text: String,
    val capturedAtMs: Long,
    /** Absolute content URI the sink imports from. Never persisted as-is. */
    val mediaUri: String,
    val mediaMime: String,
    /** available | unavailable */
    val mediaState: String,
)

/**
 * Finance side of the capture pipeline. Implemented by the payment recognition
 * coordinator so notification/SMS/accessibility all share one pipeline. It is
 * only called for finance-entitled accounts and receives local-only content.
 */
/**
 * One payment outcome shared by the local recognition pipeline and the
 * structured event that is uploaded for finance. `confirmed` means the message
 * itself proves a completed payment (verb + amount); everything else stays a
 * review candidate instead of becoming a ledger entry.
 */
data class PaymentIngestOutcome(
    val confirmed: Boolean,
    val amountMinor: Long,
    val direction: FinanceDirection,
    val confidence: Int,
    val merchant: String,
    val counterparty: String,
    val paymentChannel: String,
    val parserVersion: String,
)

interface PaymentRecognitionHook {
    /**
     * [uploadEventId] is the structured-event identity that this capture was
     * queued under, or blank when the event stays local (an amount-unknown
     * payment hint). The recognition stores it so the app knows whether the
     * booking authority for that payment is the server candidate list (already
     * uploaded) or this device (local-only enrichment).
     */
    fun onCapture(
        accountId: String,
        input: NotificationCaptureInput,
        sourceAppLabel: String,
        uploadEventId: String = "",
    )

    /**
     * Pure parse result for the same capture. Returns null when the message is
     * not a payment at all, so the notification parser stays in charge.
     */
    fun outcomeFor(input: NotificationCaptureInput): PaymentIngestOutcome? = null

    /**
     * The backend confirmed the real ledger identity for an uploaded event.
     * P0-2: this is what closes the local pending state, so a booked transaction
     * stops appearing in 「待核实 / 待确认」.
     */
    fun onFinanceOutcome(accountId: String, eventId: String, transactionId: String) = Unit

    /** User-facing application name for a capture, resolved by the platform. */
    fun appLabelFor(input: NotificationCaptureInput): String = ""
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
