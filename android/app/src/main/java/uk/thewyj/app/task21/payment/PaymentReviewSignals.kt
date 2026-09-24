package uk.thewyj.app.task21.payment

import kotlinx.coroutines.flow.MutableSharedFlow

/** In-process invalidation after a payment review changes; carries no payment data. */
object PaymentReviewSignals {
    val changes = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    fun publish() { changes.tryEmit(Unit) }
}
