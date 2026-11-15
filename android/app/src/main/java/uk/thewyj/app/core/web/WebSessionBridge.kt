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
import android.util.Log
import uk.thewyj.app.BuildConfig

interface WebSessionController {
    suspend fun installAccessCookie(accessToken: String, expiresAtEpochMs: Long)
    suspend fun clearAccountData()
    suspend fun hasAccessCookie(): Boolean = true
}

class WebSessionException : IllegalStateException("网页会话尚未就绪，凭据已保留，请重试")

private const val MIN_ACCESS_COOKIE_SECONDS = 60L
private const val MAX_ACCESS_COOKIE_SECONDS = 15L * 60L

internal fun computeAccessCookieMaxAgeSeconds(
    expiresAtEpochMs: Long,
    nowEpochMs: Long = System.currentTimeMillis(),
): Long {
    val remaining = (expiresAtEpochMs - nowEpochMs) / 1_000L
    // Never emit Max-Age=0 during active cookie installation: Chromium treats
    // Max-Age=0 as immediate cookie deletion if a device clock is ahead of UTC.
    return remaining.coerceIn(MIN_ACCESS_COOKIE_SECONDS, MAX_ACCESS_COOKIE_SECONDS)
}

class WebSessionBridge(
    private val context: Context,
    baseUrl: String,
) : WebSessionController {
    private val baseUrl = baseUrl.trimEnd('/')
    private val host = URI(this.baseUrl).host

    override suspend fun installAccessCookie(accessToken: String, expiresAtEpochMs: Long) = withContext(Dispatchers.Main.immediate) {
        val seconds = computeAccessCookieMaxAgeSeconds(expiresAtEpochMs)
        val cookie = "__Host-wyj_app_access=$accessToken; Path=/; Max-Age=$seconds; Secure; HttpOnly; SameSite=Strict"
        suspendCancellableCoroutine { continuation ->
            CookieManager.getInstance().apply {
                setAcceptCookie(true)
                setCookie(baseUrl, cookie) { accepted ->
                    if (!continuation.isActive) return@setCookie
                    if (accepted) {
                        flush()
                        if (BuildConfig.DEBUG) Log.i("ThewyjSession", "cookie-install-complete")
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

    override suspend fun hasAccessCookie(): Boolean = withContext(Dispatchers.Main.immediate) {
        cookieHeader().contains("__Host-wyj_app_access=")
    }

    fun cookieHeader(): String = CookieManager.getInstance().getCookie("https://$host").orEmpty()
}
