package uk.thewyj.app.core.permission

import android.Manifest
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import androidx.core.content.ContextCompat
import uk.thewyj.app.task21.ThewyjNotificationListenerService
import uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService

/**
 * Real state of every permission the app needs, probed from the platform.
 * Nothing is cached: the permission center re-reads it whenever the screen
 * resumes and after every system settings round trip.
 */
object PermissionCenter {

    fun states(context: Context): List<AppPermissionState> {
        val risk = PermissionDecisions.restrictedSettingsRisk(Build.VERSION.SDK_INT, installerPackage(context))
        val listener = notificationListenerGranted(context)
        val accessibility = accessibilityGranted(context)
        val postNotifications = postNotificationsGranted(context)
        val sms = runtimeGranted(context, Manifest.permission.RECEIVE_SMS)
        val installPackages = canInstallPackages(context)
        val battery = batteryOptimizationIgnored(context)
        return listOf(
            AppPermissionState(
                id = AppPermissionId.NOTIFICATION_LISTENER,
                title = PermissionCopy.LISTENER_TITLE,
                purpose = PermissionCopy.LISTENER_PURPOSE,
                actionLabel = "打开系统设置",
                kind = PermissionKind.SYSTEM_SETTINGS,
                granted = listener,
                statusText = PermissionDecisions.settingsStatus(listener, "通知访问"),
                restrictedSettingsRisk = risk,
                restrictedHint = if (risk && !listener) PermissionCopy.RESTRICTED_HINT else "",
            ),
            AppPermissionState(
                id = AppPermissionId.ACCESSIBILITY,
                title = PermissionCopy.ACCESSIBILITY_TITLE,
                purpose = PermissionCopy.ACCESSIBILITY_PURPOSE,
                actionLabel = "打开系统设置",
                kind = PermissionKind.SYSTEM_SETTINGS,
                granted = accessibility,
                statusText = PermissionDecisions.settingsStatus(accessibility, "无障碍"),
                restrictedSettingsRisk = risk,
                restrictedHint = if (risk && !accessibility) PermissionCopy.RESTRICTED_HINT else "",
            ),
            AppPermissionState(
                id = AppPermissionId.POST_NOTIFICATIONS,
                title = PermissionCopy.POST_NOTIFICATIONS_TITLE,
                purpose = PermissionCopy.POST_NOTIFICATIONS_PURPOSE,
                actionLabel = "允许通知",
                kind = PermissionKind.RUNTIME,
                granted = postNotifications,
                statusText = PermissionDecisions.runtimeStatus(postNotifications),
            ),
            AppPermissionState(
                id = AppPermissionId.RECEIVE_SMS,
                title = PermissionCopy.SMS_TITLE,
                purpose = PermissionCopy.SMS_PURPOSE,
                actionLabel = "允许读取短信",
                kind = PermissionKind.RUNTIME,
                granted = sms,
                statusText = PermissionDecisions.runtimeStatus(sms),
            ),
            AppPermissionState(
                id = AppPermissionId.INSTALL_PACKAGES,
                title = PermissionCopy.INSTALL_TITLE,
                purpose = PermissionCopy.INSTALL_PURPOSE,
                actionLabel = "允许安装",
                kind = PermissionKind.SYSTEM_SETTINGS,
                granted = installPackages,
                statusText = PermissionDecisions.settingsStatus(installPackages, "安装未知应用"),
                restrictedSettingsRisk = risk,
                restrictedHint = if (risk && !installPackages) PermissionCopy.RESTRICTED_HINT else "",
            ),
            AppPermissionState(
                id = AppPermissionId.BATTERY_OPTIMIZATION,
                title = PermissionCopy.BATTERY_TITLE,
                purpose = PermissionCopy.BATTERY_PURPOSE,
                actionLabel = "打开电池设置",
                kind = PermissionKind.OPTIONAL_SETTINGS,
                granted = battery,
                statusText = PermissionDecisions.optionalStatus(battery),
            ),
        )
    }

    /** Runtime permissions requested through the normal Android dialog. */
    fun runtimePermissionsFor(id: AppPermissionId): Array<String> = when (id) {
        AppPermissionId.POST_NOTIFICATIONS ->
            if (Build.VERSION.SDK_INT >= 33) arrayOf("android.permission.POST_NOTIFICATIONS") else emptyArray()
        AppPermissionId.RECEIVE_SMS -> arrayOf(Manifest.permission.RECEIVE_SMS)
        else -> emptyArray()
    }

    fun settingsIntent(context: Context, id: AppPermissionId): Intent? = when (id) {
        AppPermissionId.NOTIFICATION_LISTENER ->
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        AppPermissionId.ACCESSIBILITY ->
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        AppPermissionId.INSTALL_PACKAGES ->
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        AppPermissionId.BATTERY_OPTIMIZATION ->
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        AppPermissionId.POST_NOTIFICATIONS -> notificationSettingsIntent(context)
        AppPermissionId.RECEIVE_SMS -> appDetailsIntent(context)
    }?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** App info is where Android 13+ exposes "允许受限设置". */
    fun appDetailsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun notificationSettingsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun notificationListenerGranted(context: Context): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners",
        ) ?: return false
        val component = ComponentName(context, ThewyjNotificationListenerService::class.java)
        return enabled.split(":").any { ComponentName.unflattenFromString(it) == component }
    }

    fun accessibilityGranted(context: Context): Boolean {
        val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager ?: return false
        val expected = ComponentName(context, ThewyjPaymentAccessibilityService::class.java)
        val services = runCatching {
            manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
        }.getOrDefault(emptyList())
        return services.any { info ->
            info.resolveInfo?.serviceInfo?.let { serviceInfo ->
                ComponentName(serviceInfo.packageName, serviceInfo.name) == expected
            } ?: false
        }
    }

    fun postNotificationsGranted(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 33) {
            runtimeGranted(context, "android.permission.POST_NOTIFICATIONS")
        } else {
            true
        }

    fun runtimeGranted(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun canInstallPackages(context: Context): Boolean =
        context.packageManager.canRequestPackageInstalls()

    fun batteryOptimizationIgnored(context: Context): Boolean {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return true
        return power.isIgnoringBatteryOptimizations(context.packageName)
    }

    private fun installerPackage(context: Context): String? = runCatching {
        if (Build.VERSION.SDK_INT >= 30) {
            context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getInstallerPackageName(context.packageName)
        }
    }.getOrNull()
}
