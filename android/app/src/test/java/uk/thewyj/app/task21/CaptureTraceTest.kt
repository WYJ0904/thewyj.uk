package uk.thewyj.app.task21

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureTraceTest {
    private val lines = mutableListOf<String>()

    @After fun tearDown() {
        CaptureTrace.observer = null
    }

    @Test fun stagesShareOneTraceIdAndStayInOrder() {
        CaptureTrace.observer = { lines.add(it) }
        val traceId = CaptureTrace.traceId("com.tencent.mm|1|", "com.tencent.mm", 1)
        CaptureTrace.begin(traceId, "com.tencent.mm", postTime = 1_700_000_000_000)
        CaptureTrace.stage(traceId, "archive-accepted", "pkg=com.tencent.mm")
        CaptureTrace.stage(traceId, "room-committed", "instance=inst-1")
        CaptureTrace.stage(traceId, "flow-emitted")
        CaptureTrace.stage(traceId, "ui-rendered", "items=3")

        assertEquals(5, lines.size)
        assertTrue(lines[0].startsWith("listener-received trace=$traceId"))
        assertTrue(lines[1].startsWith("archive-accepted trace=$traceId"))
        assertTrue(lines[2].startsWith("room-committed trace=$traceId"))
        assertTrue(lines[3].startsWith("flow-emitted trace=$traceId"))
        assertTrue(lines[4].startsWith("ui-rendered trace=$traceId"))
        assertTrue(lines.all { it.contains("elapsedMs=") || it.contains("postTime=") })
    }

    @Test fun blankKeyFallsBackToPackageAndId() {
        assertEquals("com.tencent.mm|42", CaptureTrace.traceId("", "com.tencent.mm", 42))
    }
}
