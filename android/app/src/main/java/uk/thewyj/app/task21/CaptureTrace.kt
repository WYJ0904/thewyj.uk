package uk.thewyj.app.task21

import android.util.Log

/**
 * End-to-end timing trace for one captured notification.
 *
 * Real-device reports showed notifications arriving late or never, so every
 * stage now logs the same key-derived trace id with the elapsed milliseconds
 * since the listener received it:
 *   listener-received → archive-accepted → room-committed → flow-emitted → ui-rendered
 */
object CaptureTrace {
    const val TAG = "ThewyjCapture"

    /** Test hook: receives every stage line in order. */
    @Volatile
    var observer: ((String) -> Unit)? = null

    private val started = java.util.concurrent.ConcurrentHashMap<String, Long>()

    fun traceId(notificationKey: String, sourcePackage: String, notificationId: Int): String {
        val key = notificationKey.ifBlank { "$sourcePackage|$notificationId" }
        return key.take(80)
    }

    fun begin(traceId: String, sourcePackage: String, postTime: Long, channelId: String = "") {
        started[traceId] = System.currentTimeMillis()
        emit("listener-received trace=$traceId pkg=$sourcePackage postTime=$postTime channel=${channelId.ifBlank { "-" }}")
    }

    fun stage(traceId: String, stage: String, detail: String = "") {
        val start = started[traceId] ?: System.currentTimeMillis()
        val elapsed = System.currentTimeMillis() - start
        emit("$stage trace=$traceId elapsedMs=$elapsed${if (detail.isBlank()) "" else " $detail"}")
        if (stage == "ui-rendered") started.remove(traceId)
    }

    fun forget(traceId: String) {
        started.remove(traceId)
    }

    private fun emit(line: String) {
        observer?.invoke(line)
        runCatching { Log.i(TAG, line) }
    }
}
