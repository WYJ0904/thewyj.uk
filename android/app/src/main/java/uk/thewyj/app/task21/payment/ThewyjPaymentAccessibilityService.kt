package uk.thewyj.app.task21.payment

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.util.Log
import uk.thewyj.app.task21.NotificationSessionProvider
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Payment enrichment service.
 *
 * It only reads the page of a package that currently owns an active 90 second
 * ticket, only for finance-entitled accounts, and only extracts the minimal
 * transaction fields. It never persists or uploads screenshots, passwords,
 * OTPs, chat history, contacts or the full node tree. A screenshot may exist
 * in memory only while an explicit ticket is active, for on-device OCR.
 */
class ThewyjPaymentAccessibilityService : AccessibilityService() {
    private val tickets = PaymentTicketEngine()
    private val ticketPackages = PaymentTicketPackageCache()
    private val lastWindowIds = ConcurrentHashMap<String, Int>()
    private val screenshotRetryPackages = ConcurrentHashMap.newKeySet<String>()
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    @Volatile private var lastTicketPackage = ""
    @Volatile private var lastTicketWindowId: Int? = null
    @Volatile private var lastTicketEventAtMs = 0L
    @Volatile private var ocrVerifier: PaymentScreenshotVerifier? = null
    @Volatile private var lastScreenshotAtMs = 0L
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
        // #10: a reconnect (or an account/session refresh that rebinds the
        // service) starts from the real Room state instead of another account's
        // memory-only signal.
        PaymentTicketPackageSignal.clear()
        scheduleTicketPackageRefresh(force = true)
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        PaymentAccessibilityStatus.onDisconnected()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        // Never let a destroyed service instance leave a stale "connected"
        // claim behind: the capability banner must fall back to the system
        // grant instead of reporting a live connection that no longer exists.
        PaymentAccessibilityStatus.onDisconnected()
        mainHandler.removeCallbacksAndMessages(null)
        screenshotRetryPackages.clear()
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
        if (currentEvent.windowId >= 0) lastWindowIds[packageName] = currentEvent.windowId

        // In-memory gate only: without an active verification ticket this
        // package has no business being read, so SystemUI/launcher/IME noise
        // never touches the database, the node tree or the log.
        if (ticketPackages.needsRefresh()) scheduleTicketPackageRefresh(force = false)
        if (!ticketPackages.contains(packageName) && !PaymentTicketPackageSignal.recentlySignalled(packageName)) {
            maybeRetryAfterSystemOverlay(packageName)
            PaymentAccessibilityStatus.onSkipped(packageName, "no_active_ticket")
            return
        }
        if (!ticketPackages.contains(packageName)) {
            // #10: the ticket was created after the last cache refresh, so this
            // first event is read and handed to the worker, where the Room ticket
            // is re-checked before anything is parsed or enriched. A package
            // without a real ticket is rejected there and the cache is refreshed.
            PaymentAccessibilityStatus.onTicketSignal(packageName)
            scheduleTicketPackageRefresh(force = true)
        }
        lastTicketPackage = packageName
        lastTicketWindowId = PaymentScreenshotTarget.resolve(currentEvent.windowId, packageWindowId(packageName))
        lastTicketEventAtMs = System.currentTimeMillis()

        // Reading the window must happen on the accessibility thread. The active
        // window is preferred; when it exposes nothing (dialogs, transitions, or
        // apps that render custom views) the package's own interactive window is
        // used instead.
        var lines = collectText(rootInActiveWindow)
        if (lines.isEmpty()) lines = collectText(packageWindowRoot(packageName))
        PaymentAccessibilityStatus.onPageRead(lines.size)
        if (lines.isEmpty()) {
            PaymentAccessibilityStatus.onParserResult("no_text")
            // WeChat exposes no text at all: fall back to a local screenshot +
            // on-device OCR. The image never leaves the device and never creates
            // a transaction by itself.
            // A device without a usable OCR engine must degrade to the manual
            // path, never crash the accessibility callback (the service would
            // otherwise stop receiving events after one bad window).
            val windowId = PaymentScreenshotTarget.resolve(currentEvent.windowId, packageWindowId(packageName))
            runCatching { requestScreenshotVerification(packageName, windowId) }.onFailure { error ->
                PaymentAccessibilityStatus.onParserResult("ocr_unavailable")
                Log.w(TAG, "screenshot verification unavailable", error)
                scheduleMiss(packageName)
            }
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
            requestScreenshotVerification(sourcePackage, lastWindowIds[sourcePackage])
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
     * Takes at most one screenshot every few seconds, only while a ticket is
     * open, and hands it to the local OCR verifier. Every failure mode
     * (secure window, rate limit, OCR error) simply leaves the manual path.
     */
    private fun requestScreenshotVerification(sourcePackage: String, windowId: Int?) {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.R) return
        val now = System.currentTimeMillis()
        val retryDelay = PaymentScreenshotThrottle.retryDelayMs(
            lastScreenshotAtMs,
            now,
            SCREENSHOT_MIN_INTERVAL_MS,
        )
        if (retryDelay > 0) {
            scheduleScreenshotRetry(sourcePackage, windowId, retryDelay)
            return
        }
        lastScreenshotAtMs = now
        val service = this
        val displayFallbackStarted = AtomicBoolean(false)
        lateinit var startDisplayFallback: () -> Unit
        fun callback(fallbackOnUnparsed: Boolean) = object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                val bitmap = android.graphics.Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)
                    ?.copy(android.graphics.Bitmap.Config.ARGB_8888, false)
                result.hardwareBuffer.close()
                if (bitmap == null) {
                    PaymentAccessibilityStatus.onParserResult("ocr_no_bitmap")
                    if (fallbackOnUnparsed) startDisplayFallback() else scheduleMiss(sourcePackage)
                    return
                }
                runCatching {
                    service.worker.execute {
                        val verifier = ocrVerifier ?: runCatching {
                            PaymentScreenshotVerifier(MlKitOcrEngine(service)).also { ocrVerifier = it }
                        }.getOrElse { error ->
                            PaymentAccessibilityStatus.onParserResult("ocr_engine_unavailable")
                            Log.w(TAG, "OCR engine unavailable", error)
                            bitmap.recycle()
                            reportMiss(sourcePackage)
                            return@execute
                        }
                        val enrichment = runCatching {
                            kotlinx.coroutines.runBlocking {
                                verifier.verify(bitmap, sourcePackage, System.currentTimeMillis())
                            }
                        }.getOrNull()
                        bitmap.recycle()
                        if (enrichment == null) {
                            PaymentAccessibilityStatus.onParserResult("ocr_unparsed")
                            if (fallbackOnUnparsed) {
                                mainHandler.post { startDisplayFallback() }
                            } else {
                                reportMiss(sourcePackage)
                            }
                            return@execute
                        }
                        PaymentAccessibilityStatus.onParserResult(
                            "ocr amount=${enrichment.amountMinor ?: "unknown"} direction=${enrichment.direction ?: "unknown"}",
                        )
                        val account = runCatching {
                            NotificationSessionProvider(service).currentAccount()
                        }.getOrNull()
                        if (account != null && account.financeEntitled) {
                            // Completes the *existing* candidate/hint for this
                            // package; it never creates a second transaction.
                            runCatching {
                                val outcome = AndroidPaymentRecognitionHook.get(service)
                                    .onAccessibilityEnrichment(account.accountId, enrichment)
                                val result = when (outcome) {
                                    is EnrichmentOutcome.Applied -> "applied"
                                    is EnrichmentOutcome.Insufficient -> "insufficient"
                                    is EnrichmentOutcome.Rejected -> "rejected:${outcome.reason}"
                                }
                                Log.i(TAG, "ocr-enrichment result=$result")
                            }
                        }
                    }
                }.onFailure { bitmap.recycle() }
            }

            override fun onFailure(errorCode: Int) {
                if (fallbackOnUnparsed) {
                    Log.i(TAG, "window screenshot failed code=$errorCode; using display fallback")
                    startDisplayFallback()
                } else {
                    PaymentAccessibilityStatus.onParserResult("ocr_screenshot_failed_$errorCode")
                    scheduleMiss(sourcePackage)
                }
            }
        }
        val displayCallback = callback(fallbackOnUnparsed = false)
        startDisplayFallback = displayFallback@{
            if (!displayFallbackStarted.compareAndSet(false, true)) return@displayFallback
            runCatching {
                takeScreenshot(android.view.Display.DEFAULT_DISPLAY, mainExecutor, displayCallback)
            }.onFailure {
                PaymentAccessibilityStatus.onParserResult("ocr_screenshot_unavailable")
                Log.w(TAG, "display screenshot request unavailable: ${it.javaClass.simpleName}")
                scheduleMiss(sourcePackage)
            }
        }
        val windowScreenshotStarted = if (
            android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE && windowId != null
        ) {
            runCatching {
                takeScreenshotOfWindow(windowId, mainExecutor, callback(fallbackOnUnparsed = true))
            }.isSuccess
        } else {
            false
        }
        if (!windowScreenshotStarted) {
            startDisplayFallback()
        }
    }

    /**
     * The page could not be read. Misses are diagnostic while the ticket stays
     * active; the coordinator closes it only at the advertised expiry.
     */
    private fun reportMiss(sourcePackage: String) {
        val account = runCatching { NotificationSessionProvider(this).currentAccount() }.getOrNull() ?: return
        if (!account.financeEntitled) return
        runCatching {
            AndroidPaymentRecognitionHook.get(this).onAccessibilityMiss(account.accountId, sourcePackage)
        }
    }

    private fun scheduleMiss(sourcePackage: String) {
        runCatching { worker.execute { reportMiss(sourcePackage) } }
    }

    private fun scheduleScreenshotRetry(sourcePackage: String, windowId: Int?, delayMs: Long) {
        if (!screenshotRetryPackages.add(sourcePackage)) return
        mainHandler.postDelayed({
            screenshotRetryPackages.remove(sourcePackage)
            runCatching {
                worker.execute {
                    val account = runCatching { NotificationSessionProvider(this).currentAccount() }.getOrNull()
                    val ticket = if (account != null && account.financeEntitled) {
                        runCatching {
                            RoomPaymentRecognitionStore(NotificationDatabase.get(this))
                                .activeTicketForPackage(account.accountId, sourcePackage)
                        }.getOrNull()
                    } else {
                        null
                    }
                    if (ticket != null && tickets.isActive(ticket)) {
                        mainHandler.post {
                            requestScreenshotVerification(
                                sourcePackage,
                                lastWindowIds[sourcePackage] ?: windowId,
                            )
                        }
                    }
                }
            }
        }, delayMs.coerceAtLeast(1L))
    }

    private fun maybeRetryAfterSystemOverlay(eventPackage: String) {
        val targetPackage = lastTicketPackage
        val elapsed = System.currentTimeMillis() - lastTicketEventAtMs
        if (targetPackage.isBlank() || !PaymentOverlayRetryPolicy.shouldRetry(eventPackage, elapsed)) return
        scheduleScreenshotRetry(targetPackage, lastTicketWindowId, 1L)
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

    private fun packageWindowId(sourcePackage: String): Int? = runCatching {
        windows
            ?.firstOrNull { window -> window?.root?.packageName?.toString() == sourcePackage }
            ?.id
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
        /** One OCR attempt per window; never a screenshot loop. */
        private const val SCREENSHOT_MIN_INTERVAL_MS = 4_000L
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
