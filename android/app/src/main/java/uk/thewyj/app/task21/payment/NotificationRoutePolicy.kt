package uk.thewyj.app.task21.payment

/**
 * Single routing decision for payment notifications.
 *
 * `MainActivity.onCreate` (cold start / process killed) and `onNewIntent`
 * (warm start with `launchMode=singleTask`) both funnel through this policy, so
 * a tap behaves identically in all three process states and is unit-testable
 * without an Activity.
 */
object NotificationRoutePolicy {
    sealed class Target {
        data class Payment(val recognitionId: String, val verify: Boolean) : Target()
        data class Route(val path: String) : Target()
        object None : Target()
    }

    fun resolve(
        verifyRecognitionId: String?,
        notificationRecognitionId: String?,
        uriScheme: String?,
        uriHost: String?,
        uriPath: String?,
        routeParam: String?,
        uriQuery: String? = null,
        uriFragment: String? = null,
        uriUserInfo: String? = null,
        uriPort: Int = -1,
    ): Target {
        val verify = verifyRecognitionId.orEmpty().trim()
        val notification = notificationRecognitionId.orEmpty().trim()
        if (verify.isNotBlank() || notification.isNotBlank()) {
            return Target.Payment(verify.ifBlank { notification }, verify = verify.isNotBlank())
        }
        val path = when (uriScheme?.lowercase()) {
            "https" -> if (uriHost?.equals("thewyj.uk", ignoreCase = true) == true &&
                uriUserInfo.isNullOrEmpty() && uriPort in setOf(-1, 443)
            ) {
                uriPath.orEmpty().ifBlank { "/" } +
                    uriQuery?.let { "?$it" }.orEmpty() +
                    uriFragment?.let { "#$it" }.orEmpty()
            } else ""
            "thewyj" -> routeParam.orEmpty()
            else -> ""
        }
        return if (path.isBlank()) Target.None else Target.Route(path)
    }
}
