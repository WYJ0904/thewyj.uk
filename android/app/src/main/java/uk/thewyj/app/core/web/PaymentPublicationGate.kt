package uk.thewyj.app.core.web

/** Orders asynchronous Room snapshots targeting one WebView document. */
class PaymentPublicationGate {
    private var generation = 0L
    @Synchronized fun begin(): Long = ++generation
    @Synchronized fun invalidate() { generation += 1 }
    @Synchronized fun isCurrent(request: Long): Boolean = request == generation
}
