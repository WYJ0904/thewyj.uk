package uk.thewyj.app.task21.payment

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Ticket-scoped payment enrichment. No page prose or screenshots are persisted. */
class ThewyjPaymentAccessibilityService : AccessibilityService() {
    private val tickets = PaymentTicketEngine()
    private val ticketPackages = PaymentTicketPackageCache()
    private val worker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val refreshScheduled = AtomicBoolean(false)
    private val readScheduled = AtomicBoolean(false)
    private val screenshotInFlight = AtomicBoolean(false)
    @Volatile private var active: Scan? = null
    @Volatile private var generation = 0L
    private var pageClass = ""
    private var retryCallback: Runnable? = null
    private var lastScreenshotAtMs = 0L
    private var ocrVerifier: PaymentScreenshotVerifier? = null
    private val androidGateway by lazy { AndroidPaymentAccessibilityGateway(this) }
    private fun gateway() = PaymentAccessibilityDeviceTest.gateway() ?: androidGateway
    private class Scan(val accountId: String, val ticket: PaymentTicket, val windowId: Int?, val generation: Long, val budget: PaymentPageRetry, val gateway: PaymentAccessibilityGateway) {
        val applying = AtomicBoolean(false)
    }
    private data class PageRead(val lines: List<String>, val groups: List<List<String>>, val nodes: Int)

    override fun onServiceConnected() {
        super.onServiceConnected()
        PaymentAccessibilityStatus.onConnected()
        PaymentTicketPackageSignal.clear()
        cancelScan("service_connected")
        refreshPackages(force = true)
    }
    override fun onUnbind(intent: android.content.Intent?): Boolean {
        cancelScan("service_unbound")
        PaymentAccessibilityStatus.onDisconnected()
        return super.onUnbind(intent)
    }
    override fun onDestroy() {
        cancelScan("service_destroyed")
        PaymentAccessibilityStatus.onDisconnected()
        mainHandler.removeCallbacksAndMessages(null)
        worker.shutdown()
        super.onDestroy()
    }
    override fun onInterrupt() { cancelScan("service_interrupted") }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val e = event ?: return
        val foreground = rootInActiveWindow?.packageName?.toString().orEmpty()
        val pkg = e.packageName?.toString().orEmpty().ifBlank { foreground }
        PaymentAccessibilityStatus.onEvent(pkg, e.eventType)
        if (active != null && foreground.isNotBlank() && foreground != active?.ticket?.sourcePackage) cancelScan("page_left:$foreground")
        if (pkg.isBlank() || pkg == packageName || e.eventType !in EVENT_TYPES) return
        if (ticketPackages.needsRefresh()) refreshPackages(force = false)
        if (!ticketPackages.contains(pkg) && !PaymentTicketPackageSignal.recentlySignalled(pkg)) {
            PaymentAccessibilityStatus.onSkipped(pkg, "no_active_ticket")
            return
        }
        val eventClass = e.className?.toString().orEmpty().take(160)
        if (e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && eventClass != pageClass) {
            cancelScan("window_state_changed")
            pageClass = eventClass
        }
        PaymentDiagnostics.emit("event", "pkg=$pkg class=$eventClass type=${PaymentAccessibilityStatus.eventTypeName(e.eventType)} window=${e.windowId}")
        if (pkg == "com.tencent.mm" && PaymentPageContext.blockedWechatActivity(pageClass)) {
            PaymentAccessibilityStatus.onParserResult("not_payment_detail")
            return
        }
        queueRead(pkg, e.windowId.takeIf { it >= 0 })
    }

    /** Room/account lookup is always off the accessibility thread. */
    private fun queueRead(pkg: String, eventWindow: Int?) {
        if (!readScheduled.compareAndSet(false, true)) { PaymentDiagnostics.emit("debounce", "reason=read_pending"); return }
        val requestedGeneration = generation
        PaymentAccessibilityStatus.onParserResult("read_queued")
        execute {
            try {
                val gateway = gateway()
                val account = gateway.financeAccountId() ?: return@execute
                val ticket = gateway.activeTicket(account, pkg)
                if (ticket == null || !tickets.isActive(ticket)) { refreshPackages(true); return@execute }
                mainHandler.post {
                    if (generation != requestedGeneration) return@post
                    val window = paymentWindow(pkg)
                    val root = rootInActiveWindow?.takeIf { it.packageName?.toString() == pkg }
                    val id = window?.id ?: root?.windowId ?: eventWindow
                    val key = "${ticket.ticketId}|$pkg|$id|$pageClass"
                    val previous = active
                    val scan = if (previous?.budget?.key == key && !previous.budget.cancelled) previous else {
                        cancelScan("new_ticket_or_window")
                        Scan(account, ticket, id, generation, PaymentPageRetry(key, SystemClock.uptimeMillis()), gateway).also { active = it }
                    }
                    readPage(scan)
                }
            } finally { readScheduled.set(false) }
        }
    }

    private fun paymentWindow(pkg: String) = runCatching {
        windows.firstOrNull { it.root?.packageName?.toString() == pkg && (it.isActive || it.isFocused) }
    }.getOrNull()
    private fun foregroundMatches(scan: Scan): Boolean {
        val root = rootInActiveWindow
        if (root != null && root.packageName?.toString() != scan.ticket.sourcePackage) return false
        val window = paymentWindow(scan.ticket.sourcePackage)
        return (root != null || window != null) && (scan.windowId == null || window?.id == scan.windowId || root?.windowId == scan.windowId)
    }
    private fun current(scan: Scan): Boolean = active === scan && generation == scan.generation && !scan.budget.cancelled &&
        SystemClock.uptimeMillis() - scan.budget.startedAtMs <= PaymentPageRetry.MAX_WINDOW_MS && tickets.isActive(scan.ticket)

    private fun readPage(scan: Scan) {
        if (!current(scan) || !scan.budget.beginAttempt(SystemClock.uptimeMillis(), retryCallback != null)) return
        val root = rootInActiveWindow
        if (root != null && root.packageName?.toString() != scan.ticket.sourcePackage) { cancelScan("root_package_mismatch"); return }
        val target = root ?: paymentWindow(scan.ticket.sourcePackage)?.root
        PaymentDiagnostics.emit("root", "ticket=${PaymentDiagnostics.identity(scan.ticket.ticketId)} retry=${scan.budget.attempts - 1} null=${target == null} pkg=${target?.packageName} window=${target?.windowId}")
        if (target == null) { PaymentAccessibilityStatus.onParserResult("root_null"); scheduleRetry(scan, "root_null"); return }
        val page = collectText(target)
        PaymentAccessibilityStatus.onPageRead(page.lines.size)
        PaymentDiagnostics.emit("tree", "nodes=${page.nodes} texts=${page.lines.size} tokenGroups=${page.groups.size}")
        if (page.lines.isEmpty()) {
            PaymentAccessibilityStatus.onParserResult("no_text")
            screenshot(scan)
        } else {
            val snapshot = PaymentPageSnapshot(scan.ticket.sourcePackage, page.lines, System.currentTimeMillis(), page.groups)
            execute {
                if (!validTicket(scan)) return@execute
                val enrichment = PaymentPageSemantics.extract(snapshot)
                if (enrichment == null) mainHandler.post { if (current(scan)) screenshot(scan) }
                else mainHandler.post {
                    if (current(scan) && foregroundMatches(scan)) execute { apply(scan, enrichment) }
                }
            }
        }
    }

    private fun validTicket(scan: Scan): Boolean {
        if (!current(scan)) return false
        if (gateway() !== scan.gateway) return false
        val account = scan.gateway.financeAccountId()
        val ticket = account?.takeIf { it == scan.accountId }?.let { scan.gateway.activeTicket(it, scan.ticket.sourcePackage) }
        val valid = ticket != null && ticket.ticketId == scan.ticket.ticketId && tickets.isActive(ticket)
        if (!valid) PaymentDiagnostics.emit("discard", "reason=ticket_or_account_changed ticket=${PaymentDiagnostics.identity(scan.ticket.ticketId)}")
        return valid
    }
    private fun apply(scan: Scan, enrichment: PaymentEnrichment) {
        if (!validTicket(scan) || !scan.applying.compareAndSet(false, true)) return
        val outcome = runCatching { scan.gateway.enrich(scan.accountId, scan.ticket.ticketId, enrichment) }.getOrNull()
        PaymentDiagnostics.emit("verification", "transaction=${PaymentDiagnostics.identity(scan.ticket.recognitionId)} ticket=${PaymentDiagnostics.identity(scan.ticket.ticketId)} minor=${enrichment.amountMinor} confidence=${enrichment.confidence} outcome=${outcome?.javaClass?.simpleName}")
        PaymentAccessibilityStatus.onParserResult("${enrichment.evidenceSource.name.lowercase()} amount=${enrichment.amountMinor} direction=${enrichment.direction} result=${outcome?.javaClass?.simpleName}")
        if (outcome is EnrichmentOutcome.Applied) {
            mainHandler.post { if (active === scan) cancelScan("verified") }
            refreshPackages(true)
        } else {
            scan.applying.set(false)
            mainHandler.post { scheduleRetry(scan, "insufficient") }
        }
    }

    /** Screenshot callbacks keep the ticket/account/window captured before the request. */
    private fun screenshot(scan: Scan) {
        if (!current(scan) || !foregroundMatches(scan)) { scheduleRetry(scan, "screenshot_root_not_ready"); return }
        val delay = PaymentScreenshotThrottle.retryDelayMs(lastScreenshotAtMs, SystemClock.uptimeMillis(), SCREENSHOT_MIN_INTERVAL_MS)
        if (delay > 0) { scheduleRetry(scan, "ocr_cooldown", delay); return }
        if (!screenshotInFlight.compareAndSet(false, true)) { scheduleRetry(scan, "ocr_in_flight"); return }
        lastScreenshotAtMs = SystemClock.uptimeMillis()
        fun callback(windowCapture: Boolean): TakeScreenshotCallback = object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                screenshotInFlight.set(false)
                if (!current(scan) || !foregroundMatches(scan)) { result.hardwareBuffer.close(); PaymentDiagnostics.emit("discard", "reason=page_changed_during_capture"); return }
                val bitmap = try { runCatching { android.graphics.Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)?.copy(android.graphics.Bitmap.Config.ARGB_8888, false) }.getOrNull() }
                    finally { result.hardwareBuffer.close() }
                if (bitmap == null) { scheduleRetry(scan, "no_bitmap"); return }
                execute {
                    try {
                        if (!validTicket(scan)) return@execute
                        val verifier = ocrVerifier ?: PaymentScreenshotVerifier(MlKitOcrEngine(this@ThewyjPaymentAccessibilityService)).also { ocrVerifier = it }
                        val enrichment = kotlinx.coroutines.runBlocking { verifier.verify(bitmap, scan.ticket.sourcePackage, System.currentTimeMillis()) }
                        mainHandler.post {
                            if (!current(scan) || !foregroundMatches(scan)) { PaymentDiagnostics.emit("discard", "reason=page_changed_during_ocr"); return@post }
                            if (enrichment == null) { PaymentAccessibilityStatus.onParserResult("ocr_unparsed"); scheduleRetry(scan, "ocr_unparsed") }
                            else execute { apply(scan, enrichment.copy(evidenceSource = PaymentEvidenceSource.OCR)) }
                        }
                    } finally { bitmap.recycle() }
                }
            }
            override fun onFailure(errorCode: Int) {
                screenshotInFlight.set(false)
                PaymentDiagnostics.emit("screenshot", "window=$windowCapture error=$errorCode")
                if (windowCapture && errorCode != ERROR_TAKE_SCREENSHOT_SECURE_WINDOW && errorCode != ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT && current(scan) && foregroundMatches(scan)) {
                    if (screenshotInFlight.compareAndSet(false, true)) runCatching { takeScreenshot(android.view.Display.DEFAULT_DISPLAY, mainExecutor, callback(false)) }
                        .onFailure { screenshotInFlight.set(false); scheduleRetry(scan, "display_unavailable") }
                } else scheduleRetry(scan, "screenshot_error_$errorCode")
            }
        }
        PaymentDiagnostics.emit("screenshot", "ticket=${PaymentDiagnostics.identity(scan.ticket.ticketId)} window=${scan.windowId}")
        runCatching {
            if (android.os.Build.VERSION.SDK_INT >= 34 && scan.windowId != null) takeScreenshotOfWindow(scan.windowId, mainExecutor, callback(true))
            else takeScreenshot(android.view.Display.DEFAULT_DISPLAY, mainExecutor, callback(false))
        }.onFailure { screenshotInFlight.set(false); scheduleRetry(scan, "screenshot_unavailable") }
    }

    private fun scheduleRetry(scan: Scan, reason: String, requestedDelay: Long? = null) {
        if (!current(scan)) return
        val remaining = PaymentPageRetry.MAX_WINDOW_MS - (SystemClock.uptimeMillis() - scan.budget.startedAtMs)
        val delay = scan.budget.nextDelayMs(SystemClock.uptimeMillis(), requestedDelay)
        if (delay == null || delay > remaining || scan.budget.attempts >= PaymentPageRetry.MAX_ATTEMPTS) { PaymentDiagnostics.emit("retry", "reason=budget_exhausted attempts=${scan.budget.attempts}"); return }
        retryCallback?.let(mainHandler::removeCallbacks)
        retryCallback = Runnable { retryCallback = null; readPage(scan) }.also { mainHandler.postDelayed(it, delay.coerceAtLeast(1)) }
        PaymentAccessibilityStatus.onParserResult("retry_$reason attempt=${scan.budget.attempts} delay=$delay")
        PaymentDiagnostics.emit("retry", "reason=$reason attempt=${scan.budget.attempts} delay=$delay remaining=$remaining")
    }
    private fun cancelScan(reason: String) {
        active?.budget?.cancel()
        active = null; generation++
        retryCallback?.let(mainHandler::removeCallbacks); retryCallback = null
        PaymentDiagnostics.emit("cancel", "reason=$reason")
    }
    private fun execute(block: () -> Unit) {
        runCatching { worker.execute { runCatching(block).onFailure { PaymentDiagnostics.emit("failure", "type=${it.javaClass.simpleName}"); active?.let { scan -> mainHandler.post { scheduleRetry(scan, "worker_failure") } } } } }
    }
    private fun refreshPackages(force: Boolean) {
        if ((!force && !ticketPackages.needsRefresh()) || !refreshScheduled.compareAndSet(false, true)) return
        execute {
            try {
                val gateway = gateway()
                val account = gateway.financeAccountId()
                val packages = if (account != null) gateway.activePackages(account, System.currentTimeMillis()) else emptySet()
                ticketPackages.refreshWith(packages)
                PaymentAccessibilityStatus.onTicketPackages(packages)
                mainHandler.post {
                    val pkg = rootInActiveWindow?.packageName?.toString().orEmpty()
                    if (active == null && pkg in packages) queueRead(pkg, rootInActiveWindow?.windowId)
                    else if (active == null && pkg.isBlank() && packages.size == 1) queueRead(packages.single(), null)
                }
            } finally { refreshScheduled.set(false) }
        }
    }
    private fun collectText(root: AccessibilityNodeInfo): PageRead {
        val lines = mutableListOf<String>(); val groups = mutableListOf<List<String>>()
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>(); queue.add(root to 0)
        var visited = 0
        while (queue.isNotEmpty() && lines.size < MAX_TEXT_LINES && visited < MAX_NODES) {
            val (node, depth) = queue.removeFirst(); visited++
            if (depth > MAX_DEPTH || node.isPassword || node.packageName?.toString() != root.packageName?.toString()) continue
            listOf(node.text, node.contentDescription).mapNotNull { it?.toString()?.takeIf(String::isNotBlank) }.forEach(lines::add)
            val children = (0 until node.childCount).mapNotNull(node::getChild)
            if (children.size in 2..4 && children.none { it.isPassword }) groups.add(children.map { it.text?.toString().orEmpty() })
            children.forEach { queue.add(it to depth + 1) }
        }
        return PageRead(lines, groups, visited)
    }
    companion object {
        private const val MAX_NODES = 220
        private const val MAX_DEPTH = 12
        private const val MAX_TEXT_LINES = 60
        private const val SCREENSHOT_MIN_INTERVAL_MS = 4_000L
        private val EVENT_TYPES = setOf(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED, AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED, AccessibilityEvent.TYPE_WINDOWS_CHANGED, AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_FOCUSED, AccessibilityEvent.TYPE_VIEW_SCROLLED)
    }
}
