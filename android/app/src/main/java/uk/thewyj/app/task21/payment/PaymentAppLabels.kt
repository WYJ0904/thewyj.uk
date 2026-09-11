package uk.thewyj.app.task21.payment

import android.content.Context

/**
 * User-facing name of the app a payment came from.
 *
 * Real-device report: notifications said 「请在 90 秒内打开「该应用」」 and the
 * pending list showed `com.tencent.mm`. A package name must never reach the
 * user, and the system lookup can legitimately fail (dual-app / Secure Folder
 * installs live outside the current user), so the payment apps thewj supports
 * have a stable display name as a last resort.
 */
object PaymentAppLabels {
    private val KNOWN = mapOf(
        "com.tencent.mm" to "微信",
        "com.tencent.mobileqq" to "QQ",
        "com.eg.android.AlipayGphone" to "支付宝",
        "com.unionpay" to "云闪付",
        "com.icbc" to "中国工商银行",
        "com.ccb.longjiLife" to "中国建设银行",
        "com.chinamworld.main" to "中国银行",
        "com.android.bankabc" to "中国农业银行",
        "cmb.pb" to "招商银行",
        "com.bankcomm.Bankcomm" to "交通银行",
        "com.cmbc.cc.mbank" to "民生银行",
        "com.yitong.mbank.psbc" to "邮储银行",
        "com.spdbccc.app" to "浦发银行",
        "com.pingan.paces.ccms" to "平安银行",
        "com.antfortune.wealth" to "蚂蚁财富",
        "com.tenpay.android" to "微信支付",
    )

    fun resolve(context: Context, sourcePackage: String): String {
        val packageName = sourcePackage.trim()
        if (packageName.isEmpty()) return "未知应用"
        // 1. Android application label (what the launcher shows).
        val system = systemLabel(context, packageName)
        if (!system.isNullOrBlank()) return system
        // 2. Curated label for the payment apps we support (dual-app / Secure
        //    Folder installs live outside the current user, so step 1 can fail).
        KNOWN[packageName]?.let { return it }
        // 3. Last resort. Callers must treat this as a technical fallback and
        //    never show it as the primary name for a known app.
        return packageName
    }

    private fun systemLabel(context: Context, packageName: String): String? = runCatching {
        val manager = context.packageManager
        val label = manager.getApplicationLabel(manager.getApplicationInfo(packageName, 0)).toString()
        label.takeIf { it.isNotBlank() && it != packageName }
    }.getOrNull()

    /** True when [label] came from Android or the curated table, not the package name. */
    fun isResolved(label: String, sourcePackage: String): Boolean =
        label.isNotBlank() && label != sourcePackage.trim()

    /** Financial apps recognised without a PackageManager lookup (tests/SMS senders). */
    fun known(sourcePackage: String): String? = KNOWN[sourcePackage.trim()]
}
