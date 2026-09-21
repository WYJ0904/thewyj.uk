package uk.thewyj.app.task21.payment

import android.content.Context
import android.content.Intent

/**
 * Launches the source application for a payment-verification ticket.
 *
 * Android 11+ package visibility can make PackageManager#getLaunchIntentForPackage
 * return null even while the app is installed. The manifest declares launcher
 * visibility, and this helper still keeps a package-scoped MAIN/LAUNCHER fallback
 * so a visible button never silently becomes a no-op.
 */
object SourceAppLauncher {
    fun launch(context: Context, sourcePackage: String): Boolean {
        val packageName = sourcePackage.trim()
        if (packageName.isBlank()) return false

        val manager = context.packageManager
        val primary = runCatching {
            manager.getLaunchIntentForPackage(packageName)
                ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }.getOrNull()
        if (primary != null && runCatching { context.startActivity(primary) }.isSuccess) {
            return true
        }

        val fallback = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setPackage(packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching {
            context.startActivity(fallback)
            true
        }.getOrDefault(false)
    }
}
