package uk.thewyj.app.ui

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.store.NotificationHistoryItem

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationOptimisticActionsTest {
    private fun row(id: String) = NotificationHistoryItem(
        instanceId = "instance-$id", sourcePackage = "test.app", postTime = 1L,
        status = "active", removedAt = 0L, revisionCount = 1,
        financeLinked = false, revisionId = id, title = "fixture", text = id,
        bigText = "", subText = "", infoText = "", summaryText = "", textLines = emptyList(),
        parseStatus = "", direction = "", amountMinor = 0L, currency = "", merchant = "", capturedAt = 1L,
    )

    @Test fun deleteIsImmediateAndFailureRestoresPositionsSelectionAndIdentity() = runBlocking {
        val started = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val original = listOf(row("a"), row("b"), row("c"))
        val state = NotificationHubState(RuntimeEnvironment.getApplication(), "delete-rollback",
            deleteWriter = { started.complete(Unit); release.await(); error("fixture IO failure") },
            historyReader = { original })
        state.refresh(); state.toggleSelection("b")
        val job = async { state.deleteOne("b") }; started.await()
        assertEquals(listOf("a", "c"), state.items.map { it.revisionId })
        assertFalse(state.selected.contains("b")); assertSame(original[0], state.items[0])
        release.complete(Unit); assertEquals(0, job.await())
        assertEquals(listOf("a", "b", "c"), state.items.map { it.revisionId })
        assertTrue(state.selected.contains("b")); assertSame(original[1], state.items[1])
        assertTrue(state.actionMessage.contains("失败"))
    }

    @Test fun deletionRollbackDoesNotInsertRowsFromAnOldQuery() = runBlocking {
        val started = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        val state = NotificationHubState(RuntimeEnvironment.getApplication(), "query-rollback",
            deleteWriter = { started.complete(Unit); release.await(); error("fixture failure") },
            historyReader = { q -> listOf(row(if (q.search.isBlank()) "old" else "new")) })
        state.refresh(); val job = async { state.deleteOne("old") }; started.await()
        state.setSearchText("new query"); state.refresh(); release.complete(Unit); job.await()
        assertEquals(listOf("new"), state.items.map { it.revisionId })
        assertEquals("new query", state.search)
    }

    @Test fun pinIsLocalPreservesOtherRowsAndCannotBeOverwrittenByRefresh() = runBlocking {
        val started = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>(); var writes = 0
        val original = listOf(row("a"), row("b"))
        val state = NotificationHubState(RuntimeEnvironment.getApplication(), "pin-refresh",
            pinWriter = { _, _ -> writes++; started.complete(Unit); release.await(); true },
            historyReader = { original })
        state.refresh(); val job = async { state.togglePinned(state.items[0]) }; started.await()
        assertTrue(state.items[0].pinned); assertSame(original[1], state.items[1])
        state.togglePinned(state.items[0]); assertEquals(1, writes)
        state.refresh(); assertTrue(state.items[0].pinned); assertSame(original[1], state.items[1])
        release.complete(Unit); assertTrue(job.await()); assertTrue(state.items[0].pinned)
    }

    @Test fun pinFailureRestoresTheDetailAndListWithoutRequeryingEverything() = runBlocking {
        var reads = 0; val original = listOf(row("a"), row("b"))
        val state = NotificationHubState(RuntimeEnvironment.getApplication(), "pin-failure",
            pinWriter = { _, _ -> error("fixture write failed") },
            historyReader = { reads++; original })
        state.refresh(); state.openDetail(state.items[0]); val second = state.items[1]
        assertFalse(state.togglePinned(state.items[0])); assertFalse(state.items[0].pinned)
        assertFalse(state.detail!!.pinned); assertSame(second, state.items[1]); assertEquals(1, reads)
        assertFalse(state.actionPending(state.items[0])); assertTrue(state.actionMessage.contains("失败"))
    }
}
