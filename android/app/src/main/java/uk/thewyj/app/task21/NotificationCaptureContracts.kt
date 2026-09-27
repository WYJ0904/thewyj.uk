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
    /** SHA-256 identity of the latest MessagingStyle message, never its text. */
    val messageIdentity: String = "",
    /**
     * Picture Android exposed on the notification, already written to local
     * storage. `mediaState` is "none" (no picture), "available" (stored) or
     * "unavailable" (the notification claimed a picture we could not read).
     */
    val mediaPath: String = "",
    val mediaMime: String = "",
    val mediaState: String = "none",
    /** Content origin: picture, background, message_image, notification, media_store. */
    val mediaOrigin: String = "",
    /**
     * Task 24 reopen #6: content URI Android published instead of a bitmap
     * (BigPictureStyle reference, MessagingStyle message image, background
     * image). The archive sink imports it on its own executor; when the URI
     * cannot be read the row keeps an explicit "unavailable" state.
     */
    val mediaSourceUri: String = "",
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
    /**
     * Canonical payment-event identity for this Android notification lifecycle.
     * The listener-facing registry keeps it stable while the notification key
     * remains active, even when an app changes StatusBarNotification.postTime
     * on every update. It contains no notification text.
     */
    val paymentEventId: String = "",
    /**
     * Task 24 reopen #5: the classifier recognised this capture as an update of
     * the previous one for the same identity (recording timer, live readout).
     * The archive updates its existing row instead of appending a revision, so
     * one updating notification stays one history entry.
     */
    val coalesceWithPrevious: Boolean = false,
    val archiveKind: String = "message",
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

    /** Both current stable and legacy recognition identities for an archived event. */
    fun recognitionSourceEventIds(accountId: String, sourceEventId: String): List<String> =
        listOfNotNull(recognitionSourceEventId(accountId, sourceEventId).takeIf(String::isNotBlank))

    /** Exact reverse archive link; never inferred from amount or capture time alone. */
    fun structuredEventIdsForRecognition(accountId: String, recognitionSourceEventId: String): List<String> = emptyList()

    /** SHA-256 of one persisted archive instance, for exact legacy review repair. */
    fun archivedLifecycleIdentity(accountId: String, structuredEventId: String): String = ""
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
 * structured event that is uploaded for finance. `confirmed` records parser
 * evidence; amount and direction determine whether booking is complete.
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
    val providerReference: String = "",
    /** Structured reason codes only; never notification text. */
    val reasons: List<String> = emptyList(),
    val missingFields: Set<String> = emptySet(),
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

/**
 * Minimal identity store for the payment side of a notification. The archive
 * and finance entitlements are independent, so this registry cannot depend on
 * raw notification history being enabled.
 */
interface PaymentNotificationLifecycleRegistry {
    fun eventId(accountId: String, input: NotificationCaptureInput, payment: PaymentIngestOutcome? = null): String
    fun markRemoved(accountId: String, input: NotificationCaptureInput)
}

/** Process-local default used by pure JVM tests and non-Android callers. */
class InMemoryPaymentNotificationLifecycleRegistry(
    private val idFactory: () -> String = NotificationFingerprint::stableEventId,
) : PaymentNotificationLifecycleRegistry {
    private data class Entry(val eventId: String, val proof: PaymentLifecycleProof)
    private val active = LinkedHashMap<String, Entry>()

    override fun eventId(accountId: String, input: NotificationCaptureInput, payment: PaymentIngestOutcome?): String = synchronized(active) {
        val proof = paymentLifecycleProof(input, payment)
        val primary = paymentNotificationSlot(input)?.let { "$accountId\u001F$it" }
        val fallback = if (input.notificationId != 0 || input.tag.isNotBlank())
            "$accountId\u001Fslot:${input.sourcePackage}|${input.notificationId}|${input.tag}" else null
        val reference = proof.referenceHash.takeIf(String::isNotBlank)?.let { "$accountId\u001Fref:$it" }
        val message = proof.messageHash.takeIf(String::isNotBlank)?.let { "$accountId\u001Fmessage:$it" }
        val keys = listOfNotNull(reference, message, primary, fallback).distinct()
        if (keys.isEmpty()) return@synchronized idFactory()
        val existing = keys.firstNotNullOfOrNull { key ->
            active[key]?.takeIf { old ->
                val sameReference = key == reference && proof.referenceHash == old.proof.referenceHash
                val sameMessage = key == message && proof.messageHash == old.proof.messageHash
                val conflict = proof.conflictingReference(old.proof) ||
                    (!sameReference && proof.conflictingMessage(old.proof))
                val promotion = old.proof.channelHash.isNotBlank() && proof.enriches(old.proof)
                proof.compatible(old.proof) && when {
                    sameReference -> true
                    sameMessage && !proof.conflictingReference(old.proof) -> true
                    key == primary && !conflict ->
                        proof.evidence == old.proof.evidence || promotion ||
                            (old.proof.channelHash.isNotBlank() && proof.channelHash.isNotBlank() &&
                                (old.proof.amountHash.isBlank() || old.proof.direction.isBlank()))
                    key == fallback && !conflict -> promotion
                    else -> false
                }
            }
        }
        val eventId = existing?.eventId ?: idFactory()
        val merged = existing?.proof?.let { prior -> proof.copy(
            amountHash = proof.amountHash.ifBlank { prior.amountHash },
            direction = proof.direction.ifBlank { prior.direction },
            channelHash = proof.channelHash.ifBlank { prior.channelHash },
            referenceHash = proof.referenceHash.ifBlank { prior.referenceHash },
            messageHash = proof.messageHash.ifBlank { prior.messageHash },
        ) } ?: proof
        if (existing != null) active.keys.filter { active[it]?.eventId == eventId }.forEach { active[it] = Entry(eventId, merged) }
        keys.forEach { active[it] = Entry(eventId, merged) }
        eventId
    }

    override fun markRemoved(accountId: String, input: NotificationCaptureInput) {
        val slot = paymentNotificationSlot(input) ?: return
        synchronized(active) {
            val eventId = active["$accountId\u001F$slot"]?.eventId ?: return@synchronized
            active.keys.filter { active[it]?.eventId == eventId }.toList().forEach { active.remove(it) }
        }
    }
}

/** Opaque local identity evidence; raw notification text is never persisted. */
fun paymentNotificationEvidence(input: NotificationCaptureInput, payment: PaymentIngestOutcome?): String {
    val content = NotificationFingerprint.sha256Hex(
        listOf(input.title, input.text, input.bigText, input.subText, input.textLines.joinToString("\u001E"))
            .joinToString("\u001F"),
    )
    val strongReference = payment?.providerReference.orEmpty().trim()
    return NotificationFingerprint.sha256Hex(
        if (strongReference.isNotBlank()) {
            "${input.sourcePackage}\u001F${payment?.paymentChannel}\u001F$strongReference\u001F${payment?.amountMinor}\u001F${payment?.direction}"
        } else if (payment != null && payment.amountMinor <= 0 && payment.direction == FinanceDirection.UNKNOWN) {
            // An amount-less payment notification often changes only status
            // wording while Android keeps the same slot. Until removal, the
            // platform lifecycle is the strongest available identity.
            "${input.sourcePackage}\u001F${payment.paymentChannel}\u001Fincomplete"
        } else {
            "${input.sourcePackage}\u001F${payment?.paymentChannel}\u001F$content\u001F${payment?.amountMinor}\u001F${payment?.direction}"
        },
    )
}

/** Structured continuity proof. Every stored identity component is hashed or an enum. */
data class PaymentLifecycleProof(
    val evidence: String,
    val amountHash: String,
    val direction: String,
    val channelHash: String,
    val referenceHash: String,
    val messageHash: String,
) {
    fun compatible(other: PaymentLifecycleProof): Boolean =
        (amountHash.isBlank() || other.amountHash.isBlank() || amountHash == other.amountHash) &&
            (direction.isBlank() || other.direction.isBlank() || direction == other.direction) &&
            (channelHash.isBlank() || other.channelHash.isBlank() || channelHash == other.channelHash)

    fun enriches(previous: PaymentLifecycleProof): Boolean = compatible(previous) &&
        ((previous.amountHash.isBlank() && amountHash.isNotBlank()) ||
            (previous.direction.isBlank() && direction.isNotBlank()))

    fun conflictingReference(other: PaymentLifecycleProof): Boolean =
        referenceHash.isNotBlank() && other.referenceHash.isNotBlank() && referenceHash != other.referenceHash

    fun conflictingMessage(other: PaymentLifecycleProof): Boolean =
        messageHash.isNotBlank() && other.messageHash.isNotBlank() && messageHash != other.messageHash
}

fun paymentLifecycleProof(input: NotificationCaptureInput, payment: PaymentIngestOutcome?): PaymentLifecycleProof {
    val channel = payment?.paymentChannel.orEmpty().trim().lowercase()
    val reference = payment?.providerReference.orEmpty().trim()
    return PaymentLifecycleProof(
        evidence = paymentNotificationEvidence(input, payment),
        amountHash = payment?.amountMinor?.takeIf { it > 0 }
            ?.let { NotificationFingerprint.sha256Hex(it.toString()) }.orEmpty(),
        direction = payment?.direction?.takeUnless { it == FinanceDirection.UNKNOWN }?.name.orEmpty(),
        channelHash = channel.takeIf(String::isNotBlank)?.let(NotificationFingerprint::sha256Hex).orEmpty(),
        referenceHash = reference.takeIf(String::isNotBlank)?.let {
            NotificationFingerprint.sha256Hex("${input.sourcePackage}\u001F$channel\u001F$it")
        }.orEmpty(),
        messageHash = input.messageIdentity,
    )
}

/** Raw content is deliberately absent: only the Android notification slot is identity. */
fun paymentNotificationSlot(input: NotificationCaptureInput): String? = when {
    input.notificationKey.isNotBlank() -> "key:${input.notificationKey}"
    input.notificationId != 0 || input.tag.isNotBlank() ->
        "slot:${input.sourcePackage}|${input.notificationId}|${input.tag}"
    else -> null
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
    val providerReference: String = "",
    val lifecycleIdentity: String = "",
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
