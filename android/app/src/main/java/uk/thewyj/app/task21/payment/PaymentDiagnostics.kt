package uk.thewyj.app.task21.payment

import android.util.Log
import uk.thewyj.app.BuildConfig
import java.security.MessageDigest

/** Explicit test-candidate diagnostics: amounts and opaque identities, never page prose. */
object PaymentDiagnostics {
    fun emit(stage: String, fields: String) {
        if (BuildConfig.DEBUG || BuildConfig.PAYMENT_DIAGNOSTICS) runCatching { Log.i("AerisPayDiag", "stage=$stage $fields") }
    }
    fun identity(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        .take(8).joinToString("") { "%02x".format(it.toInt() and 255) }
    fun amounts(decision: PageAmountDecision) {
        decision.candidates.forEach {
            emit("candidate", "line=${it.line} raw=${it.rawNumber} normalized=${it.normalizedNumber} minor=${it.minor} score=${it.score} reason=${it.reason}")
        }
        emit("selection", "candidates=${decision.candidates.size} minor=${decision.amountMinor} reason=${decision.reason}")
    }
}
