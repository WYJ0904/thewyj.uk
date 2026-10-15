package uk.thewyj.app.task21.payment

import android.content.Context
import android.content.Intent
import android.content.pm.LauncherApps
import android.os.Process
import android.os.UserHandle

/**
 * Launches the source application for a payment-verification ticket.
 *
 * Uses normal Launcher APIs and the OS-issued source UID. A denied clone target
 * never falls back to the main application or requests extra profile permissions.
 */
object SourceAppLauncher {
    fun launch(context: Context, ticket: PaymentTicket): Boolean {
        val packageName = ticket.sourcePackage.trim()
        val uid = ticket.sourceUid?.takeIf { it >= 0 } ?: return false
        if (packageName.isBlank()) return false
        val user = UserHandle.getUserHandleForUid(uid)
        if (user != Process.myUserHandle()) {
            return runCatching {
                val launcher = context.getSystemService(LauncherApps::class.java) ?: return false
                if (user !in launcher.profiles) return false
                val target = launcher.getActivityList(packageName, user).firstOrNull {
                    it.componentName.packageName == packageName && it.applicationInfo.uid == uid
                } ?: return false
                launcher.startMainActivity(target.componentName, user, null, null)
                true
            }.getOrDefault(false)
        }

        val manager = context.packageManager
        if (runCatching { manager.getApplicationInfo(packageName, 0).uid }.getOrNull() != uid) return false
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
