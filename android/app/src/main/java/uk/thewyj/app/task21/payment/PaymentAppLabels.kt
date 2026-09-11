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
        val system = runCatching {
            val manager = context.packageManager
            manager.getApplicationLabel(manager.getApplicationInfo(packageName, 0)).toString()
        }.getOrNull()
        if (!system.isNullOrBlank() && system != packageName) return system
        return KNOWN[packageName] ?: packageName
    }

    /** Financial apps recognised without a PackageManager lookup (tests/SMS senders). */
    fun known(sourcePackage: String): String? = KNOWN[sourcePackage.trim()]
}
