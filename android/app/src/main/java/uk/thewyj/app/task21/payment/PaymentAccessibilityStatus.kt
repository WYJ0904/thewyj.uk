package uk.thewyj.app.task21.payment

import android.util.Log

/**
 * Auditable state of the payment AccessibilityService.
 *
 * The device report was "设置里显示已开启，但功能完全没效果", so the service now
 * records concrete evidence: connected flag, last event package/type/time, how
 * many text lines the page produced and the parser result. Only package names,
 * counts and parser results are logged — never the notification/page text.
 */
object PaymentAccessibilityStatus {
    const val TAG = "ThewyjAccessibility"

    @Volatile var connected: Boolean = false
        private set
    @Volatile var lastEventPackage: String = ""
        private set
    @Volatile var lastEventType: String = ""
        private set
    @Volatile var lastEventAtMs: Long = 0
        private set
    @Volatile var lastTextLineCount: Int = 0
        private set
    @Volatile var lastParserResult: String = "none"
        private set
    @Volatile var activeTicketPackages: String = ""
        private set
    @Volatile var lastSkipped: String = "none"
        private set

    private var lastLoggedAtMs = 0L
    private val parserThrottle = PaymentLogThrottle()

    fun onConnected() {
        connected = true
        emit("accessibility-connected")
    }

    fun onDisconnected() {
        connected = false
        emit("accessibility-disconnected")
    }

    fun onEvent(packageName: String, eventType: Int) {
        lastEventPackage = packageName
        lastEventType = eventTypeName(eventType)
        lastEventAtMs = System.currentTimeMillis()
        // Events can fire dozens of times per second; keep the log readable.
        if (lastEventAtMs - lastLoggedAtMs > 2_000) {
            lastLoggedAtMs = lastEventAtMs
            emit("accessibility-event pkg=$packageName type=$lastEventType")
        }
    }

    fun onPageRead(textLineCount: Int) {
        lastTextLineCount = textLineCount
    }

    fun onParserResult(result: String) {
        lastParserResult = result
        // A ticket is open, so every result matters; still collapse identical
        // repeats so a chatty page cannot flood the log.
        if (parserThrottle.allow(result)) {
            emit("accessibility-parser result=$result lines=$lastTextLineCount")
        }
    }

    /**
     * An event was skipped before any page read (no ticket for that package).
     * These are the SystemUI/launcher/IME events that used to flood the log.
     */
    fun onSkipped(sourcePackage: String, reason: String) {
        lastSkipped = reason
        if (parserThrottle.allow("skip:$reason")) {
            emit("accessibility-skip reason=$reason pkg=$sourcePackage")
        }
    }

    fun onTicketPackages(packages: Collection<String>) {
        activeTicketPackages = packages.sorted().joinToString(",")
    }

    /**
     * #10: the event was allowed through on the ticket-created signal before the
     * 3 second package cache caught up. This is not a skip - the page is read and
     * the worker re-checks the Room ticket - but the counter makes the race
     * visible in a device log.
     */
    fun onTicketSignal(packageName: String) {
        if (parserThrottle.allow("ticket-signal")) {
            emit("accessibility-ticket-signal pkg=$packageName")
        }
    }

    fun snapshot(): String = buildString {
        append("enabled=true connected=").append(connected)
        append(" lastPackage=").append(lastEventPackage.ifBlank { "-" })
        append(" lastType=").append(lastEventType.ifBlank { "-" })
        append(" lastEventAt=").append(lastEventAtMs)
        append(" lastLines=").append(lastTextLineCount)
        append(" parser=").append(lastParserResult)
        append(" tickets=").append(activeTicketPackages.ifBlank { "-" })
        append(" skipped=").append(lastSkipped)
    }

    fun eventTypeName(eventType: Int): String = when (eventType) {
        android.view.accessibility.AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> "window_state"
        android.view.accessibility.AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> "window_content"
        android.view.accessibility.AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> "view_text"
        android.view.accessibility.AccessibilityEvent.TYPE_WINDOWS_CHANGED -> "windows_changed"
        else -> "type_$eventType"
    }

    private fun emit(line: String) {
        runCatching { Log.i(TAG, line) }
    }
}
