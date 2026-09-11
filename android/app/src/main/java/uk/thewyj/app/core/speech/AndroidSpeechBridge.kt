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
data class SpeechPlan(
    /** null means "let the engine decide for this locale". */
    val voice: SpeechVoiceInfo?,
    val language: String,
    val stage: String,
)

object SpeechVoicePolicy {
    /**
     * Fallback ladder: preferred local voice → any installed local voice of the
     * language → network voice of the language → engine locale default. Only
     * when even the locale is unavailable does the UI ask for voice data.
     * A missing en-US voice must never mean "no English TTS".
     */
    fun plan(voices: List<SpeechVoiceInfo>, language: String): SpeechPlan {
        val wanted = language.trim().ifBlank { "en-US" }
        val target = wanted.lowercase().substringBefore('-')
        val exact = voices.filter { it.localeTag.equals(wanted, ignoreCase = true) }
        val sameLanguage = voices.filter { it.language.lowercase() == target }
        val byPreference = compareByDescending<SpeechVoiceInfo> { it.localeTag.equals(wanted, ignoreCase = true) }
            .thenByDescending { it.quality }
            .thenBy { it.name }
        val ladder = listOf(
            "preferred-local" to exact.filter { !it.requiresNetwork },
            "any-local" to sameLanguage.filter { !it.requiresNetwork },
            "network" to (exact + sameLanguage).filter { it.requiresNetwork },
        )
        for ((stage, pool) in ladder) {
            if (pool.isNotEmpty()) return SpeechPlan(pool.sortedWith(byPreference).first(), wanted, stage)
        }
        return SpeechPlan(null, wanted, "locale-default")
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
        val plan = SpeechVoicePolicy.plan(voices, request.language)
        val locale = Locale.forLanguageTag(plan.language)
        val availability = engine.isLanguageAvailable(locale)
        Log.i(
            TAG,
            "tts-plan stage=${plan.stage} engine=${engine.defaultEngine ?: "-"} voices=${voices.size} " +
                "selected=${plan.voice?.name ?: "-"} locale=${plan.voice?.localeTag ?: plan.language} " +
                "network=${plan.voice?.requiresNetwork ?: false} isLanguageAvailable=$availability",
        )
        plan.voice?.let { selected ->
            engine.voices?.firstOrNull { it.name == selected.name }?.let { engine.voice = it }
        }
        engine.setLanguage(locale)
        if (availability == TextToSpeech.LANG_MISSING_DATA || availability == TextToSpeech.LANG_NOT_SUPPORTED) {
            val label = if (plan.language.lowercase().startsWith("ja")) "日语" else "英语"
            onError("系统语音引擎不支持${label}，请在系统设置中安装${label}语音数据后重试。")
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
