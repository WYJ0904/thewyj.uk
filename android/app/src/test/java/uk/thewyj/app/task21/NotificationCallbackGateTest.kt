package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationCallbackGateTest {
    @Test fun oneHundredDuplicateCallbacksRunThePipelineOnce() {
        var now = 1_000L
        val gate = NotificationCallbackGate(now = { now })
        val input = capture(text = "状态 1", media = "")

        val accepted = (0 until 100).count {
            now += 1
            gate.shouldProcess(input)
        }

        assertEquals(1, accepted)
    }

    @Test fun realContentOrMediaChangesRemainDistinct() {
        var now = 1_000L
        val gate = NotificationCallbackGate(now = { now })
        assertTrue(gate.shouldProcess(capture(text = "第一条", media = "")))
        now += 10
        assertFalse(gate.shouldProcess(capture(text = "第一条", media = "")))
        now += 10
        assertTrue(gate.shouldProcess(capture(text = "第二条", media = "")))
        now += 10
        assertTrue(gate.shouldProcess(capture(text = "第二条", media = "image-a")))
    }

    @Test fun sameContentAfterWindowIsProcessedAgain() {
        var now = 1_000L
        val gate = NotificationCallbackGate(duplicateWindowMs = 100, now = { now })
        val input = capture(text = "同一内容", media = "")
        assertTrue(gate.shouldProcess(input))
        now = 1_101L
        assertTrue(gate.shouldProcess(input))
    }

    private fun capture(text: String, media: String) = NotificationCaptureInput(
        sourcePackage = "com.example.app",
        notificationKey = "key-one",
        notificationId = 1,
        postTime = 50,
        title = "标题",
        text = text,
        mediaState = if (media.isBlank()) "none" else "available",
        mediaFingerprint = media,
    )
}
