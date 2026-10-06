package uk.thewyj.app.core.features

import org.json.JSONObject
import java.time.Instant

enum class ReleaseChannel(val wireValue: String, val label: String) {
    STABLE("stable", "Stable"), BETA("beta", "Beta"), EXPERIMENTAL("experimental", "Experimental");
    companion object {
        fun fromWire(value: String): ReleaseChannel? = entries.firstOrNull { it.wireValue == value }
    }
}

data class FeatureDecision(val enabled: Boolean, val reason: String, val revision: Int)

/** Server decisions only. Android never derives a bucket or accepts a local ON override. */
data class FeatureSnapshot(
    val accountId: String,
    val channel: ReleaseChannel,
    val channelRevision: Int,
    val expiresAtMs: Long,
    val flags: Map<String, FeatureDecision>,
) {
    fun enabled(key: String, currentAccountId: String, nowMs: Long = System.currentTimeMillis()): Boolean =
        currentAccountId == accountId && nowMs < expiresAtMs && flags[key]?.enabled == true

    companion object {
        private fun integer(json: JSONObject, key: String): Int? = (json.opt(key) as? Number)?.let {
            val value = it.toDouble()
            if (!value.isFinite() || value < 0 || value > Int.MAX_VALUE || value != value.toInt().toDouble()) null else value.toInt()
        }

        fun fromJson(json: JSONObject, accountId: String, nowMs: Long = System.currentTimeMillis()): FeatureSnapshot? = runCatching {
            require(accountId.isNotBlank() && json.opt("account_id") == accountId && integer(json, "schema_version") == 1)
            val channel = requireNotNull(ReleaseChannel.fromWire(json.optString("channel")))
            val revision = requireNotNull(integer(json, "channel_revision"))
            val maxAge = (json.opt("max_age_seconds") as? Number)?.toDouble() ?: error("Missing expiry")
            require(maxAge.isFinite() && maxAge > 0 && maxAge <= 30)
            val expires = minOf(Instant.parse(json.getString("expires_at")).toEpochMilli(), nowMs + (maxAge * 1000).toLong())
            require(expires > nowMs)
            val rows = json.getJSONObject("flags")
            require(rows.length() <= 200)
            val flags = rows.keys().asSequence().associateWith { key ->
                require(key.matches(Regex("[a-z][a-z0-9._-]{1,63}")))
                val row = rows.getJSONObject(key)
                val enabled = requireNotNull(row.opt("enabled") as? Boolean)
                val reason = requireNotNull(row.opt("reason") as? String)
                val flagRevision = requireNotNull(integer(row, "revision"))
                require(flagRevision >= 1)
                FeatureDecision(enabled, reason, flagRevision)
            }
            FeatureSnapshot(accountId, channel, revision, expires, flags)
        }.getOrNull()
    }
}
