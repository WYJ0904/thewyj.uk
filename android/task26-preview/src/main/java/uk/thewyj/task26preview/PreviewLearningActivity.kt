package uk.thewyj.task26preview

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.ByteArrayInputStream

/** Acceptance shell only. The production :app module and all its stores stay untouched. */
class PreviewLearningActivity : Activity() {
    private lateinit var web: WebView
    private var networkBlocked = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        check(packageName == PreviewScope.APPLICATION_ID)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val edges = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(edges.left, edges.top, edges.right, edges.bottom)
            WindowInsetsCompat.CONSUMED
        }
        val header = LinearLayout(this).apply { setBackgroundColor(Color.rgb(255, 224, 150)) }
        header.addView(TextView(this).apply {
            setText(R.string.preview_notice); setTextColor(Color.BLACK); textSize = 14f
            setPadding(12, 8, 8, 8)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val network = Button(this).apply {
            setText(R.string.network_online)
            setOnClickListener {
                networkBlocked = !networkBlocked
                web.settings.blockNetworkLoads = networkBlocked
                ServiceWorkerController.getInstance().serviceWorkerWebSettings.blockNetworkLoads = networkBlocked
                setText(if (networkBlocked) R.string.network_offline else R.string.network_online)
                Log.i("Task26Preview", if (networkBlocked) "NETWORK_BLOCKED" else "NETWORK_RESTORED")
            }
        }
        header.addView(network)
        root.addView(header)
        web = WebView(this).apply {
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
                mediaPlaybackRequiresUserGesture = false
                safeBrowsingEnabled = true
                userAgentString = "$userAgentString thewyj-android/${BuildConfig.VERSION_NAME} Task26Preview"
            }
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (PreviewScope.allowsNavigation(request.url.toString())) return false
                    Toast.makeText(this@PreviewLearningActivity, R.string.scope_blocked, Toast.LENGTH_SHORT).show()
                    return true
                }
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    if (PreviewScope.allowsRequest(request.url.toString())) null else blocked()
            }
            // No downloads, package installer, JavaScript interface or native session/payment bridge.
            setDownloadListener { _, _, _, _, _ -> }
        }
        ServiceWorkerController.getInstance().apply {
            serviceWorkerWebSettings.allowFileAccess = false
            serviceWorkerWebSettings.allowContentAccess = false
            setServiceWorkerClient(object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                    if (PreviewScope.allowsRequest(request.url.toString())) null else blocked()
            })
        }
        root.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(PreviewScope.ORIGIN + "/language/english")
        }
    }

    private fun blocked() = WebResourceResponse("application/json", "UTF-8", 403,
        "Preview scope blocked", mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream("{\"ok\":false,\"code\":\"task26_preview_scope_blocked\"}".toByteArray()))

    override fun onSaveInstanceState(outState: Bundle) {
        web.saveState(outState)
        super.onSaveInstanceState(outState)
    }
    override fun onPause() {
        web.evaluateJavascript("document.documentElement.dataset.androidWebActive='false';document.dispatchEvent(new CustomEvent('thewyj:webview-active',{detail:{active:false}}))", null)
        web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }
    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) {
            web.onResume()
            web.evaluateJavascript("document.documentElement.dataset.androidWebActive='true';document.dispatchEvent(new CustomEvent('thewyj:webview-active',{detail:{active:true}}))", null)
        }
    }
    override fun onDestroy() {
        web.stopLoading(); web.removeAllViews(); web.destroy()
        super.onDestroy()
    }
}
