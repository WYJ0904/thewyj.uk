package uk.thewyj.app.core.features

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.thewyj.app.core.network.ApiCall
import uk.thewyj.app.core.network.ApiFailureKind

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class FeatureRepositoryTest {
    private fun snapshot(owner: String = "one", expires: Long = 30_000) = FeatureSnapshot(
        owner, ReleaseChannel.EXPERIMENTAL, 4, expires, mapOf("test_flag" to FeatureDecision(true, "user_override", 3)),
    )

    @Test fun offlinePauseExpiryAndAccountChangeCloseFlags() = runTest {
        var clock = 0L
        var response: ApiCall<FeatureSnapshot> = ApiCall.Success(snapshot())
        val repo = FeatureRepository({ response }, { _, _ -> response }, { clock })
        repo.bind("one"); repo.refresh()
        assertTrue(repo.state.value.enabled("test_flag", clock))
        clock = 30_000
        assertFalse(repo.state.value.enabled("test_flag", clock))
        clock = 0
        repo.invalidate(); assertFalse(repo.state.value.enabled("test_flag", clock))
        repo.refresh(); response = ApiCall.Failure("network_unavailable", "offline", ApiFailureKind.RETRYABLE)
        repo.refresh(); assertFalse(repo.state.value.enabled("test_flag", clock))
        assertFalse(repo.state.value.loading)
        repo.bind("two"); assertFalse(repo.state.value.available)
        response = ApiCall.Success(snapshot("one")); repo.refresh()
        assertFalse(repo.state.value.enabled("test_flag", clock))
    }

    @Test fun oldAccountAndOlderRequestsCannotRestoreEnabledState() = runTest {
        val first = CompletableDeferred<ApiCall<FeatureSnapshot>>()
        val second = CompletableDeferred<ApiCall<FeatureSnapshot>>()
        var request = 0
        val repo = FeatureRepository({ if (request++ == 0) first.await() else second.await() }, { _, _ -> ApiCall.Success(snapshot()) }, { 0 })
        repo.bind("one")
        val old = launch { repo.refresh() }; runCurrent()
        repo.bind("two")
        val current = launch { repo.refresh() }; runCurrent()
        second.complete(ApiCall.Success(snapshot("two"))); current.join()
        first.complete(ApiCall.Success(snapshot("one"))); old.join()
        assertEquals("two", repo.state.value.snapshot?.accountId)
        repo.bind(""); assertFalse(repo.state.value.enabled("test_flag", 0))
    }

    @Test fun saveUsesConfirmedRevisionAndClosesFeaturesDuringWrite() = runTest {
        val pending = CompletableDeferred<ApiCall<FeatureSnapshot>>()
        val repo = FeatureRepository({ ApiCall.Success(snapshot()) }, { channel, revision ->
            assertEquals(ReleaseChannel.STABLE, channel); assertEquals(4, revision); pending.await()
        }, { 0 })
        repo.bind("one"); repo.refresh()
        val writing = launch { repo.select(ReleaseChannel.STABLE) }; runCurrent()
        assertFalse(repo.state.value.enabled("test_flag", 0)); assertTrue(repo.state.value.loading)
        pending.complete(ApiCall.Failure("task25_revision_conflict", "refresh", ApiFailureKind.VALIDATION)); writing.join()
        assertFalse(repo.state.value.enabled("test_flag", 0)); assertFalse(repo.state.value.loading)
    }
}
