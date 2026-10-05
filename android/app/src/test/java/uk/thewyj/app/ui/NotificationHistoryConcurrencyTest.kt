package uk.thewyj.app.ui

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.store.NotificationHistoryItem

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationHistoryConcurrencyTest {
    private fun row(id: String) = NotificationHistoryItem(
        instanceId = id, revisionId = id, sourcePackage = "com.example.fixture", postTime = 1,
        status = "active", removedAt = 0, revisionCount = 1, financeLinked = false,
        title = id, text = "", bigText = "", subText = "", infoText = "", summaryText = "",
        textLines = emptyList(), parseStatus = "", direction = "", amountMinor = 0,
        currency = "CNY", merchant = "", capturedAt = 1,
    )

    @Test fun slowSupersededQueryCannotReplaceTheNewResult() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val state = NotificationHubState(RuntimeEnvironment.getApplication(), "race-fixture") { query ->
            if (query.search == "old") withContext(NonCancellable) {
                started.complete(Unit); release.await(); listOf(row("old"))
            } else listOf(row("new"))
        }
        state.setSearchText("old")
        val old = async { state.refresh() }
        started.await()
        state.setSearchText("new")
        state.refresh()
        release.complete(Unit); old.await()
        assertEquals(listOf("new"), state.items.map { it.revisionId })
        assertEquals("", state.error)
        assertFalse(state.loading)
    }

    @Test fun stalePaginationCannotAppendToAnotherSearch() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val state = NotificationHubState(RuntimeEnvironment.getApplication(), "pagination-fixture") { query ->
            when {
                query.search == "new" -> listOf(row("new"))
                query.offset > 0 -> { started.complete(Unit); release.await(); (50..100).map { row("r$it") } }
                else -> (0..50).map { row("r$it") }
            }
        }
        state.refresh()
        val more = async { state.loadMore() }
        started.await(); state.setSearchText("new"); state.refresh()
        release.complete(Unit); more.await()
        assertEquals(listOf("new"), state.items.map { it.revisionId })
        assertFalse(state.hasMore); assertFalse(state.loadingMore)
    }

    @Test fun unchangedRowsKeepIdentityAndOnlyTheChangedRowIsReplaced() = runBlocking {
        var version = 0
        val state = NotificationHubState(RuntimeEnvironment.getApplication(), "identity-fixture") {
            listOf(row("a"), row("b").copy(pinned = version > 0))
        }
        state.refresh()
        val first = state.items[0]; val second = state.items[1]
        version++; state.refresh()
        assertSame(first, state.items[0]); assertNotSame(second, state.items[1])
        assertTrue(state.items[1].pinned)
    }

    @Test fun largeFixturePaginationSelectionDetailPinAndDeletePreserveUnaffectedRows() = runBlocking {
        val fixture = (0 until 125).map { row("p4-safe-$it").copy(text = "P4 isolated notification $it") }.toMutableList()
        val state = NotificationHubState(
            RuntimeEnvironment.getApplication(), "p4-large-isolated-fixture",
            deleteWriter = { ids -> val before = fixture.size; fixture.removeAll { it.revisionId in ids }; before - fixture.size },
            pinWriter = { id, pinned ->
                val index = fixture.indexOfFirst { it.instanceId == id }
                if (index < 0) false else { fixture[index] = fixture[index].copy(pinned = pinned); true }
            },
            historyReader = { query -> fixture.filter { query.search.isBlank() || it.text.contains(query.search) }
                .drop(query.offset).take(query.limit) },
        )
        state.refresh()
        assertEquals(50, state.items.size)
        val first = state.items.first()
        state.loadMore(); state.loadMore()
        assertEquals(125, state.items.size)
        assertFalse(state.hasMore)
        assertSame(first, state.items.first())
        state.toggleSelection(first.revisionId)
        assertEquals(listOf(first.revisionId), state.selected.toList())
        state.detail = first
        state.closeDetail()
        assertNull(state.detail)
        assertSame(first, state.items.first())
        val unaffected = state.items[1]
        assertTrue(state.togglePinned(first))
        assertTrue(state.items.first().pinned)
        assertSame(unaffected, state.items[1])
        assertEquals(1, state.deleteOne(first.revisionId))
        assertEquals(124, state.items.size)
        assertFalse(state.items.any { it.revisionId == first.revisionId })
        assertTrue(state.selected.isEmpty())
        state.refresh()
        assertFalse(state.items.any { it.revisionId == first.revisionId })
    }
}
