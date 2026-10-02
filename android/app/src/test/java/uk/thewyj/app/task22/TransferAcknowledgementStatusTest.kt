package uk.thewyj.app.task22

import org.junit.Assert.*
import org.junit.Test

class TransferAcknowledgementStatusTest {
    private fun item(status: TransferItemStatus) = QueuedTransfer("owned", TransferFileSource("content://fixture", "fixture", "fixture", 48L, "application/octet-stream"),
        uploadedParts = setOf(1), uploadedBytes = 16L, status = status)
    @Test fun resumedInFlightWorkerReflectsRealUploadAndDoesNotDoubleCountAnAck() {
        val resumed = item(TransferItemStatus.PENDING).acknowledgedPart(2, 16L)
        assertEquals(TransferItemStatus.UPLOADING, resumed.status)
        assertEquals(setOf(1, 2), resumed.uploadedParts); assertEquals(32L, resumed.uploadedBytes)
        assertEquals(resumed, resumed.acknowledgedPart(2, 16L))
    }
    @Test fun acknowledgementNeverOverwritesTheLatestPauseOrCancellation() {
        for (status in listOf(TransferItemStatus.PAUSED, TransferItemStatus.CANCELLED)) {
            val latest = item(status).acknowledgedPart(2, 16L)
            assertEquals(status, latest.status); assertEquals(32L, latest.uploadedBytes)
        }
    }
}
