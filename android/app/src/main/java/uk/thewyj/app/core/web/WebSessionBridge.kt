package uk.thewyj.app.core.web

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebViewDatabase
import kotlinx.coroutines.suspendCancellableCoroutine
import java.net.URI
import kotlin.coroutines.resume

interface WebSessionController {
    suspend fun installAccessCookie(accessToken: String, expiresAtEpochMs: Long)
    suspend fun clearAccountData()
}

class WebSessionBridge(
    private val context: Context,
    baseUrl: String,
) : WebSessionController {
    private val baseUrl = baseUrl.trimEnd('/')
    private val host = URI(this.baseUrl).host

    override suspend fun installAccessCookie(accessToken: String, expiresAtEpochMs: Long) {
        val seconds = ((expiresAtEpochMs - System.currentTimeMillis()) / 1_000L)
            .coerceIn(0L, 15L * 60L)
        val cookie = "__Host-wyj_app_access=$accessToken; Path=/; Max-Age=$seconds; Secure; HttpOnly; SameSite=Strict"
        suspendCancellableCoroutine { continuation ->
            CookieManager.getInstance().apply {
                setAcceptCookie(true)
                setCookie(baseUrl, cookie) { continuation.resume(Unit) }
                flush()
            }
        }
    }

    override suspend fun clearAccountData() {
        suspendCancellableCoroutine { continuation ->
            CookieManager.getInstance().removeAllCookies {
                CookieManager.getInstance().flush()
                continuation.resume(Unit)
            }
        }
        WebStorage.getInstance().deleteAllData()
        WebViewDatabase.getInstance(context).apply {
            clearHttpAuthUsernamePassword()
        }
    }

    fun cookieHeader(): String = CookieManager.getInstance().getCookie("https://$host").orEmpty()
}
