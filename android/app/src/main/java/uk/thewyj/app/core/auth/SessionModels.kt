package uk.thewyj.app.core.auth

import org.json.JSONArray
import org.json.JSONObject

data class AccountSnapshot(
    val id: String,
    val username: String,
    val role: String,
    val membershipLabel: String,
    val entitlements: Set<String>,
) {
    val isAdmin: Boolean get() = role == "admin" || role == "super_admin"

    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("username", username)
        .put("role", role)
        .put("membership_label", membershipLabel)
        .put("entitlements", JSONArray(entitlements.sorted()))

    companion object {
        fun fromJson(json: JSONObject): AccountSnapshot {
            val entitlementsJson = json.optJSONArray("entitlements") ?: JSONArray()
            val entitlements = buildSet {
                for (index in 0 until entitlementsJson.length()) {
                    entitlementsJson.optString(index).takeIf(String::isNotBlank)?.let(::add)
                }
            }
            val summary = json.optJSONObject("membership_summary")
            return AccountSnapshot(
                id = json.getString("id"),
                username = json.getString("username"),
                role = json.optString("role", "user"),
                membershipLabel = summary?.optString("label")
                    ?.takeIf(String::isNotBlank)
                    ?: json.optString("membership_label").takeIf(String::isNotBlank)
                    ?: json.optString("membership", "free"),
                entitlements = entitlements,
            )
        }
    }
}

data class DeviceCredentials(
    val accessToken: String,
    val accessExpiresAtEpochMs: Long,
    val refreshToken: String,
    val refreshExpiresAtEpochMs: Long,
    val deviceSessionId: String,
    val account: AccountSnapshot,
    val pendingRotationKey: String = "",
) {
    fun toJson(): JSONObject = JSONObject()
        .put("schema", 1)
        .put("access_token", accessToken)
        .put("access_expires_at", accessExpiresAtEpochMs)
        .put("refresh_token", refreshToken)
        .put("refresh_expires_at", refreshExpiresAtEpochMs)
        .put("device_session_id", deviceSessionId)
        .put("account", account.toJson())
        .put("pending_rotation_key", pendingRotationKey)

    companion object {
        fun fromJson(json: JSONObject): DeviceCredentials {
            require(json.optInt("schema") == 1) { "Unsupported credential schema" }
            return DeviceCredentials(
                accessToken = json.getString("access_token"),
                accessExpiresAtEpochMs = json.getLong("access_expires_at"),
                refreshToken = json.getString("refresh_token"),
                refreshExpiresAtEpochMs = json.getLong("refresh_expires_at"),
                deviceSessionId = json.getString("device_session_id"),
                account = AccountSnapshot.fromJson(json.getJSONObject("account")),
                pendingRotationKey = json.optString("pending_rotation_key"),
            )
        }
    }
}

data class PendingLogout(
    val refreshToken: String,
    val deviceId: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("refresh_token", refreshToken)
        .put("device_id", deviceId)

    companion object {
        fun fromJson(json: JSONObject): PendingLogout = PendingLogout(
            refreshToken = json.getString("refresh_token"),
            deviceId = json.getString("device_id"),
        )
    }
}
