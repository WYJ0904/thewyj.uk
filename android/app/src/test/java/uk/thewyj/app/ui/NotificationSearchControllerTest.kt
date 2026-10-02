package uk.thewyj.app.ui

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationSearchControllerTest {
    @Test fun continuousChineseEnglishAndDeleteInputQueriesOnlyTheSettledValue() = runTest {
        var visible = ""
        val queries = mutableListOf<String>()
        val search = NotificationSearchController(this, { visible = it }, { queries += visible })
        for (value in listOf("通", "通知", "notification", "notification long query", "notification", "")) {
            search.submit(value)
            assertEquals(value, visible)
            advanceTimeBy(30)
        }
        assertTrue(queries.isEmpty())
        advanceTimeBy(195)
        runCurrent()
        assertEquals(listOf(""), queries)
    }

    @Test fun newInputCancelsAnAlreadyRunningQuery() = runTest {
        var visible = ""
        val committed = mutableListOf<String>()
        val search = NotificationSearchController(this, { visible = it }, {
            val captured = visible
            delay(1000)
            committed += captured
        })
        search.submit("old")
        advanceTimeBy(225); runCurrent()
        search.submit("new")
        advanceTimeBy(1225); runCurrent()
        assertEquals(listOf("new"), committed)
    }

    @Test fun leavingTheScreenCancelsItsPendingRead() = runTest {
        val queries = mutableListOf<String>()
        val search = NotificationSearchController(this, {}, { queries += "read" })
        search.submit("pending")
        advanceTimeBy(100)
        search.cancel()
        advanceTimeBy(1000); runCurrent()
        assertTrue(queries.isEmpty())
    }
}
