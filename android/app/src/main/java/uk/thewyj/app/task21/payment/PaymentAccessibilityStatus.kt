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

    private var lastLoggedAtMs = 0L

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
        emit("accessibility-parser result=$result lines=$lastTextLineCount")
    }

    fun snapshot(): String = buildString {
        append("enabled=true connected=").append(connected)
        append(" lastPackage=").append(lastEventPackage.ifBlank { "-" })
        append(" lastType=").append(lastEventType.ifBlank { "-" })
        append(" lastEventAt=").append(lastEventAtMs)
        append(" lastLines=").append(lastTextLineCount)
        append(" parser=").append(lastParserResult)
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
