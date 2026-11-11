package uk.thewyj.app.task21.store

import androidx.room.*

/** Frozen v11 opener compiled with the unchanged Room runtime; QA only. */
@Entity(
    tableName = "payment_recognitions",
    indices = [
        Index(value = ["accountId", "updatedAtMs"]),
        Index(value = ["accountId", "sourceEventId"]),
    ],
)
data class CloseoutV11Recognition(
    @PrimaryKey val recognitionId: String,
    val accountId: String,
    /** PaymentRecognitionState name. */
    val state: String,
    val notificationId: Int,
    val sourcePackage: String,
    val sourceType: String,
    val sourceEventId: String,
    /** Structured-event id that was uploaded for finance, or blank when local-only. */
    val uploadEventId: String,
    val paymentChannel: String,
    val amountMinor: Long,
    val hasAmount: Int,
    val currency: String,
    val direction: String,
    val merchant: String,
    val providerReference: String,
    val createdAtMs: Long,
    val updatedAtMs: Long,
    @ColumnInfo(defaultValue = "0") val completionConfirmed: Int = 0,
    @ColumnInfo(defaultValue = "-1") val sourceUid: Int = -1,
    @ColumnInfo(defaultValue = "''") val identityReviewReason: String = "",
    @ColumnInfo(defaultValue = "''") val financialPhase: String = "",
    @ColumnInfo(defaultValue = "''") val lifecycleReference: String = "",
    @ColumnInfo(defaultValue = "''") val referenceNamespace: String = "",
    @ColumnInfo(defaultValue = "''") val currencyEvidence: String = "",
)


@Database(entities=[NotificationInstanceEntity::class,NotificationRevisionEntity::class,NotificationAppPolicyEntity::class,
    NotificationRuleEntity::class,NotificationSettingsEntity::class,CloseoutV11Recognition::class,CloseoutV11Ticket::class,
    PaymentCandidateEntity::class,LocalPaymentBookingEntity::class,PaymentEventAliasEntity::class],version=11,exportSchema=false)
abstract class CloseoutV11Database : RoomDatabase()

/** Exact pre-v17 ticket columns; a historical opener must not reuse today's entity. */
@Entity(tableName="payment_tickets",indices=[Index(value=["accountId","state"]),Index(value=["recognitionId"]),Index(value=["accountId","sourcePackage","state"])])
data class CloseoutV11Ticket(
    @PrimaryKey val ticketId:String,val accountId:String,val recognitionId:String,val sourcePackage:String,
    val sourceEventId:String,val paymentChannel:String,val amountHintMinor:Long,val hasAmountHint:Int,
    val missingFields:String,val state:String,val attempts:Int,val createdAtMs:Long,val expiresAtMs:Long,
    val enrichedAmountMinor:Long,val hasEnrichedAmount:Int,val enrichedDirection:String,val enrichedMerchant:String,
    val enrichedProviderReference:String,val enrichedAtMs:Long,
)
