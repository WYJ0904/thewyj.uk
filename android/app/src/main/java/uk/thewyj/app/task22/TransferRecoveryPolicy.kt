package uk.thewyj.app.task22

/** Server errors that require a new immutable upload manifest. */
object TransferRecoveryPolicy {
    private val staleUploadCodes = setOf(
        "transfer_session_not_found",
        "transfer_session_not_active",
        "transfer_session_expired",
        "transfer_file_not_found",
        "transfer_upload_not_initialized",
    )

    fun shouldResetUpload(code: String): Boolean = code in staleUploadCodes

    fun shouldResetCompletion(code: String): Boolean = code == "transfer_incomplete_upload"

    fun shouldRefreshSession(status: Int): Boolean = status == 401
}
