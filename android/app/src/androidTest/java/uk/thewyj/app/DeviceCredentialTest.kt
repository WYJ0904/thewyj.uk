package uk.thewyj.app

import android.content.Context
import android.webkit.CookieManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.core.auth.AccountSnapshot
import uk.thewyj.app.core.auth.CredentialStorageException
import uk.thewyj.app.core.auth.DeviceCredentials
import uk.thewyj.app.core.auth.SecureCredentialStore
import uk.thewyj.app.core.network.ThewyjApiClient
import uk.thewyj.app.core.web.WebSessionBridge
import java.security.KeyStore
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class DeviceCredentialTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun credentials() = DeviceCredentials(
        "instrumented-access", System.currentTimeMillis() + 600_000,
        "instrumented-refresh", System.currentTimeMillis() + 86_400_000,
        "instrumented-session", AccountSnapshot("fixture", "fixture", "user", "财务会员", setOf("finance_access")),
    )

    @Test fun keystorePersistenceAndCorruptReadPreserveOriginalCiphertext() {
        val namespace = ".test-${UUID.randomUUID()}"
        val prefs = context.getSharedPreferences("uk.thewyj.app.secure.session.v1$namespace", Context.MODE_PRIVATE)
        try {
            val value = credentials()
            SecureCredentialStore(context, namespace).saveActive(value)
            val restored = SecureCredentialStore(context, namespace).loadActive()
            assertEquals(value, restored)
            assertFalse(prefs.all.toString().contains("instrumented-refresh"))
            assertTrue(prefs.edit().putString("active_iv", "broken-iv").commit())
            val original = prefs.all.toMap()
            assertThrows(CredentialStorageException::class.java) { SecureCredentialStore(context, namespace).loadActive() }
            assertEquals(original, prefs.all)
            SecureCredentialStore(context, namespace).clearActive()
            assertNull(SecureCredentialStore(context, namespace).loadActive())
        } finally {
            prefs.edit().clear().commit()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry("uk.thewyj.app.session.aes.v1$namespace")
        }
    }

    @Test fun cookieCallbackCompletesBeforeSessionIsUsed() = runBlocking {
        // A separate .invalid origin never replaces the signed-in Preview cookie.
        val origin = "https://task20-instrumentation.invalid"
        // WorkManager has no UI Looper; the bridge must dispatch the cookie operation.
        withContext(Dispatchers.Default) {
            WebSessionBridge(context, origin).installAccessCookie("instrumented-cookie", System.currentTimeMillis() + 60_000)
        }
        withContext(Dispatchers.Main) {
            assertTrue(CookieManager.getInstance().getCookie(origin).contains("__Host-wyj_app_access=instrumented-cookie"))
            CookieManager.getInstance().setCookie(origin, "__Host-wyj_app_access=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict")
            CookieManager.getInstance().flush()
        }
    }

    @Test fun backendErrorFieldAndCodeAreNotLost() {
        val failure = ThewyjApiClient().failureFrom(403,
            JSONObject().put("error", "用户名或登录密钥错误").put("code", "invalid_credentials"))
        assertEquals(403, failure.status)
        assertEquals("invalid_credentials", failure.code)
        assertTrue(failure.message.contains("用户名或登录密钥错误"))
        assertTrue(failure.message.contains("invalid_credentials"))
    }
}
