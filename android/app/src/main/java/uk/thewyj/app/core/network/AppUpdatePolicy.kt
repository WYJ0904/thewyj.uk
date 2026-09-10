package uk.thewyj.app.core.network

/**
 * Version comparison for the official update check.
 *
 * The server's release metadata is the single source of truth and versionCode is
 * the comparison key. A missing or unsafe download URL degrades to "no prompt"
 * so a metadata problem can never block normal app usage.
 */
object AppUpdatePolicy {
    enum class Decision { UP_TO_DATE, UPDATE_AVAILABLE, MANDATORY_UPDATE }

    fun decide(
        currentVersionCode: Int,
        latestVersionCode: Int,
        minimumVersionCode: Int,
        downloadUrl: String,
    ): Decision {
        if (downloadUrl.isBlank()) return Decision.UP_TO_DATE
        val latest = latestVersionCode.coerceAtLeast(1)
        val minimum = minimumVersionCode.coerceAtLeast(1)
        if (currentVersionCode >= latest) return Decision.UP_TO_DATE
        return if (currentVersionCode < minimum) Decision.MANDATORY_UPDATE else Decision.UPDATE_AVAILABLE
    }
}
