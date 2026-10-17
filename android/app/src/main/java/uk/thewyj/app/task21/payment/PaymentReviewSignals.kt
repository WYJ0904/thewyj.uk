package uk.thewyj.app.task21.payment

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** In-process invalidation after a payment review changes; carries no payment data. */
object PaymentReviewSignals {
    private val generation = MutableStateFlow(0L)
    val changes = generation.asStateFlow()
    fun publish() { generation.update { it + 1 } }
}
