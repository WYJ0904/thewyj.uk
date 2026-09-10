package uk.thewyj.app.core.speech

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Android TextToSpeech for dictation.
 *
 * Android WebView ships a Web Speech API stub that accepts utterances without
 * producing audio, so the trusted web app asks the native engine through the
 * existing `thewyj://speech` navigation channel (never a universal
 * JavaScript interface). Failures return a readable message for the UI.
 */
class AndroidSpeechBridge(context: Context) {
    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    private var ready = false

    init {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            createEngine()
        } else {
            mainHandler.post { createEngine() }
        }
    }

    private fun createEngine() {
        if (engine != null) return
        engine = TextToSpeech(appContext) { status ->
            ready = status == TextToSpeech.SUCCESS
        }
    }

    /** Handles `thewyj://speech/speak` and `/stop`; returns "" when accepted. */
    fun handle(uri: Uri): String = when (uri.path) {
        "/speak" -> speak(
            text = uri.getQueryParameter("text").orEmpty(),
            language = uri.getQueryParameter("lang").orEmpty(),
            rate = uri.getQueryParameter("rate")?.toFloatOrNull() ?: 0.9f,
        )
        "/stop" -> {
            mainHandler.post { runCatching { engine?.stop() } }
            ""
        }
        else -> "语音请求无效。"
    }

    private fun speak(text: String, language: String, rate: Float): String {
        val value = text.trim().take(200)
        if (value.isEmpty()) return "没有可朗读的内容。"
        val latch = CountDownLatch(1)
        var message = ""
        mainHandler.post {
            try {
                val engine = engine ?: TextToSpeech(appContext) { ready = it == TextToSpeech.SUCCESS }
                    .also { this.engine = it }
                message = when {
                    !ready -> "系统语音引擎尚未就绪，请稍后重试。"
                    else -> {
                        val locale = if (language.lowercase().startsWith("ja")) Locale.JAPANESE else Locale.US
                        val availability = engine.setLanguage(locale)
                        when {
                            availability == TextToSpeech.LANG_MISSING_DATA ||
                                availability == TextToSpeech.LANG_NOT_SUPPORTED ->
                                "系统语音引擎缺少对应语言的语音包，请在系统设置中下载语音数据后重试。"
                            else -> {
                                engine.setSpeechRate(rate.takeIf { it in 0.4f..2.0f } ?: 0.9f)
                                val queued = engine.speak(value, TextToSpeech.QUEUE_FLUSH, null, "thewyj-dictation")
                                if (queued == TextToSpeech.SUCCESS) "" else "语音播放失败，请检查系统「文字转语音」设置。"
                            }
                        }
                    }
                }
            } catch (_: Throwable) {
                message = "语音播放失败，请检查系统「文字转语音」设置。"
            } finally {
                latch.countDown()
            }
        }
        latch.await(2_000, TimeUnit.MILLISECONDS)
        return message
    }

    fun shutdown() {
        mainHandler.post {
            runCatching { engine?.stop() }
            runCatching { engine?.shutdown() }
            engine = null
            ready = false
        }
    }
}
