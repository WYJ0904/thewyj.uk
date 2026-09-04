package uk.thewyj.app.task21

/**
 * Extension points only. Task 20 requests no notification, SMS or accessibility permissions
 * and starts no capture services. Task 21 may implement these contracts after separate review.
 */
interface LocalNotificationCaptureStore {
    suspend fun clearForAccount(accountId: String)
}

interface FinanceCandidateQueue {
    suspend fun clearForAccount(accountId: String)
}

enum class CaptureCapability {
    NOTIFICATION_ACCESS,
    SMS_PERMISSION,
    ACCESSIBILITY_SERVICE,
}

enum class CapabilityState {
    NOT_IMPLEMENTED,
    NOT_GRANTED,
    GRANTED,
}

interface AndroidCapturePermissionGateway {
    fun state(capability: CaptureCapability): CapabilityState
    fun openSystemSettings(capability: CaptureCapability)
}
