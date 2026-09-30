package uk.thewyj.app.task22

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class TransferOwnerReviewTest {
    private val size = 188140359L
    private val limit = 5L * 1024 * 1024 * 1024
    private fun share(id: String) = TransferShare(id, "2030-01-01", size, 1, 5, 0, false, false)
    private fun snapshot(ids: List<String>) = TransferOwnerSnapshot(
        TransferUsage(ids.size * size, 0, limit), ids.map(::share),
    )

    @Test fun initialAndPostRevokeSnapshotsUseLogicalShareBytes() = runBlocking {
        var ids = listOf("share-a", "share-b")
        val owner = TransferOwnerReview({ snapshot(ids) }, { id -> ids = ids - id })
        owner.refresh()
        assertEquals("已存储 358.8 MiB / 5.00 GiB", owner.state.value.snapshot!!.usage.label)
        owner.revoke("share-a")
        assertEquals("已存储 179.4 MiB / 5.00 GiB", owner.state.value.snapshot!!.usage.label)
        owner.revoke("share-b")
        assertEquals("已存储 0 MiB / 5.00 GiB", owner.state.value.snapshot!!.usage.label)
        assertTrue(owner.state.value.snapshot!!.shares.isEmpty())
    }

    @Test fun latePullCannotResurrectRevokedShareAndDoubleClickIsSingleFlight() = runBlocking {
        val oldPull = CompletableDeferred<TransferOwnerSnapshot>()
        val revokeAck = CompletableDeferred<Unit>()
        var loads = 0
        var revokes = 0
        val owner = TransferOwnerReview(
            { if (++loads == 1) oldPull.await() else snapshot(listOf("share-b")) },
            { revokes++; revokeAck.await() },
        )
        val pull = launch(start = CoroutineStart.UNDISPATCHED) { owner.refresh() }
        owner.refresh() // A second pull is bounded and does not queue another request.
        val revoke = launch(start = CoroutineStart.UNDISPATCHED) { owner.revoke("share-a") }
        owner.revoke("share-a")
        assertEquals(1, revokes)
        assertEquals(setOf("share-a"), owner.state.value.revoking)
        revokeAck.complete(Unit)
        oldPull.complete(snapshot(listOf("share-a", "share-b")))
        pull.join(); revoke.join()
        assertEquals(listOf("share-b"), owner.state.value.snapshot!!.shares.map { it.id })
        assertEquals(size, owner.state.value.snapshot!!.usage.storedBytes)
        assertEquals(2, loads)
    }

    @Test fun revokeErrorIsVisibleAndPreservesTheShare() = runBlocking {
        val owner = TransferOwnerReview({ snapshot(listOf("share-a")) }, { error("HTTP 503") })
        owner.refresh(); owner.revoke("share-a")
        assertEquals(listOf("share-a"), owner.state.value.snapshot!!.shares.map { it.id })
        assertTrue(owner.state.value.errors["share-a"]!!.contains("HTTP 503"))
        assertTrue(owner.state.value.revoking.isEmpty())
        assertEquals(size, owner.state.value.snapshot!!.usage.storedBytes)
    }
}
