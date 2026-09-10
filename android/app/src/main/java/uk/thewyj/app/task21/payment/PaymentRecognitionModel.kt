package uk.thewyj.app.task21.payment

import uk.thewyj.app.task21.FinanceDirection

/**
 * Unified payment recognition model. Every source (WeChat, Alipay, bank app
 * notification, bank SMS, accessibility enrichment) produces [PaymentEvidence]
 * with the same shape, so reconciliation and Finance only ever speak one
 * language.
 */
enum class PaymentRecognitionStatus {
    /** Amount + direction are known and the message itself proves completion. */
    CONFIRMED_PAYMENT,

    /** Payment-like, but at least one essential field is missing. */
    PAYMENT_LIKELY,

    /** Something financial happened but the evidence is too thin to classify. */
    INSUFFICIENT_INFORMATION,

    /** Marketing, verification, chat or anything else that is not a payment. */
    NOT_PAYMENT,

    /** The same real world payment was already recognised. */
    DUPLICATE,

    /** Recognised before and already handled (candidate or transaction). */
    ALREADY_PROCESSED,

    /** The source message could not be parsed at all. */
    PARSE_ERROR,
}

enum class PaymentSourceType {
    NOTIFICATION,
    BANK_NOTIFICATION,
    SMS,
    ACCESSIBILITY,
}

/** One piece of evidence. Raw text never leaves the device. */
data class PaymentEvidence(
    val sourceType: PaymentSourceType,
    val sourcePackage: String,
    /** Stable identity from the source: notification key, SMS id, revision id. */
    val sourceEventId: String,
    val title: String = "",
    val text: String = "",
    val amountMinor: Long? = null,
    val currency: String? = null,
    val direction: FinanceDirection? = null,
    val merchant: String? = null,
    val counterparty: String? = null,
    val paymentChannel: String = "",
    /** Only ever the masked tail, never a full card or account number. */
    val accountTail: String? = null,
    val providerReference: String? = null,
    val occurredAtMs: Long? = null,
    val capturedAtMs: Long,
    val parserVersion: String,
    val confidence: Int,
)

/**
 * Normalised parser result. Missing information stays missing: parsers never
 * guess an amount, a merchant or a direction.
 */
data class ParsedPaymentMessage(
    val status: PaymentRecognitionStatus,
    val amountMinor: Long? = null,
    val currency: String? = null,
    val direction: FinanceDirection? = null,
    val merchant: String? = null,
    val counterparty: String? = null,
    val paymentChannel: String = "",
    val accountTail: String? = null,
    val providerReference: String? = null,
    val occurredAtMs: Long? = null,
    val confidence: Int = 0,
    val reasons: List<String> = emptyList(),
    val missingFields: Set<String> = emptySet(),
) {
    val isTransactionLike: Boolean
        get() = status == PaymentRecognitionStatus.CONFIRMED_PAYMENT ||
            status == PaymentRecognitionStatus.PAYMENT_LIKELY ||
            status == PaymentRecognitionStatus.INSUFFICIENT_INFORMATION
}

interface PaymentMessageParser {
    val version: String
    val channel: String
    fun matches(sourcePackage: String, sourceType: PaymentSourceType): Boolean
    fun parse(title: String, text: String, bigText: String, subText: String, capturedAtMs: Long): ParsedPaymentMessage
}

object PaymentParserRegistry {
    private val parsers: List<PaymentMessageParser> = listOf(
        WeChatPaymentParser,
        AlipayPaymentParser,
        BankNotificationParser,
        BankSmsParser,
    )

    fun parserFor(sourcePackage: String, sourceType: PaymentSourceType): PaymentMessageParser? =
        parsers.firstOrNull { it.matches(sourcePackage, sourceType) }

    fun parse(
        sourcePackage: String,
        sourceType: PaymentSourceType,
        title: String,
        text: String,
        bigText: String = "",
        subText: String = "",
        capturedAtMs: Long,
    ): ParsedPaymentMessage {
        val parser = parserFor(sourcePackage, sourceType)
            ?: return ParsedPaymentMessage(
                status = PaymentRecognitionStatus.NOT_PAYMENT,
                reasons = listOf("no_parser_for_source"),
            )
        return parser.parse(title, text, bigText, subText, capturedAtMs)
    }
}
