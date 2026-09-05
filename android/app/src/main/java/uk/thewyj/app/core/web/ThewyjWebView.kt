package uk.thewyj.app.core.web

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
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
        val target = policy.urlFor(route)
        when (loads.next(navigationEpoch, sessionEpoch, webView.url == target)) {
            WebLoadAction.LOAD -> webView.loadUrl(target)
            WebLoadAction.RELOAD -> webView.reload()
            WebLoadAction.NONE -> Unit
        }
    }
    LaunchedEffect(backNavigationRequest) {
        if (backNavigationRequest != initialBackRequest && webView.canGoBack()) webView.goBack()
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
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
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
            return handleNavigation(context, request.url.toString(), policy, onRefreshSession, onLogout)
        }

        @Deprecated("Deprecated by Android")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
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
