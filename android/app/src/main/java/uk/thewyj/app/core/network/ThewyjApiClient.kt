package uk.thewyj.app.core.network

import android.os.Build
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
)

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
            )
        }
    }

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

    private fun failureFrom(status: Int, payload: JSONObject): ApiCall.Failure {
        val code = payload.optString("code", "http_$status")
        val message = payload.optString("message", "请求未完成")
        val explicitlyRetryable = payload.optBoolean("retryable", false)
        val kind = when {
            explicitlyRetryable || status == 408 || status == 429 || status >= 500 -> ApiFailureKind.RETRYABLE
            code in TERMINAL_AUTH_CODES || status == 401 -> ApiFailureKind.AUTHENTICATION
            else -> ApiFailureKind.VALIDATION
        }
        return ApiCall.Failure(code, message, kind, status)
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
