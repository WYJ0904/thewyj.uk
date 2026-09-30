package uk.thewyj.app.task22

import java.io.IOException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TransferCompletionRecoveryTest {
    private fun share(id: String = "original-share") = TransferShare(id, "2030-01-01", 146317717L, 45, 5, 0, false, false)

    @Test fun lostResponseRecoversTheSamePublishedSessionExactlyOnce() {
        val calls = mutableListOf<String>()
        var attempts = 0
        val result = completeTransferWithRecovery("original-session", { id ->
            calls += "publish:$id"
            if (++attempts == 1) throw IOException("response timed out after commit")
            share()
        }, { id ->
            calls += "observe:$id"
            JSONObject().put("state", "published").put("share_id", "original-share")
        })
        assertEquals("original-share", result.id)
        assertEquals(45, result.fileCount)
        assertEquals(listOf("publish:original-session", "observe:original-session", "publish:original-session"), calls)
    }

    @Test fun activePublicationIsNotIssuedAgain() {
        val original = IOException("timeout")
        var calls = 0
        try {
            completeTransferWithRecovery("session", { calls++; throw original }, {
                JSONObject().put("state", "active")
            })
            fail("active publication must retain its original failure")
        } catch (error: IOException) { assertSame(original, error) }
        assertEquals(1, calls)
    }

    @Test fun offlineObservationKeepsOriginalFailureAndDoesNotRepublish() {
        val original = IOException("timeout")
        var calls = 0
        try {
            completeTransferWithRecovery("session", { calls++; throw original }, { throw IOException("offline") })
            fail("offline observation cannot prove a receipt")
        } catch (error: IOException) { assertSame(original, error); assertEquals(1, error.suppressed.size) }
        assertEquals(1, calls)
    }

    @Test fun RejectedPublicationDoesNotRunRecovery() {
        val failure = TransferApiException("incomplete", 409, "transfer_incomplete_upload")
        try {
            completeTransferWithRecovery("session", { throw failure }, { fail("domain rejection must not be retried"); JSONObject() })
            fail("must retain domain rejection")
        } catch (error: TransferApiException) { assertSame(failure, error) }
    }

    @Test fun differentReceiptIdentityCannotBeAccepted() {
        var calls = 0
        try {
            completeTransferWithRecovery("session", { if (++calls == 1) throw IOException("lost"); share("wrong-share") }, {
                JSONObject().put("state", "published").put("share_id", "original-share")
            })
            fail("mismatched receipt must not clear the queue")
        } catch (error: TransferApiException) { assertEquals("transfer_completion_identity_mismatch", error.code) }
        assertEquals(2, calls)
    }
}
