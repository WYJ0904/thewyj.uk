package uk.thewyj.app.task21.payment

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.util.Log
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

/**
 * Payment enrichment service.
 *
 * It only reads the page of a package that currently owns an active 90 second
 * ticket, only for finance-entitled accounts, and only extracts the minimal
 * transaction fields. It never captures screenshots, passwords, OTPs, chat
 * history, contacts or the full node tree.
 */
class ThewyjPaymentAccessibilityService : AccessibilityService() {
    private val tickets = PaymentTicketEngine()

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val currentEvent = event ?: return
        val eventType = currentEvent.eventType
        if (eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) {
            return
        }
        val packageName = currentEvent.packageName?.toString().orEmpty()
        if (packageName.isEmpty() || packageName == this.packageName) return
        val account = runCatching { NotificationSessionProvider(this).currentAccount() }.getOrNull() ?: return
        if (!account.financeEntitled) return

        val store = RoomPaymentRecognitionStore(NotificationDatabase.get(this))
        val ticket = runCatching { store.activeTicketForPackage(account.accountId, packageName) }.getOrNull() ?: return
        if (!tickets.isActive(ticket)) return

        val lines = collectText(rootInActiveWindow)
        if (lines.isEmpty()) return
        val enrichment = PaymentPageSemantics.extract(
            PaymentPageSnapshot(
                sourcePackage = packageName,
                textLines = lines,
                capturedAtMs = System.currentTimeMillis(),
            ),
        ) ?: return
        runCatching {
            AndroidPaymentRecognitionHook.get(this)
                .onAccessibilityEnrichment(account.accountId, enrichment)
        }.onFailure { error -> Log.w("T22PAY", "enrichment failed: ${error.javaClass.simpleName}") }
    }

    override fun onInterrupt() = Unit

    /**
     * Bounded traversal: depth and node count are capped and password fields are
     * skipped, so a hostile page cannot turn this into a screen scraper.
     */
    private fun collectText(root: AccessibilityNodeInfo?): List<String> {
        val node = root ?: return emptyList()
        val collected = mutableListOf<String>()
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        queue.add(node to 0)
        var visited = 0
        while (queue.isNotEmpty() && collected.size < MAX_TEXT_LINES && visited < MAX_NODES) {
            val (current, depth) = queue.removeFirst()
            visited += 1
            if (depth <= MAX_DEPTH && !current.isPassword) {
                val text = current.text?.toString().orEmpty()
                val description = current.contentDescription?.toString().orEmpty()
                if (text.isNotBlank()) collected.add(text)
                if (description.isNotBlank()) collected.add(description)
                for (index in 0 until current.childCount) {
                    val child = current.getChild(index) ?: continue
                    queue.add(child to depth + 1)
                }
            }
        }
        return collected.distinct()
    }

    companion object {
        private const val MAX_NODES = 220
        private const val MAX_DEPTH = 12
        private const val MAX_TEXT_LINES = 60
    }
}
