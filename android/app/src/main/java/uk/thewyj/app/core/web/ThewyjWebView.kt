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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import uk.thewyj.app.BuildConfig
import java.net.URI
import kotlinx.coroutines.suspendCancellableCoroutine
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
    modifier: Modifier = Modifier,
    onUnhandledBack: () -> Unit = {},
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val policy = remember { WebRoutePolicy(BuildConfig.THEWYJ_BASE_URL) }
    val loads = remember { WebLoadPolicy(sessionEpoch) }
    val initialBackRequest = remember { backNavigationRequest }
    val refreshCallback = rememberUpdatedState(onRefreshSession)
    val logoutCallback = rememberUpdatedState(onLogout)
    val routeCallback = rememberUpdatedState(onRouteChanged)
    val canGoBackCallback = rememberUpdatedState(onCanGoBackChanged)
    val errorCallback = rememberUpdatedState(onMainFrameError)
    val unhandledBackCallback = rememberUpdatedState(onUnhandledBack)
    val pendingFileSelection = remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
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

    AndroidView(factory = { webView }, modifier = modifier.fillMaxSize())

    LaunchedEffect(navigationEpoch, sessionEpoch) {
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
        if (backNavigationRequest != initialBackRequest) {
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
            webView.removeAllViews()
            webView.destroy()
        }
    }
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
        mediaPlaybackRequiresUserGesture = true
        userAgentString = "${userAgentString} thewyj-android/${BuildConfig.VERSION_NAME}"
        safeBrowsingEnabled = true
    }
    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
    webChromeClient = object : WebChromeClient() {
        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            val allowed = setOf("STARTING", "RESTORING", "CONTENT", "LOGIN_VISIBLE", "GUEST_VISIBLE")
            val marker = message.message().removePrefix("WYJ_AUTH_UI:")
            if (BuildConfig.DEBUG && message.message().startsWith("WYJ_AUTH_UI:") && marker in allowed) {
                Log.i("ThewyjSession", "web-ui=$marker")
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
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.isForMainFrame && policy.spaRoute(request.url.toString()) != null) {
                view.navigateWithinDocument(policy, request.url.toString())
                return true
            }
            return handleNavigation(context, request.url.toString(), policy, onRefreshSession, onLogout)
        }

        @Deprecated("Deprecated by Android")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
            if (policy.spaRoute(url) != null) {
                view.navigateWithinDocument(policy, url)
                return true
            }
            return handleNavigation(context, url, policy, onRefreshSession, onLogout)
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
    setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
        if (policy.decide(url) != NavigationDecision.Internal) return@setDownloadListener
        runCatching {
            val request = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mimeType)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setTitle(downloadName(url, contentDisposition))
                .setDescription("来自 thewyj 的下载")
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
            CookieManager.getInstance().getCookie(url)?.takeIf(String::isNotBlank)?.let {
                request.addRequestHeader("Cookie", it)
            }
            request.addRequestHeader("User-Agent", userAgent)
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
): Boolean = when (policy.decide(url)) {
    NavigationDecision.Internal -> false
    NavigationDecision.RefreshSession -> true.also { onRefreshSession() }
    NavigationDecision.Logout -> true.also { onLogout() }
    NavigationDecision.External -> true.also {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }
    NavigationDecision.Blocked -> true
}

private fun downloadName(url: String, contentDisposition: String): String {
    val encoded = Regex("filename\\*?=(?:UTF-8''|\")?([^\";]+)", RegexOption.IGNORE_CASE)
        .find(contentDisposition)
        ?.groupValues
        ?.getOrNull(1)
        ?.let(Uri::decode)
    val fallback = runCatching { URI(url).path.substringAfterLast('/').ifBlank { "thewyj-download" } }
        .getOrDefault("thewyj-download")
    return (encoded ?: fallback).replace(Regex("[\\r\\n/\\\\]"), "_").take(120)
}
