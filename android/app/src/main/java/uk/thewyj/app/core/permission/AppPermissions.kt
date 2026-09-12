package uk.thewyj.app.core.permission

/**
 * Every device capability the app actually uses, with the real Android
 * mechanism needed to grant it. The UI must never show a bare "未开启" state:
 * each item carries what is missing, why it is needed and where to fix it.
 */
enum class PermissionKind {
    /** Managed with the normal runtime permission dialog. */
    RUNTIME,

    /** Only the system settings screen can grant it (listener/accessibility). */
    SYSTEM_SETTINGS,

    /** Real settings screen, but the app works without it. */
    OPTIONAL_SETTINGS,
}

enum class AppPermissionId {
    POST_NOTIFICATIONS,
    NOTIFICATION_LISTENER,
    ACCESSIBILITY,
    /** Screenshot archive: full photo read (Android 14+ Selected Photos aware). */
    SCREENSHOT_MEDIA,
    RECEIVE_SMS,
    INSTALL_PACKAGES,
    BATTERY_OPTIMIZATION,
}

data class AppPermissionState(
    val id: AppPermissionId,
    val title: String,
    val purpose: String,
    val actionLabel: String,
    val kind: PermissionKind,
    val granted: Boolean,
    val statusText: String,
    /** True when Android 13+ "restricted settings" can block the toggle. */
    val restrictedSettingsRisk: Boolean = false,
    val restrictedHint: String = "",
)

object PermissionCopy {
    const val POST_NOTIFICATIONS_TITLE = "通知权限"
    const val POST_NOTIFICATIONS_PURPOSE = "允许 thewyj 主动发送「已识别交易 / 待核实」通知；拒绝后识别结果只在应用内显示。"
    const val LISTENER_TITLE = "通知访问"
    const val LISTENER_PURPOSE = "把系统通知栏里的通知保存到本机通知历史，并用于支付金额识别。thewyj 只在本地保存原文。"
    const val ACCESSIBILITY_TITLE = "无障碍（金额核实）"
    const val ACCESSIBILITY_PURPOSE = "仅在你点击「核实交易金额」后的 90 秒内读取对应应用的交易页面，用于补全金额；不执行自动点击。"
    const val SMS_TITLE = "短信（银行通知）"
    const val SMS_PURPOSE = "读取银行短信中的金额与收支方向，用于财务识别；不读取验证码以外的其他短信用途。"
    const val SCREENSHOT_MEDIA_TITLE = "截图归档（照片读取）"
    const val SCREENSHOT_MEDIA_PURPOSE =
        "三星手机每张新截图都会覆盖同一个系统通知，只有允许读取截图才能把每一张都保存到通知历史。" +
            "Android 14 及以上如果只选择「部分照片」，新截图不会被读取，应用会如实显示该状态并退回通知自带图片。"
    const val INSTALL_TITLE = "安装未知应用"
    const val INSTALL_PURPOSE = "允许 thewyj 调起系统安装器安装新版本 APK。安装过程始终由 Android 系统界面确认。"
    const val BATTERY_TITLE = "后台运行（可选）"
    const val BATTERY_PURPOSE = "关闭电池优化可让上传续传与会话刷新更稳定；不开启不影响日常使用。"
    const val RESTRICTED_HINT =
        "Android 13 及以上（含三星）会默认限制侧载应用的「受限设置」。如果系统设置里的开关是灰色的，请先进入「应用信息 → 右上角菜单 → 允许受限设置」，再回到本页开启。"
}

/**
 * Pure decision helpers, kept out of the Android probes so they can be unit
 * tested without a device.
 */
object PermissionDecisions {
    fun runtimeStatus(granted: Boolean): String = if (granted) "已开启" else "未开启"

    fun settingsStatus(granted: Boolean, serviceName: String): String =
        if (granted) "已开启" else "需要在系统设置中开启"

    fun optionalStatus(granted: Boolean): String = if (granted) "已开启" else "可选，未开启"

    /**
     * Android 13+ blocks accessibility for apps installed outside a store until
     * the user allows restricted settings. We can only detect the sideload
     * source, never the toggle itself, so the hint is shown for sideloaded
     * builds on API 33+.
     */
    fun restrictedSettingsRisk(apiLevel: Int, installerPackage: String?): Boolean {
        if (apiLevel < 33) return false
        val installer = installerPackage.orEmpty()
        if (installer.isEmpty()) return true
        return !installer.contains("vending") && !installer.contains("google")
    }
}
