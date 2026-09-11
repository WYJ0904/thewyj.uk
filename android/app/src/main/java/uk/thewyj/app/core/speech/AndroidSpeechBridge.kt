package uk.thewyj.app.core.speech

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/** Voice metadata used by the selection policy (pure data, unit testable). */
data class SpeechVoiceInfo(
    val name: String,
    val localeTag: String,
    val language: String,
    val requiresNetwork: Boolean,
    val quality: Int,
)

/**
 * English content must be spoken with an English voice. The previous build
 * accepted whatever voice the engine defaulted to, which is why the English
 * pronunciation sounded wrong on some devices.
 */
object SpeechVoicePolicy {
    fun select(voices: List<SpeechVoiceInfo>, language: String): SpeechVoiceInfo? {
        val target = language.trim().lowercase().substringBefore('-')
        if (target.isEmpty()) return null
        val candidates = voices.filter { it.language.lowercase() == target }
        if (candidates.isEmpty()) return null
        val offline = candidates.filter { !it.requiresNetwork }
        val pool = offline.ifEmpty { candidates }
        return pool.sortedWith(
            compareByDescending<SpeechVoiceInfo> { it.localeTag.equals(language, ignoreCase = true) }
                .thenByDescending { it.quality }
                .thenBy { it.name },
        ).first()
    }
}

/**
 * Android TextToSpeech for dictation.
 *
 * The engine is created once and reused. `handle()` only enqueues work on the
 * main thread and returns immediately, so the WebView navigation callback never
 * blocks; errors are reported asynchronously through [onError]. Each request
 * logs "tts-request" and, on the engine callback, "tts-utterance-start" with
 * the elapsed milliseconds so the click-to-sound latency is measurable.
 */
class AndroidSpeechBridge(
    context: Context,
    private val onError: (String) -> Unit = {},
) {
    private data class SpeechRequest(
        val text: String,
        val language: String,
        val rate: Float,
        val requestedAtMs: Long,
    )

    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    private var ready = false
    private var pending: SpeechRequest? = null
    private var currentRequest: SpeechRequest? = null
    private var initFailed = false

    init {
        if (Looper.myLooper() == Looper.getMainLooper()) createEngine() else mainHandler.post { createEngine() }
    }

    private fun createEngine() {
        if (engine != null) return
        engine = TextToSpeech(appContext) { status ->
            ready = status == TextToSpeech.SUCCESS
            if (ready) {
                Log.i(TAG, "tts-engine-ready")
                engine?.setOnUtteranceProgressListener(progressListener)
                pending?.let { request ->
                    pending = null
                    speakNow(request)
                }
            } else {
                initFailed = true
                Log.w(TAG, "tts-engine-init-failed status=$status")
                onError("系统语音引擎初始化失败，请检查系统「文字转语音」设置。")
            }
        }
    }

    private val progressListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            val request = currentRequest
            val elapsed = if (request != null) SystemClock.elapsedRealtime() - request.requestedAtMs else 0
            Log.i(TAG, "tts-utterance-start elapsedMs=$elapsed lang=${request?.language.orEmpty()}")
        }

        override fun onDone(utteranceId: String?) {
            Log.i(TAG, "tts-utterance-done")
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
            Log.w(TAG, "tts-utterance-error")
            onError("语音播放失败，请检查系统「文字转语音」设置。")
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            Log.w(TAG, "tts-utterance-error code=$errorCode")
            onError("语音播放失败，请检查系统「文字转语音」设置。")
        }
    }

    /** Handles `thewyj://speech/speak` and `/stop`; never blocks the caller. */
    fun handle(uri: Uri): String = when (uri.path) {
        "/speak" -> {
            val request = SpeechRequest(
                text = uri.getQueryParameter("text").orEmpty().trim().take(200),
                language = uri.getQueryParameter("lang").orEmpty().ifBlank { "en-US" },
                rate = uri.getQueryParameter("rate")?.toFloatOrNull() ?: 0.9f,
                requestedAtMs = SystemClock.elapsedRealtime(),
            )
            if (request.text.isEmpty()) {
                onError("没有可朗读的内容。")
            } else {
                Log.i(TAG, "tts-request lang=${request.language} chars=${request.text.length} ready=$ready")
                mainHandler.post { speakNow(request) }
            }
            ""
        }
        "/stop" -> {
            mainHandler.post { runCatching { engine?.stop() } }
            ""
        }
        else -> "语音请求无效。"
    }

    private fun speakNow(request: SpeechRequest) {
        val engine = engine ?: return
        if (!ready) {
            if (initFailed) {
                onError("系统语音引擎不可用，请在系统设置中安装「文字转语音」引擎。")
            } else {
                // Warm-up still running: keep the newest request and play it as
                // soon as the engine reports ready.
                pending = request
            }
            return
        }
        currentRequest = request
        val voices = engine.voices?.map { voice ->
            SpeechVoiceInfo(
                name = voice.name,
                localeTag = voice.locale.toLanguageTag(),
                language = voice.locale.language,
                requiresNetwork = voice.isNetworkConnectionRequired,
                quality = voice.quality,
            )
        }.orEmpty()
        val selected = SpeechVoicePolicy.select(voices, request.language)
        if (selected == null) {
            val label = if (request.language.lowercase().startsWith("ja")) "日语" else "英语"
            val message = "系统缺少${label}语音包，请在系统设置中下载${label}语音数据后重试。"
            Log.w(TAG, "tts-missing-voice lang=${request.language}")
            onError(message)
            return
        }
        engine.voices?.firstOrNull { it.name == selected.name }?.let { engine.voice = it }
        val availability = engine.setLanguage(Locale.forLanguageTag(selected.localeTag))
        if (availability == TextToSpeech.LANG_MISSING_DATA || availability == TextToSpeech.LANG_NOT_SUPPORTED) {
            onError("系统语音引擎不支持所选语言，请在系统设置中安装对应语音包。")
            return
        }
        engine.setSpeechRate(request.rate.coerceIn(0.4f, 2.0f))
        val queued = engine.speak(request.text, TextToSpeech.QUEUE_FLUSH, null, "thewyj-dictation")
        if (queued != TextToSpeech.SUCCESS) {
            onError("语音播放失败，请检查系统「文字转语音」设置。")
        }
    }

    fun shutdown() {
        mainHandler.post {
            pending = null
            currentRequest = null
            runCatching { engine?.stop() }
            runCatching { engine?.shutdown() }
            engine = null
            ready = false
        }
    }

    private companion object {
        const val TAG = "ThewyjSpeech"
    }
}
