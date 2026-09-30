package uk.thewyj.app.task22

import java.io.IOException
import org.json.JSONObject

/** A lost publish response may still have committed on the server. */
internal fun completeTransferWithRecovery(
    sessionId: String,
    publish: (String) -> TransferShare,
    observe: (String) -> JSONObject,
): TransferShare {
    try {
        return publish(sessionId)
    } catch (failure: Exception) {
        val transient = failure is IOException || (failure is TransferApiException &&
            (failure.status >= 500 || failure.status in setOf(408, 429)))
        if (!transient) throw failure
        val state = try { observe(sessionId) } catch (observationFailure: Exception) {
            failure.addSuppressed(observationFailure)
            throw failure
        }
        val shareId = state.optString("share_id")
        // Never start a second publication while the original one is active,
        // and never manufacture a new session to recover an acknowledgement.
        if (state.optString("state") != "published" || shareId.isBlank()) throw failure
        val share = publish(sessionId)
        if (share.id != shareId) {
            throw TransferApiException("分享回执标识不一致，请刷新重试", 409, "transfer_completion_identity_mismatch")
        }
        return share
    }
}
