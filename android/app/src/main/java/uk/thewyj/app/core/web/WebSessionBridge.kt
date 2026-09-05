package uk.thewyj.app.core.web

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebViewDatabase
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URI
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

interface WebSessionController {
    suspend fun installAccessCookie(accessToken: String, expiresAtEpochMs: Long)
    suspend fun clearAccountData()
}

class WebSessionException : IllegalStateException("网页会话尚未就绪，凭据已保留，请重试")

class WebSessionBridge(
    private val context: Context,
    baseUrl: String,
) : WebSessionController {
    private val baseUrl = baseUrl.trimEnd('/')
    private val host = URI(this.baseUrl).host

    override suspend fun installAccessCookie(accessToken: String, expiresAtEpochMs: Long) = withContext(Dispatchers.Main.immediate) {
        val seconds = ((expiresAtEpochMs - System.currentTimeMillis()) / 1_000L)
            .coerceIn(0L, 15L * 60L)
        val cookie = "__Host-wyj_app_access=$accessToken; Path=/; Max-Age=$seconds; Secure; HttpOnly; SameSite=Strict"
        suspendCancellableCoroutine { continuation ->
            CookieManager.getInstance().apply {
                setAcceptCookie(true)
                setCookie(baseUrl, cookie) { accepted ->
                    if (!continuation.isActive) return@setCookie
                    if (accepted) {
                        flush()
                        continuation.resume(Unit)
                    } else {
                        continuation.resumeWithException(WebSessionException())
                    }
                }
            }
        }
    }

    override suspend fun clearAccountData() = withContext(Dispatchers.Main.immediate) {
        suspendCancellableCoroutine { continuation ->
            CookieManager.getInstance().removeAllCookies {
                CookieManager.getInstance().flush()
                if (continuation.isActive) continuation.resume(Unit)
            }
        }
        WebStorage.getInstance().deleteAllData()
        WebViewDatabase.getInstance(context).clearHttpAuthUsernamePassword()
    }

    fun cookieHeader(): String = CookieManager.getInstance().getCookie("https://$host").orEmpty()
}
