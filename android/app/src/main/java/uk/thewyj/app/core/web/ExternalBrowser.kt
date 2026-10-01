package uk.thewyj.app.core.web

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

/** Choose a general web browser, never this app's host-specific deep-link route. */
object ExternalBrowser {
    fun open(context: Context, url: String) {
        val uri = Uri.parse(url)
        if (uri.scheme !in setOf("http", "https")) return
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
        val manager = context.packageManager
        val candidates = manager.queryIntentActivities(probe, 0)
            .map { it.activityInfo.packageName }.distinct().filter { it != context.packageName }
        val default = manager.resolveActivity(probe, 0)?.activityInfo?.packageName
        val chosen = default?.takeIf { it in candidates }
        val intents = candidates.map { name ->
            Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
                .setPackage(name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val target = when {
            chosen != null -> intents.first { it.`package` == chosen }
            intents.size == 1 -> intents.single()
            intents.isNotEmpty() -> Intent.createChooser(intents.first(), "选择浏览器")
                .putExtra(Intent.EXTRA_INITIAL_INTENTS, intents.drop(1).toTypedArray())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            else -> null
        }
        if (target == null || runCatching { context.startActivity(target) }.isFailure) {
            Toast.makeText(context, "没有可用浏览器，请安装或启用浏览器", Toast.LENGTH_LONG).show()
        }
    }
}
