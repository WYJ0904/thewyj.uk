package uk.thewyj.app.task22

import org.json.JSONArray
import org.json.JSONObject

enum class TransferItemStatus {
    PENDING, UPLOADING, PAUSED, ERROR, DONE, CANCELLED
}

data class TransferFileSource(
    val uri: String,
    val displayName: String,
    val relativePath: String,
    val sizeBytes: Long,
    val mimeType: String,
)

data class QueuedTransfer(
    val localId: String,
    val source: TransferFileSource,
    val sessionId: String = "",
    val fileId: String = "",
    val partSize: Long = 0,
    val partCount: Int = 0,
    val uploadedParts: Set<Int> = emptySet(),
    val uploadedBytes: Long = 0,
    val status: TransferItemStatus = TransferItemStatus.PENDING,
    val errorMessage: String = "",
) {
    fun toJson(): JSONObject = JSONObject()
        .put("local_id", localId)
        .put("uri", source.uri)
        .put("display_name", source.displayName)
        .put("relative_path", source.relativePath)
        .put("size_bytes", source.sizeBytes)
        .put("mime_type", source.mimeType)
        .put("session_id", sessionId)
        .put("file_id", fileId)
        .put("part_size", partSize)
        .put("part_count", partCount)
        .put("uploaded_parts", JSONArray(uploadedParts.sorted()))
        .put("uploaded_bytes", uploadedBytes)
        .put("status", status.name)
        .put("error_message", errorMessage)

    companion object {
        fun fromJson(json: JSONObject): QueuedTransfer {
            val partsJson = json.optJSONArray("uploaded_parts") ?: JSONArray()
            return QueuedTransfer(
                localId = json.getString("local_id"),
                source = TransferFileSource(
                    uri = json.getString("uri"),
                    displayName = json.optString("display_name", "unnamed"),
                    relativePath = json.optString("relative_path", "unnamed"),
                    sizeBytes = json.optLong("size_bytes"),
                    mimeType = json.optString("mime_type", "application/octet-stream"),
                ),
                sessionId = json.optString("session_id"),
                fileId = json.optString("file_id"),
                partSize = json.optLong("part_size"),
                partCount = json.optInt("part_count"),
                uploadedParts = buildSet {
                    for (index in 0 until partsJson.length()) partsJson.optInt(index).let(::add)
                },
                uploadedBytes = json.optLong("uploaded_bytes"),
                status = runCatching { TransferItemStatus.valueOf(json.optString("status", "PENDING")) }
                    .getOrDefault(TransferItemStatus.PENDING),
                errorMessage = json.optString("error_message"),
            )
        }
    }
}

data class TransferSession(
    val id: String,
    val expiresAt: String = "",
)

data class TransferAllocation(
    val fileId: String,
    val partSize: Long,
    val partCount: Int,
)

data class TransferShare(
    val id: String,
    val expiresAt: String,
    val totalBytes: Long,
    val fileCount: Int,
    val maxDownloads: Int,
    val downloadCount: Int,
    val passwordRequired: Boolean,
    val revoked: Boolean,
) {
    companion object {
        fun fromJson(json: JSONObject): TransferShare = TransferShare(
            id = json.getString("id"),
            expiresAt = json.optString("expires_at"),
            totalBytes = json.optLong("total_bytes"),
            fileCount = json.optInt("file_count"),
            maxDownloads = json.optInt("max_downloads"),
            downloadCount = json.optInt("download_count"),
            passwordRequired = json.optBoolean("password_required"),
            revoked = json.optBoolean("revoked"),
        )
    }
}
