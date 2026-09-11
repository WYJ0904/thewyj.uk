package uk.thewyj.app.task21.payment

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.util.Log
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

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
    private val ticketPackages = PaymentTicketPackageCache()
    /**
     * Room must never be touched on the main thread (the framework throws
     * "Cannot access database on the main thread"), so every ticket lookup and
     * enrichment runs here. The previous main-thread query was swallowed by a
     * runCatching and made the service report `no_active_ticket` forever.
     */
    private val worker = Executors.newSingleThreadExecutor()
    private val refreshScheduled = AtomicBoolean(false)

    override fun onServiceConnected() {
        super.onServiceConnected()
        PaymentAccessibilityStatus.onConnected()
        scheduleTicketPackageRefresh(force = true)
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        PaymentAccessibilityStatus.onDisconnected()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        runCatching { worker.shutdown() }
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val currentEvent = event ?: return
        val eventType = currentEvent.eventType
        val eventPackage = currentEvent.packageName?.toString().orEmpty()
        PaymentAccessibilityStatus.onEvent(eventPackage, eventType)
        if (eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            eventType != AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED &&
            eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED
        ) {
            return
        }
        val packageName = currentEvent.packageName?.toString().orEmpty()
        if (packageName.isEmpty() || packageName == this.packageName) return

        // In-memory gate only: without an active verification ticket this
        // package has no business being read, so SystemUI/launcher/IME noise
        // never touches the database, the node tree or the log.
        if (ticketPackages.needsRefresh()) scheduleTicketPackageRefresh(force = false)
        if (!ticketPackages.contains(packageName)) {
            PaymentAccessibilityStatus.onSkipped(packageName, "no_active_ticket")
            return
        }

        // Reading the window must happen on the accessibility thread. The active
        // window is preferred; when it exposes nothing (dialogs, transitions, or
        // apps that render custom views) the package's own interactive window is
        // used instead.
        var lines = collectText(rootInActiveWindow)
        if (lines.isEmpty()) lines = collectText(packageWindowRoot(packageName))
        PaymentAccessibilityStatus.onPageRead(lines.size)
        if (lines.isEmpty()) {
            PaymentAccessibilityStatus.onParserResult("no_text")
            runCatching { worker.execute { reportMiss(packageName) } }
            return
        }
        runCatching {
            worker.execute { handlePageSnapshot(packageName, lines) }
        }.onFailure { error ->
            Log.w(TAG, "enrichment queue rejected: ${error.javaClass.simpleName}")
        }
    }

    /** Background half of the pipeline: ticket check, parse, enrich, persist. */
    private fun handlePageSnapshot(sourcePackage: String, lines: List<String>) {
        val store = RoomPaymentRecognitionStore(NotificationDatabase.get(this))
        val account = runCatching { NotificationSessionProvider(this).currentAccount() }.getOrNull()
        if (account == null || !account.financeEntitled) {
            PaymentAccessibilityStatus.onSkipped(sourcePackage, "no_finance_account")
            return
        }
        val ticket = runCatching { store.activeTicketForPackage(account.accountId, sourcePackage) }.getOrNull()
        if (ticket == null || !tickets.isActive(ticket)) {
            // The cached package list is stale (ticket just expired): drop it so
            // the next event re-reads the real state.
            scheduleTicketPackageRefresh(force = true)
            PaymentAccessibilityStatus.onParserResult("no_active_ticket")
            return
        }
        val enrichment = PaymentPageSemantics.extract(
            PaymentPageSnapshot(
                sourcePackage = sourcePackage,
                textLines = lines,
                capturedAtMs = System.currentTimeMillis(),
            ),
        )
        if (enrichment == null) {
            PaymentAccessibilityStatus.onParserResult("unparsed")
            runCatching { worker.execute { reportMiss(sourcePackage) } }
            return
        }
        PaymentAccessibilityStatus.onParserResult(
            "amount=${enrichment.amountMinor ?: "unknown"} direction=${enrichment.direction ?: "unknown"}",
        )
        runCatching {
            AndroidPaymentRecognitionHook.get(this)
                .onAccessibilityEnrichment(account.accountId, enrichment)
        }.onSuccess {
            // The ticket may now be consumed; refresh so the gate stays exact.
            scheduleTicketPackageRefresh(force = true)
        }.onFailure { error ->
            Log.w("T22PAY", "enrichment failed: ${error.javaClass.simpleName}")
        }
    }

    /**
     * The page could not be read. Two misses close the automatic attempt: the
     * user is told once and can still type the amount by hand.
     */
    private fun reportMiss(sourcePackage: String) {
        val account = runCatching { NotificationSessionProvider(this).currentAccount() }.getOrNull() ?: return
        if (!account.financeEntitled) return
        runCatching {
            AndroidPaymentRecognitionHook.get(this).onAccessibilityMiss(account.accountId, sourcePackage)
        }
    }

    /**
     * Root of the interactive window that belongs to [sourcePackage], so a page
     * is still read when it is not the active window (for example while a system
     * dialog or the keyboard holds focus).
     */
    private fun packageWindowRoot(sourcePackage: String): AccessibilityNodeInfo? = runCatching {
        windows
            ?.mapNotNull { it?.root }
            ?.firstOrNull { it.packageName?.toString() == sourcePackage }
    }.getOrNull()

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
        private const val TAG = "ThewyjAccessibility"
    }

    /**
     * Re-reads the packages that own an active ticket. Runs off the main thread
     * and coalesces concurrent requests into one query.
     */
    private fun scheduleTicketPackageRefresh(force: Boolean) {
        if (!force && !ticketPackages.needsRefresh()) return
        if (!refreshScheduled.compareAndSet(false, true)) return
        runCatching {
            worker.execute {
                try {
                    val account = runCatching { NotificationSessionProvider(this).currentAccount() }.getOrNull()
                    if (account != null && account.financeEntitled) {
                        val store = RoomPaymentRecognitionStore(NotificationDatabase.get(this))
                        val packages = runCatching {
                            store.activeTicketPackages(account.accountId, System.currentTimeMillis())
                        }.getOrDefault(emptySet())
                        ticketPackages.refreshWith(packages)
                        PaymentAccessibilityStatus.onTicketPackages(packages)
                    }
                } finally {
                    refreshScheduled.set(false)
                }
            }
        }.onFailure {
            refreshScheduled.set(false)
        }
    }
}
