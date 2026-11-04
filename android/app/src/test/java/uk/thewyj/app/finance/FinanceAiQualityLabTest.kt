package uk.thewyj.app.finance

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Strict boundary controls on synthetic evidence, never a real-model quality score. */
class FinanceAiQualityLabTest {
    private fun packet(unit: String = "CNY", direction: String = "expense"): JSONObject = JSONObject()
        .put("currency", unit).put("direction", direction).put("merchant_tokens", JSONArray(listOf("Restaurant")))
        .put("candidates", JSONArray().apply {
            listOf(9000L, 10000L, 1000L).forEachIndexed { i, amount ->
                put(JSONObject().put("id", "m$i").put("amount_minor", amount).put("currency", unit)
                    .put("amount_exponent", if (unit == "JPY") 0 else 2).put("phrases", JSONArray(when (i) {
                        0 -> listOf("本次", when (direction) { "income" -> "到账"; "refund" -> "退款"; else -> "扣除" })
                        1 -> listOf("原价")
                        else -> listOf("优惠")
                    })))
            }
        })

    private fun response(p: JSONObject): JSONObject {
        val direction = p.getString("direction")
        val roles = listOf(when (direction) { "income" -> "actual_received"; "refund" -> "refund"; else -> "actual_paid" }, "original", "discount")
        return JSONObject().put("status", "suggestion").put("requires_manual_confirmation", true)
            .put("suggestion", JSONObject().put("schema_version", 1).put("requires_manual_confirmation", true)
                .put("decision", "suggest").put("selected_candidate_id", "m0").put("currency", p.getString("currency"))
                .put("direction", direction).put("confidence", 950).put("refusal_reason", "none")
                .put("category", "other").put("merchant_normalized", "Restaurant")
                .put("evidence_refs", JSONArray(listOf("m0", "m1", "m2")))
                .put("amount_candidates", JSONArray().apply {
                    repeat(3) { i -> val c = p.getJSONArray("candidates").getJSONObject(i)
                        put(JSONObject().put("candidate_id", "m$i").put("amount_minor", c.getLong("amount_minor"))
                            .put("currency", c.getString("currency")).put("role", roles[i])
                            .put("evidence_refs", JSONArray(listOf("m$i"))))
                    }
                }))
    }

    @Test fun sixCurrenciesAndThreeDirectionsRetainOnlyExactSourceAmounts() {
        for (unit in listOf("CNY", "USD", "EUR", "HKD", "GBP", "JPY")) for (direction in listOf("expense", "income", "refund")) {
            val p = packet(unit, direction)
            val result = FinanceAiEvidence.validatedSuggestion(response(p), p)
            assertNotNull("$unit $direction", result)
            assertEquals(9000L, result!!.getJSONArray("amount_candidates").getJSONObject(0).getLong("amount_minor"))
            assertTrue(result.getBoolean("requires_manual_confirmation"))
        }
    }

    @Test fun unselectedCandidatesCannotAssertUnprovenMovementRoles() {
        for (role in listOf("actual_paid", "actual_received", "refund")) {
            val p = packet(); p.getJSONArray("candidates").getJSONObject(2).put("phrases", JSONArray(listOf("金额")))
            val r = response(p); r.getJSONObject("suggestion").getJSONArray("amount_candidates").getJSONObject(2).put("role", role)
            assertNull(role, FinanceAiEvidence.validatedSuggestion(r, p))
        }
    }

    @Test fun selectedCandidateCannotBorrowAnotherCandidatesMovementLabel() {
        val p = packet(); p.getJSONArray("candidates").getJSONObject(0).put("phrases", JSONArray(listOf("金额")))
        p.getJSONArray("candidates").getJSONObject(1).put("phrases", JSONArray(listOf("本次", "扣除")))
        val r = response(p); r.getJSONObject("suggestion").getJSONArray("amount_candidates").getJSONObject(1).put("role", "unknown")
        assertNull(FinanceAiEvidence.validatedSuggestion(r, p))
    }

    @Test fun unselectedAuxiliaryRolesAlsoNeedExplicitSourceLabels() {
        for (role in listOf("original", "discount", "balance", "fee")) {
            val p = packet(); p.getJSONArray("candidates").getJSONObject(2).put("phrases", JSONArray(listOf("金额")))
            val r = response(p); r.getJSONObject("suggestion").getJSONArray("amount_candidates").getJSONObject(2).put("role", role)
            assertNull(role, FinanceAiEvidence.validatedSuggestion(r, p))
        }
    }

    @Test fun stringSchemaVersionIsNotCoercedToAnInteger() {
        val p = packet(); val r = response(p); r.getJSONObject("suggestion").put("schema_version", "1")
        assertNull(FinanceAiEvidence.validatedSuggestion(r, p))
    }

    @Test fun fractionalSchemaVersionIsNotTruncatedToOne() {
        val p = packet(); val r = response(p); r.getJSONObject("suggestion").put("schema_version", 1.1)
        assertNull(FinanceAiEvidence.validatedSuggestion(r, p))
    }

    @Test fun overflowingLongConfidenceCannotWrapIntoAnAcceptedScore() {
        val p = packet(); val r = response(p); r.getJSONObject("suggestion").put("confidence", (1L shl 32) + 950L)
        assertNull(FinanceAiEvidence.validatedSuggestion(r, p))
    }

    @Test fun integralNumericVersionAndUncertainReviewRemainCompatible() {
        val p = packet(); val r = response(p).put("status", "review")
        r.getJSONObject("suggestion").put("schema_version", 1.0).put("decision", "review")
            .put("selected_candidate_id", JSONObject.NULL).put("refusal_reason", "ambiguous").put("confidence", 600)
        assertNotNull(FinanceAiEvidence.validatedSuggestion(r, p))
    }

    @Test fun schemaCannotAddPaymentAuthorityOrInventedIdentity() {
        for (key in listOf("settlement_confirmed", "execute_payment", "provider_reference", "account_id")) {
            val p = packet(); val r = response(p); r.getJSONObject("suggestion").put(key, "SYNTHETIC_UNSUPPORTED")
            assertNull(key, FinanceAiEvidence.validatedSuggestion(r, p))
        }
    }
}
