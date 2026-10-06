package uk.thewyj.app.core.features

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.CancellationException
import uk.thewyj.app.core.network.ApiCall
import uk.thewyj.app.core.network.ApiFailureKind
import java.util.concurrent.atomic.AtomicLong

data class FeatureUiState(
    val accountId: String = "",
    val available: Boolean = false,
    val loading: Boolean = false,
    val snapshot: FeatureSnapshot? = null,
    val message: String = "",
) {
    fun enabled(key: String, nowMs: Long = System.currentTimeMillis()): Boolean = snapshot?.enabled(key, accountId, nowMs) == true
}

/** Memory only. Expiry, offline, pause and account change close enabled features. */
class FeatureRepository(
    private val fetch: suspend () -> ApiCall<FeatureSnapshot>,
    private val save: suspend (ReleaseChannel, Int) -> ApiCall<FeatureSnapshot>,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val generation = AtomicLong()
    private val mutableState = MutableStateFlow(FeatureUiState())
    val state = mutableState.asStateFlow()

    fun bind(accountId: String) {
        if (accountId == mutableState.value.accountId) return
        generation.incrementAndGet()
        mutableState.value = FeatureUiState(accountId = accountId)
    }

    fun invalidate() {
        generation.incrementAndGet()
        mutableState.value = mutableState.value.copy(snapshot = null, loading = false)
    }

    suspend fun refresh() = observe { fetch() }

    suspend fun select(channel: ReleaseChannel) {
        val snapshot = mutableState.value.snapshot ?: return
        if (snapshot.expiresAtMs <= now()) { invalidate(); return }
        observe { save(channel, snapshot.channelRevision) }
    }

    private suspend fun observe(call: suspend () -> ApiCall<FeatureSnapshot>) {
        val owner = mutableState.value.accountId
        if (owner.isBlank()) return
        val ticket = generation.incrementAndGet()
        mutableState.value = mutableState.value.copy(snapshot = null, loading = true, message = "")
        val response = try { call() } catch (error: CancellationException) { throw error }
        catch (_: Exception) { ApiCall.Failure("task25_unavailable", "读取失败，预览功能已关闭", ApiFailureKind.RETRYABLE) }
        if (ticket != generation.get() || owner != mutableState.value.accountId) return
        mutableState.value = when (response) {
            is ApiCall.Success -> if (response.value.accountId == owner && response.value.expiresAtMs > now()) {
                FeatureUiState(owner, available = true, snapshot = response.value)
            } else FeatureUiState(owner, message = "体验设置无效，预览功能已关闭")
            is ApiCall.Failure -> mutableState.value.copy(
                available = mutableState.value.available && response.code !in setOf("task25_disabled", "api_route_not_found"),
                loading = false, snapshot = null, message = response.message,
            )
        }
    }
}
