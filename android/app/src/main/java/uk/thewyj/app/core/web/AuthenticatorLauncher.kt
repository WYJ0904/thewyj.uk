package uk.thewyj.app.core.web

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import java.net.URI

/** The enrollment URI stays out of WebView history, analytics and HTTP requests. */
object AuthenticatorUri {
    fun isAllowed(raw: String): Boolean = runCatching {
        if (raw.length > 2048) return false
        val uri = URI(raw)
        if (uri.scheme != "otpauth" || uri.host != "totp" || uri.userInfo != null || uri.port != -1 || uri.rawFragment != null) return false
        if (!uri.path.orEmpty().startsWith("/Aeris:") || uri.path.orEmpty().length <= 7) return false
        val parts = uri.rawQuery.orEmpty().split('&').map { it.split('=', limit = 2) }
        if (parts.size != 5 || parts.any { it.size != 2 } || parts.map { it[0] }.toSet().size != 5) return false
        val values = parts.associate { it[0] to it[1] }
        values.keys == setOf("secret", "issuer", "algorithm", "digits", "period") &&
            values["issuer"] == "Aeris" && values["algorithm"] == "SHA1" && values["digits"] == "6" && values["period"] == "30" &&
            Regex("^[A-Z2-7]{32}$").matches(values["secret"].orEmpty())
    }.getOrDefault(false)
}

object AuthenticatorLauncher {
    fun open(context: Context, url: String): Boolean {
        if (!AuthenticatorUri.isAllowed(url)) return false
        val launched = runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.isSuccess
        if (!launched) Toast.makeText(context, "未找到可用验证器，请扫描二维码或复制密钥手动添加", Toast.LENGTH_LONG).show()
        return launched
    }
}
