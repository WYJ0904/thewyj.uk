package uk.thewyj.app.core.network

import android.os.Build
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.core.auth.AccountSnapshot
import uk.thewyj.app.core.auth.DeviceCredentials
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.time.Instant

enum class ApiFailureKind { RETRYABLE, AUTHENTICATION, VALIDATION }

sealed interface ApiCall<out T> {
    data class Success<T>(val value: T) : ApiCall<T>
    data class Failure(
        val code: String,
        val message: String,
        val kind: ApiFailureKind,
        val status: Int = 0,
    ) : ApiCall<Nothing>
}

data class AppConfig(
    val latestVersionCode: Int,
    val latestVersionName: String,
    val minimumVersionCode: Int,
    val downloadUrl: String,
    val releaseNotes: String = "",
    val releaseDate: String = "",
    val apkFileName: String = "",
    val apkSha256: String = "",
    val apkSizeBytes: Long = 0,
)

data class PendingReviewIdentity(
    val kind: String,
    val id: String,
    val eventId: String,
    val deviceId: String,
    val state: String = "pending",
    val transactionId: String = "",
    val eventIds: Set<String> = setOf(eventId),
    val sourcePackage: String = "",
    val appLabel: String = "",
    val amountMinor: Long? = null,
    val direction: String = "",
    val merchant: String = "",
    val occurredAtMs: Long = 0L,
    val confidence: Int = 0,
) {
    val canonicalId: String get() = "$kind:$id"

    companion object {
        fun fromJson(row: JSONObject): PendingReviewIdentity? {
            val id = row.optString("id").trim()
            val eventId = row.optString("event_id").trim()
            if (id.isBlank() || eventId.isBlank()) return null
            val aliases = buildSet {
                add(eventId)
                val ids = row.optJSONArray("event_ids")
                if (ids != null) for (index in 0 until ids.length()) add(ids.optString(index))
            }.filter(String::isNotBlank).toSet()
            return PendingReviewIdentity(
                kind = row.optString("kind"), id = id, eventId = eventId,
                deviceId = row.optString("device_id"),
                state = row.optString("state", "pending"),
                transactionId = row.optString("transaction_id"), eventIds = aliases,
                sourcePackage = row.optString("source_package"),
                appLabel = row.optString("app_label"),
                amountMinor = row.optLong("amount_minor").takeIf { !row.isNull("amount_minor") && it > 0L },
                direction = row.optString("direction").takeUnless { row.isNull("direction") }.orEmpty(),
                merchant = row.optString("merchant"),
                occurredAtMs = row.optLong("occurred_at_ms").coerceAtLeast(0L),
                confidence = row.optInt("confidence").coerceIn(0, 1000),
            )
        }
    }
}

data class PendingReviewSummary(
    val observedAt: String,
    val totalCount: Int,
    val hintCount: Int,
    val candidateCount: Int,
    val truncated: Boolean,
    val records: List<PendingReviewIdentity>,
)

internal object PendingReviewCompatibility {
    fun fromLegacy(
        hintPending: JSONObject,
        hintAll: JSONObject?,
        candidatePending: JSONObject,
        candidateConfirmed: JSONObject?,
        candidateRejected: JSONObject?,
        requested: Set<String>,
    ): ApiCall<PendingReviewSummary> = runCatching {
        fun hintRecords(payload: JSONObject, forceState: String? = null): List<PendingReviewIdentity> {
            val rows = payload.optJSONArray("hints") ?: return emptyList()
            return buildList {
                for (index in 0 until rows.length()) {
                    val row = rows.optJSONObject(index) ?: continue
                    val eventId = row.optString("source_event_id").trim()
                    if (eventId.isBlank()) continue
                    add(
                        PendingReviewIdentity(
                            kind = "hint",
                            id = row.optString("id"),
                            eventId = eventId,
                            deviceId = row.optString("device_id"),
                            state = forceState ?: row.optString("state", "pending"),
                            transactionId = row.optString("finance_entry_id"),
                            eventIds = setOf(eventId),
                        ),
                    )
                }
            }
        }

        fun candidateRecords(payload: JSONObject, state: String): List<PendingReviewIdentity> {
            val rows = payload.optJSONArray("candidates") ?: return emptyList()
            return buildList {
                for (index in 0 until rows.length()) {
                    val row = rows.optJSONObject(index) ?: continue
                    val eventIds = buildSet {
                        add(row.optString("event_id"))
                        val evidence = row.optJSONArray("evidence")
                        if (evidence != null) {
                            for (evidenceIndex in 0 until evidence.length()) {
                                add(evidence.optJSONObject(evidenceIndex)?.optString("event_id").orEmpty())
                            }
                        }
                    }.filter(String::isNotBlank).toSet()
                    val eventId = row.optString("event_id").ifBlank { eventIds.firstOrNull().orEmpty() }
                    if (eventId.isBlank()) continue
                    add(
                        PendingReviewIdentity(
                            kind = "candidate",
                            id = row.optString("id"),
                            eventId = eventId,
                            deviceId = "",
                            state = state,
                            transactionId = row.optString("finance_transaction_id"),
                            eventIds = eventIds.ifEmpty { setOf(eventId) },
                        ),
                    )
                }
            }
        }

        val pendingHints = hintRecords(hintPending, "pending")
        val pendingCandidates = candidateRecords(candidatePending, "pending")
        val terminal = buildList {
            hintAll?.let { payload ->
                addAll(hintRecords(payload).filter { it.state != "pending" && it.eventIds.any(requested::contains) })
            }
            candidateConfirmed?.let { payload ->
                addAll(candidateRecords(payload, "confirmed").filter { it.eventIds.any(requested::contains) })
            }
            candidateRejected?.let { payload ->
                addAll(candidateRecords(payload, "rejected").filter { it.eventIds.any(requested::contains) })
            }
        }

        val records = (pendingHints + pendingCandidates + terminal)
            .distinctBy { "${it.kind}:${it.id}:${it.state}" }
        val truncated = listOf(
            hintPending.optJSONArray("hints")?.length() ?: 0,
            hintAll?.optJSONArray("hints")?.length() ?: 0,
            candidatePending.optJSONArray("candidates")?.length() ?: 0,
            candidateConfirmed?.optJSONArray("candidates")?.length() ?: 0,
            candidateRejected?.optJSONArray("candidates")?.length() ?: 0,
        ).any { it >= 200 }

        PendingReviewSummary(
            observedAt = Instant.now().toString(),
            totalCount = pendingHints.size + pendingCandidates.size,
            hintCount = pendingHints.size,
            candidateCount = pendingCandidates.size,
            truncated = truncated,
            records = records,
        )
    }.fold(
        onSuccess = { ApiCall.Success(it) },
        onFailure = {
            ApiCall.Failure(
                code = "invalid_server_response",
                message = "服务响应格式不完整，请稍后重试",
                kind = ApiFailureKind.RETRYABLE,
            )
        },
    )
}

interface AccountApi {
    suspend fun register(username: String, secret: String): ApiCall<Unit>
    suspend fun login(username: String, secret: String, deviceId: String): ApiCall<DeviceCredentials>
    suspend fun refresh(
        credentials: DeviceCredentials,
        deviceId: String,
        rotationKey: String,
    ): ApiCall<DeviceCredentials>
    suspend fun currentAccount(accessToken: String): ApiCall<AccountSnapshot>
    suspend fun logout(refreshToken: String, accessToken: String, deviceId: String): ApiCall<Unit>
    suspend fun appConfig(): ApiCall<AppConfig>

    /** Number of backend payment candidates waiting for review. */
    suspend fun pendingCandidateCount(accessToken: String): ApiCall<Int>

    /** Stable identities for hints + complete candidates in one observation. */
    suspend fun pendingReviewSummary(accessToken: String, eventIds: List<String> = emptyList()): ApiCall<PendingReviewSummary> =
        when (val count = pendingCandidateCount(accessToken)) {
            is ApiCall.Success -> ApiCall.Success(
                PendingReviewSummary("", count.value, 0, count.value, false, emptyList()),
            )
            is ApiCall.Failure -> count
        }
}

class ThewyjApiClient(
    rawBaseUrl: String = BuildConfig.THEWYJ_BASE_URL,
) : AccountApi {
    private val baseUrl = rawBaseUrl.trimEnd('/').also { value ->
        val uri = URI(value)
        require(
            uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null &&
                uri.rawQuery == null && uri.rawFragment == null && uri.path.orEmpty().isEmpty()
        ) { "thewyj base URL must be an HTTPS origin" }
    }
    private val origin = URI(baseUrl).let { "${it.scheme}://${it.host}${if (it.port > 0) ":${it.port}" else ""}" }

    override suspend fun register(username: String, secret: String): ApiCall<Unit> {
        return request(
            path = "/api/register",
            method = "POST",
            body = JSONObject()
                .put("username", username)
                .put("secret", secret)
                .put("confirm_secret", secret),
        ).map { Unit }
    }

    override suspend fun login(
        username: String,
        secret: String,
        deviceId: String,
    ): ApiCall<DeviceCredentials> {
        return request(
            path = "/api/app/login",
            method = "POST",
            body = JSONObject()
                .put("username", username)
                .put("secret", secret)
                .put("device_id", deviceId)
                .put("app_version", BuildConfig.VERSION_NAME),
        ).map(::parseCredentials)
    }

    override suspend fun refresh(
        credentials: DeviceCredentials,
        deviceId: String,
        rotationKey: String,
    ): ApiCall<DeviceCredentials> {
        return request(
            path = "/api/app/session/refresh",
            method = "POST",
            body = JSONObject()
                .put("refresh_token", credentials.refreshToken)
                .put("device_id", deviceId)
                .put("rotation_key", rotationKey)
                .put("app_version", BuildConfig.VERSION_NAME),
        ).map(::parseCredentials)
    }

    override suspend fun currentAccount(accessToken: String): ApiCall<AccountSnapshot> {
        return request(
            path = "/api/app/session",
            method = "GET",
            accessToken = accessToken,
        ).map { AccountSnapshot.fromJson(it.getJSONObject("account")) }
    }

    override suspend fun logout(refreshToken: String, accessToken: String, deviceId: String): ApiCall<Unit> {
        return request(
            path = "/api/app/session/logout",
            method = "POST",
            accessToken = accessToken,
            body = JSONObject()
                .put("refresh_token", refreshToken)
                .put("device_id", deviceId),
        ).map { Unit }
    }

    override suspend fun appConfig(): ApiCall<AppConfig> {
        return request(path = "/api/app/config", method = "GET").map { json ->
            val app = json.getJSONObject("app")
            AppConfig(
                latestVersionCode = app.optInt("latest_version_code", 1),
                latestVersionName = app.optString("latest_version_name", "1.0.0"),
                minimumVersionCode = app.optInt("minimum_version_code", 1),
                downloadUrl = app.optString("download_url").takeIf(::isSafeDownloadUrl).orEmpty(),
                releaseNotes = app.optString("release_notes").trim().take(400),
                releaseDate = app.optString("release_date").trim().take(20),
                apkFileName = app.optString("apk_file_name").trim().take(120),
                apkSha256 = app.optString("apk_sha256").trim().lowercase().take(64),
                apkSizeBytes = app.optLong("apk_size_bytes", 0).coerceAtLeast(0),
            )
        }
    }

    override suspend fun pendingCandidateCount(accessToken: String): ApiCall<Int> {
        return pendingReviewSummary(accessToken).map { it.totalCount }
    }

    override suspend fun pendingReviewSummary(accessToken: String, eventIds: List<String>): ApiCall<PendingReviewSummary> {
        val requested = eventIds.distinct().filter(String::isNotBlank).take(200)
        val query = requested.joinToString(",") { java.net.URLEncoder.encode(it, "UTF-8") }
        return when (val response = request(
            path = "/api/notification/pending-summary" + if (query.isEmpty()) "" else "?event_ids=$query",
            method = "GET",
            accessToken = accessToken,
        )) {
            is ApiCall.Success -> parsePendingReviewSummary(response.value)
            is ApiCall.Failure -> response
        }
    }

    private fun parsePendingReviewSummary(json: JSONObject): ApiCall<PendingReviewSummary> = runCatching {
        val rows = json.optJSONArray("records")
        val records = buildList {
            if (rows != null) {
                for (index in 0 until rows.length()) {
                    val row = rows.optJSONObject(index) ?: continue
                    PendingReviewIdentity.fromJson(row)?.let(::add)
                }
            }
        }
        PendingReviewSummary(
            observedAt = json.optString("observed_at"),
            totalCount = json.optInt("total_count", records.count { it.state == "pending" }),
            hintCount = json.optInt("hint_count"),
            candidateCount = json.optInt("candidate_count"),
            truncated = json.optBoolean("truncated", false),
            records = records,
        )
    }.fold(
        onSuccess = { ApiCall.Success(it) },
        onFailure = {
            ApiCall.Failure(
                code = "invalid_server_response",
                message = "服务响应格式不完整，请稍后重试",
                kind = ApiFailureKind.RETRYABLE,
            )
        },
    )

    private suspend fun request(
        path: String,
        method: String,
        body: JSONObject? = null,
        accessToken: String = "",
    ): ApiCall<JSONObject> = withContext(Dispatchers.IO) {
        val connection = (URL("$baseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            useCaches = false
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "thewyj-android/${BuildConfig.VERSION_NAME} Android/${Build.VERSION.SDK_INT}")
            if (accessToken.isNotBlank()) setRequestProperty("X-Session-Token", accessToken)
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Origin", origin)
            }
        }
        try {
            if (body != null) {
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val payload = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (BuildConfig.DEBUG) Log.i("ThewyjSession", "$method $path HTTP $status code=${payload.optString("code").take(80)}")
            if (status in 200..299) {
                ApiCall.Success(payload)
            } else {
                failureFrom(status, payload)
            }
        } catch (_: IOException) {
            ApiCall.Failure(
                code = "network_unavailable",
                message = "网络暂时不可用，登录状态已保留",
                kind = ApiFailureKind.RETRYABLE,
            )
        } catch (_: Exception) {
            ApiCall.Failure(
                code = "invalid_server_response",
                message = "服务响应暂时无法处理，请稍后重试",
                kind = ApiFailureKind.RETRYABLE,
            )
        } finally {
            connection.disconnect()
        }
    }

    internal fun failureFrom(status: Int, payload: JSONObject): ApiCall.Failure {
        val code = payload.optString("code", "http_$status")
        val message = payload.optString("error").takeIf(String::isNotBlank)
            ?: payload.optString("message").takeIf(String::isNotBlank)
            ?: "请求未完成"
        val explicitlyRetryable = payload.optBoolean("retryable", false)
        val kind = when {
            explicitlyRetryable || status == 408 || status == 429 || status >= 500 -> ApiFailureKind.RETRYABLE
            code in TERMINAL_AUTH_CODES || status == 401 -> ApiFailureKind.AUTHENTICATION
            else -> ApiFailureKind.VALIDATION
        }
        return ApiCall.Failure(code, "$message ($code)", kind, status)
    }

    private fun parseCredentials(json: JSONObject): DeviceCredentials {
        val session = json.getJSONObject("device_session")
        return DeviceCredentials(
            accessToken = json.getString("access_token"),
            accessExpiresAtEpochMs = Instant.parse(json.getString("access_expires_at")).toEpochMilli(),
            refreshToken = json.getString("refresh_token"),
            refreshExpiresAtEpochMs = Instant.parse(json.getString("refresh_expires_at")).toEpochMilli(),
            deviceSessionId = session.getString("id"),
            account = AccountSnapshot.fromJson(json.getJSONObject("account")),
        )
    }

    private fun isSafeDownloadUrl(value: String): Boolean = runCatching {
        val uri = URI(value)
        uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null
    }.getOrDefault(false)

    private inline fun <T, R> ApiCall<T>.map(transform: (T) -> R): ApiCall<R> = when (this) {
        is ApiCall.Success -> runCatching { ApiCall.Success(transform(value)) }
            .getOrElse {
                ApiCall.Failure(
                    code = "invalid_server_response",
                    message = "服务响应格式不完整，请稍后重试",
                    kind = ApiFailureKind.RETRYABLE,
                )
            }
        is ApiCall.Failure -> this
    }

    companion object {
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS = 15_000
        private val TERMINAL_AUTH_CODES = setOf(
            "account_banned",
            "account_deleted",
            "app_device_mismatch",
            "app_refresh_expired",
            "app_refresh_invalid",
            "app_refresh_reuse_detected",
            "app_session_revoked",
            "canonical_session_invalid",
            "session_generation_invalid",
            "session_revoked",
        )
    }
}
