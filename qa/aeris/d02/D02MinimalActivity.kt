package uk.thewyj.app.qa

import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.ContinuationInterceptor
import kotlin.coroutines.coroutineContext

/** Minimal WebView round trip, identical for the three test dispatcher hosts. */
class D02MinimalActivity : ComponentActivity() {
    var round by mutableIntStateOf(0)
    val completed = AtomicInteger(0)
    val errors = AtomicInteger(0)
    val webCalls = AtomicInteger(0)
    val offMainCalls = AtomicInteger(0)
    val loaded = AtomicBoolean(false)
    private val lock = Any()
    private val session = java.time.Instant.now().toString().replace(":", "-")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        check(packageName == "uk.thewyj.app.qa.d02")
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent {
            val web = remember { CheckedWebView() }
            AndroidView(factory = { web })
            DisposableEffect(web) { onDispose { web.destroy() } }
            val current = round
            LaunchedEffect(current) {
                if (current > 0) {
                    try {
                        mark("beforeIO", current, coroutineContext[ContinuationInterceptor]?.javaClass?.name)
                        repeat(3) { index ->
                            withContext(Dispatchers.IO) {
                                mark("insideIO-$index", current, coroutineContext[ContinuationInterceptor]?.javaClass?.name)
                                SystemClock.sleep(8)
                            }
                            mark("afterIO-$index", current, coroutineContext[ContinuationInterceptor]?.javaClass?.name)
                        }
                        web.url
                        val result = CompletableDeferred<String>()
                        web.evaluateJavascript("1+1") { result.complete(it) }
                        check(withTimeout(15_000) { result.await() } == "2")
                        web.onPause()
                        web.onResume()
                    } catch (error: Throwable) {
                        errors.incrementAndGet()
                        mark("ERROR", current, error = error)
                    } finally {
                        completed.set(current)
                        mark("round-complete", current)
                    }
                }
            }
        }
    }

    private fun mark(stage: String, iteration: Int = round, interceptor: String? = null, error: Throwable? = null) {
        val thread = Thread.currentThread()
        val row = JSONObject().put("utc", java.time.Instant.now().toString())
            .put("elapsedMs", SystemClock.elapsedRealtime()).put("stage", stage).put("round", iteration)
            .put("thread", thread.name).put("tid", android.os.Process.myTid())
            .put("mainLooper", Looper.myLooper() === Looper.getMainLooper())
            .put("looper", Looper.myLooper()?.thread?.name ?: "null")
            .put("interceptor", interceptor ?: JSONObject.NULL)
        if (error != null) row.put("stack", error.stackTraceToString())
        synchronized(lock) {
            val dir = File(getExternalFilesDir(null), "d02-evidence/$session").apply { mkdirs() }
            File(dir, "rounds.ndjson").appendText(row.toString() + "\n")
        }
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private inner class CheckedWebView : WebView(this@D02MinimalActivity) {
        init {
            settings.javaScriptEnabled = true
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) { loaded.set(true) }
            }
            // Entirely inline synthetic document; no network or private browser state.
            loadDataWithBaseURL("https://127.0.0.1:18787/minimal", "<!doctype html><title>D02 synthetic</title>", "text/html", "UTF-8", null)
        }
        private fun observe(operation: String) {
            webCalls.incrementAndGet()
            if (Looper.myLooper() !== Looper.getMainLooper()) offMainCalls.incrementAndGet()
            mark("web:$operation")
        }
        override fun getUrl(): String? { observe("getUrl"); return super.getUrl() }
        override fun evaluateJavascript(script: String, callback: ValueCallback<String>?) {
            observe("evaluateJavascript"); super.evaluateJavascript(script, callback)
        }
        override fun onPause() { observe("onPause"); super.onPause() }
        override fun onResume() { observe("onResume"); super.onResume() }
        override fun destroy() { observe("destroy"); super.destroy() }
    }
}
