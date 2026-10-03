package uk.thewyj.app.task21.store

import androidx.room.Entity
import uk.thewyj.app.task21.payment.LocalPaymentBooking

@Entity(tableName = "local_payment_bookings", primaryKeys = ["accountId", "eventId"])
data class LocalPaymentBookingEntity(
    val accountId: String, val eventId: String, val recognitionId: String,
    val transactionId: String, val amountMinor: Long, val direction: String,
    val currency: String, val merchant: String, val occurredAtMs: Long,
    val sourcePackage: String, val paymentChannel: String, val providerReference: String,
    val syncState: String, val createdAtMs: Long,
)

internal fun LocalPaymentBooking.toEntity() = LocalPaymentBookingEntity(
    accountId, eventId, recognitionId, transactionId, amountMinor, direction, currency, merchant,
    occurredAtMs, sourcePackage, paymentChannel, providerReference, syncState, createdAtMs,
)
internal fun LocalPaymentBookingEntity.toModel() = LocalPaymentBooking(
    accountId, eventId, recognitionId, transactionId, amountMinor, direction, currency, merchant,
    occurredAtMs, sourcePackage, paymentChannel, providerReference, syncState, createdAtMs,
)
