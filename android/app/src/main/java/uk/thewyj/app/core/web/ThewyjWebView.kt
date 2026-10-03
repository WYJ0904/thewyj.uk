package uk.thewyj.app.core.web

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.util.Log
import android.webkit.ConsoleMessage
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.core.speech.AndroidSpeechBridge
import uk.thewyj.app.task21.payment.PaymentReviewSignals
import java.net.URI
import java.net.URLDecoder
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest
import kotlin.coroutines.resume
import org.json.JSONObject

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ThewyjWebView(
    route: String,
    navigationEpoch: Int,
    sessionEpoch: Int,
    backNavigationRequest: Int,
    onRefreshSession: () -> Unit,
    onLogout: () -> Unit,
    onRouteChanged: (String) -> Unit,
    onCanGoBackChanged: (Boolean) -> Unit,
    onMainFrameError: (String) -> Unit,
    onThemeChanged: (Boolean) -> Unit = {},
    onVerifyPayment: (String) -> Unit = {},
    modifier: Modifier = Modifier,
    onUnhandledBack: () -> Unit = {},
    active: Boolean = true,
) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val lifecycleState by lifecycle.currentStateFlow.collectAsState()
    val effectiveActive = active && lifecycleState.isAtLeast(Lifecycle.State.RESUMED)
    val currentActive = rememberUpdatedState(effectiveActive)
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val policy = remember { WebRoutePolicy(BuildConfig.THEWYJ_BASE_URL) }
    val loads = remember { WebLoadPolicy(sessionEpoch) }
    val initialBackRequest = remember { backNavigationRequest }
    val refreshCallback = rememberUpdatedState(onRefreshSession)
    val logoutCallback = rememberUpdatedState(onLogout)
    val routeCallback = rememberUpdatedState(onRouteChanged)
    val canGoBackCallback = rememberUpdatedState(onCanGoBackChanged)
    val errorCallback = rememberUpdatedState(onMainFrameError)
    val themeCallback = rememberUpdatedState(onThemeChanged)
    val verifyPaymentCallback = rememberUpdatedState(onVerifyPayment)
    val unhandledBackCallback = rememberUpdatedState(onUnhandledBack)
    val pendingFileSelection = remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    // Speech runs fully off the navigation callback: handle() only enqueues and
    // reports failures through the same notice channel as page errors.
    val speechBridge = remember { AndroidSpeechBridge(context) { message -> errorCallback.value(message) } }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = pendingFileSelection.value
        pendingFileSelection.value = null
        val selected = if (result.resultCode == Activity.RESULT_OK) {
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
                ?.filter { it.scheme == "content" }
                ?.toTypedArray()
                ?.takeIf { it.isNotEmpty() }
        } else null
        callback?.onReceiveValue(selected)
    }
    val webView = remember {
        createWebView(
            context = context,
            policy = policy,
            onRefreshSession = { refreshCallback.value() },
            onLogout = { logoutCallback.value() },
            onRouteChanged = { routeCallback.value(it) },
            onCanGoBackChanged = { canGoBackCallback.value(it) },
            onMainFrameError = { errorCallback.value(it) },
            speechBridge = speechBridge,
            onThemeChanged = { dark -> themeCallback.value(dark) },
            onVerifyPayment = { eventId -> verifyPaymentCallback.value(eventId) },
            onPageReady = { view ->
                view.syncPageActivity(currentActive.value)
                scope.launch { if (currentActive.value) view.publishPaymentLedger(context, policy) }
            },
            onChooseFiles = { callback, params ->
                pendingFileSelection.value?.onReceiveValue(null)
                pendingFileSelection.value = callback
                runCatching { filePicker.launch(params.createIntent()) }.onFailure {
                    pendingFileSelection.value = null
                    callback.onReceiveValue(null)
                    errorCallback.value("无法打开文件选择器，请检查系统文件应用")
                }
                true
            },
        )
    }

    AndroidView(factory = { webView }, modifier = modifier.fillMaxSize(), update = {
        it.visibility = if (effectiveActive) View.VISIBLE else View.INVISIBLE
    })
    LaunchedEffect(effectiveActive) {
        if (effectiveActive) webView.onResume()
        webView.syncPageActivity(effectiveActive)
        if (!effectiveActive) webView.onPause()
        if (effectiveActive) webView.publishPaymentLedger(context, policy)
    }
    LaunchedEffect(Unit) {
        PaymentReviewSignals.changes.collectLatest {
            if (currentActive.value) webView.publishPaymentLedger(context, policy)
        }
    }

    LaunchedEffect(navigationEpoch, sessionEpoch, effectiveActive) {
        if (!effectiveActive) return@LaunchedEffect
        webView.awaitViewport()
        val target = policy.urlFor(route)
        if (BuildConfig.DEBUG) Log.i("ThewyjSession", "web-navigation-ready width=${webView.width} height=${webView.height}")
        when (loads.next(navigationEpoch, sessionEpoch, webView.url == target)) {
            WebLoadAction.LOAD -> webView.loadUrl(target)
            WebLoadAction.NAVIGATE -> webView.navigateWithinDocument(policy, target)
            WebLoadAction.RELOAD -> webView.reload()
            WebLoadAction.NONE -> Unit
        }
    }
    LaunchedEffect(backNavigationRequest) {
        if (effectiveActive && backNavigationRequest != initialBackRequest) {
            webView.evaluateJavascript("Boolean(window.WYJAndroidNavigation?.back())") { handled ->
                if (handled != "true") {
                    if (webView.canGoBack()) webView.goBack() else unhandledBackCallback.value()
                }
            }
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            pendingFileSelection.value?.onReceiveValue(null)
            pendingFileSelection.value = null
            webView.stopLoading()
            speechBridge.shutdown()
            webView.removeAllViews()
            webView.destroy()
        }
    }
}

private suspend fun WebView.publishPaymentLedger(context: Context, policy: WebRoutePolicy) {
    val snapshot = withContext(Dispatchers.IO) {
        uk.thewyj.app.task21.payment.LocalPaymentLedger.snapshot(context.applicationContext)
    }
    val activeAccount = withContext(Dispatchers.IO) {
        uk.thewyj.app.task21.NotificationSessionProvider(context).currentAccount()?.accountId
    }
    if (visibility != View.VISIBLE || policy.decide(url.orEmpty()) != NavigationDecision.Internal) return
    if (snapshot != "null" && JSONObject(snapshot).optString("account_id") != activeAccount) return
    evaluateJavascript("""
        (() => {
          window.WYJLocalPaymentLedger = $snapshot;
          document.dispatchEvent(new CustomEvent('thewyj:payment-updated', { detail: $snapshot }));
        })();
    """.trimIndent(), null)
}

private fun WebView.syncPageActivity(active: Boolean) {
    // This signal is local to this document; process-wide pauseTimers is not used.
    evaluateJavascript("""
        (() => {
          if (!document.documentElement) return;
          const active = $active;
          document.documentElement.dataset.androidWebActive = String(active);
          document.dispatchEvent(new CustomEvent('thewyj:webview-active', { detail: { active } }));
        })();
    """.trimIndent(), null)
}

@SuppressLint("SetJavaScriptEnabled")
private fun createWebView(
    context: Context,
    policy: WebRoutePolicy,
    onRefreshSession: () -> Unit,
    onLogout: () -> Unit,
    onRouteChanged: (String) -> Unit,
    onCanGoBackChanged: (Boolean) -> Unit,
    onMainFrameError: (String) -> Unit,
    speechBridge: AndroidSpeechBridge,
    onThemeChanged: (Boolean) -> Unit,
    onVerifyPayment: (String) -> Unit,
    onPageReady: (WebView) -> Unit,
    onChooseFiles: (ValueCallback<Array<Uri>>, WebChromeClient.FileChooserParams) -> Boolean,
): WebView = WebView(context).apply {
    // WRAP_CONTENT lets Chromium compute a zero CSS viewport inside AndroidView.
    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    if (BuildConfig.DEBUG && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
        // Only fixed state markers; never page text, URLs, identities or credentials.
        WebViewCompat.addDocumentStartJavaScript(this, """
            (() => {
              let previous = '';
              const visible = id => {
                let e = document.getElementById(id);
                if (!e || !e.getClientRects().length) return false;
                for (; e; e = e.parentElement) {
                  const s = getComputedStyle(e);
                  if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
                }
                return true;
              };
              const sample = () => {
                const state = visible('authPanel') ? 'LOGIN_VISIBLE' : visible('navGuestActions') ? 'GUEST_VISIBLE' : visible('sessionRecovery') ? 'RESTORING' : visible('appShell') ? 'CONTENT' : 'STARTING';
                if (state !== previous) { console.info('WYJ_AUTH_UI:' + state); previous = state; }
                if (performance.now() < 20000) requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
            })();
        """.trimIndent(), setOf(BuildConfig.THEWYJ_BASE_URL))
    }
    settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        allowFileAccess = false
        allowContentAccess = false
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        javaScriptCanOpenWindowsAutomatically = false
        setSupportMultipleWindows(false)
        builtInZoomControls = false
        displayZoomControls = false
        // Dictation audio now comes from thewyj cloud TTS. The player starts in
        // the same tap that requests it, but the fetch/streaming delay must not
        // let WebView's autoplay policy block the cloud asset (real-device
        // report: the button "did nothing" when the voice package was missing).
        mediaPlaybackRequiresUserGesture = false
        userAgentString = "${userAgentString} thewyj-android/${BuildConfig.VERSION_NAME}"
        safeBrowsingEnabled = true
    }
    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
    val downloadView = this
    val transferDownloader = TransferShareDownloader(context.applicationContext) { status ->
        val detail = JSONObject()
            .put("state", status.state)
            .put("bytes", status.bytes)
            .put("total", status.total)
            .put("message", status.message)
            .toString()
        downloadView.post {
            runCatching {
                downloadView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('thewyj:transfer-download', { detail: $detail }))",
                    null,
                )
            }
        }
    }
    webChromeClient = object : WebChromeClient() {
        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            val allowed = setOf("STARTING", "RESTORING", "CONTENT", "LOGIN_VISIBLE", "GUEST_VISIBLE")
            val marker = message.message().removePrefix("WYJ_AUTH_UI:")
            if (BuildConfig.DEBUG && message.message().startsWith("WYJ_AUTH_UI:") && marker in allowed) {
                Log.i("ThewyjSession", "web-ui=$marker")
                return true
            }
            if (message.message() == "WYJ_SPEECH:request") {
                Log.i("ThewyjSpeech", "tts-request-from-web")
                return true
            }
            return false
        }
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            if (policy.decide(view.url.orEmpty()) != NavigationDecision.Internal) {
                callback.onReceiveValue(null)
                return true
            }
            return onChooseFiles(callback, params)
        }
    }
    webViewClient = object : WebViewClient() {
        /**
         * The web page is the single theme source of truth. It reports later
         * changes with `thewyj://theme/...`, but the theme it resolved during
         * booting has to be read here: otherwise the native shell kept the
         * system theme while the page was light (or the reverse), and
         * 通知/我的 looked like a second app.
         */
        override fun onPageFinished(view: WebView, url: String?) {
            super.onPageFinished(view, url)
            onPageReady(view)
            runCatching {
                view.evaluateJavascript(
                    "(document.documentElement && document.documentElement.dataset.theme) || ''",
                ) { value ->
                    val theme = value?.trim()?.trim('"')?.lowercase().orEmpty()
                    if (theme == "dark" || theme == "light") {
                        onThemeChanged(theme == "dark")
                    }
                }
            }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame && policy.decide(request.url.toString()) == NavigationDecision.VerifyPayment) return true
            if (request.isForMainFrame && policy.spaRoute(request.url.toString()) != null) {
                view.navigateWithinDocument(policy, request.url.toString())
                return true
            }
            return handleNavigation(
                context, request.url.toString(), policy, onRefreshSession, onLogout,
                onSpeech = { speechBridge.handle(it) },
                onSpeechError = onMainFrameError,
                onTheme = onThemeChanged,
                onVerifyPayment = onVerifyPayment,
            )
        }

        @Deprecated("Deprecated by Android")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
            if (policy.spaRoute(url) != null) {
                view.navigateWithinDocument(policy, url)
                return true
            }
            return handleNavigation(
                context, url, policy, onRefreshSession, onLogout,
                onSpeech = { speechBridge.handle(it) },
                onSpeechError = onMainFrameError,
                onTheme = onThemeChanged,
                onVerifyPayment = onVerifyPayment,
            )
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) onMainFrameError("页面暂时无法连接，可稍后重试")
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            super.doUpdateVisitedHistory(view, url, isReload)
            url?.takeIf { policy.decide(it) == NavigationDecision.Internal }?.let(onRouteChanged)
            onCanGoBackChanged(view.canGoBack())
        }
    }
    setDownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
        if (TransferShareDownloadUrl.accepts(url, BuildConfig.THEWYJ_BASE_URL)) {
            transferDownloader.start(
                url, downloadName(url, contentDisposition), mimeType.orEmpty(),
                contentLength, userAgent.orEmpty(),
            )
            return@setDownloadListener
        }
        if (policy.decide(url) != NavigationDecision.Internal) return@setDownloadListener
        runCatching {
            val request = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mimeType)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setTitle(downloadName(url, contentDisposition))
                .setDescription("来自 Aeris 的下载")
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
            CookieManager.getInstance().getCookie(url)?.takeIf(String::isNotBlank)?.let {
                request.addRequestHeader("Cookie", it)
            }
            userAgent?.takeIf(String::isNotBlank)?.let { request.addRequestHeader("User-Agent", it) }
            (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
        }.onFailure {
            onMainFrameError("无法开始下载，请检查系统下载服务")
        }
    }
}

private fun WebView.navigateWithinDocument(policy: WebRoutePolicy, url: String) {
    val target = policy.spaRoute(url) ?: return
    // Queue only a route while JS starts. No credentials or native APIs are exposed.
    val value = JSONObject.quote(target)
    evaluateJavascript("""
        (() => {
          if (window.WYJAndroidNavigation) window.WYJAndroidNavigation.navigate($value);
          else window.__wyjPendingNavigation = $value;
        })();
    """.trimIndent(), null)
    if (BuildConfig.DEBUG) Log.i("ThewyjSession", "web-spa-navigation")
}

private suspend fun WebView.awaitViewport() {
    if (isLaidOut && width > 0 && height > 0) return
    suspendCancellableCoroutine { continuation ->
        val listener = object : View.OnLayoutChangeListener {
            override fun onLayoutChange(view: View, l: Int, t: Int, r: Int, b: Int, ol: Int, ot: Int, or: Int, ob: Int) {
                if (view.width <= 0 || view.height <= 0) return
                view.removeOnLayoutChangeListener(this)
                if (continuation.isActive) continuation.resume(Unit)
            }
        }
        addOnLayoutChangeListener(listener)
        continuation.invokeOnCancellation { removeOnLayoutChangeListener(listener) }
    }
}

private fun handleNavigation(
    context: Context,
    url: String,
    policy: WebRoutePolicy,
    onRefreshSession: () -> Unit,
    onLogout: () -> Unit,
    onSpeech: (Uri) -> String = { "" },
    onSpeechError: (String) -> Unit = {},
    onTheme: (Boolean) -> Unit = {},
    onVerifyPayment: (String) -> Unit = {},
): Boolean = when (policy.decide(url)) {
    NavigationDecision.Internal -> false
    NavigationDecision.RefreshSession -> true.also { onRefreshSession() }
    NavigationDecision.Logout -> true.also { onLogout() }
    NavigationDecision.Speech -> true.also {
        val message = onSpeech(Uri.parse(url))
        if (message.isNotBlank()) onSpeechError(message)
    }
    NavigationDecision.Theme -> true.also {
        onTheme(Uri.parse(url).path == "/dark")
    }
    NavigationDecision.VerifyPayment -> true.also {
        val eventId = Uri.parse(url).getQueryParameter("event_id").orEmpty()
        if (Regex("^[A-Za-z0-9._:-]{8,80}$").matches(eventId)) onVerifyPayment(eventId)
        else onSpeechError("交易标识无效，无法开始核实")
    }
    NavigationDecision.External -> true.also {
        if (Uri.parse(url).scheme in setOf("http", "https")) ExternalBrowser.open(context, url)
        else runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }
    NavigationDecision.Blocked -> true
}

internal fun downloadName(url: String, contentDisposition: String): String {
    val encoded = Regex("(?:^|;)\\s*filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE)
        .find(contentDisposition)
        ?.groupValues
        ?.getOrNull(1)
        ?.let { runCatching { URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") }.getOrNull() }
    val plain = Regex("(?:^|;)\\s*filename=\"([^\"]+)\"", RegexOption.IGNORE_CASE)
        .find(contentDisposition)
        ?.groupValues
        ?.getOrNull(1)
    val fallback = runCatching { URI(url).path.substringAfterLast('/').ifBlank { "thewyj-download" } }
        .getOrDefault("thewyj-download")
    val safe = (encoded ?: plain ?: fallback).replace(Regex("[\\r\\n/\\\\]"), "_").trim()
    if (safe.length <= 120) return safe.ifBlank { "thewyj-download" }
    val extension = safe.substringAfterLast('.', "").takeIf { it.length in 1..16 }
        ?.let { ".$it" }.orEmpty()
    return safe.take(120 - extension.length) + extension
}
