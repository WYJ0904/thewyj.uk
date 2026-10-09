package uk.thewyj.app.core.features

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class FeatureSnapshotTest {
    @Test fun sharedWebAndNativeContracts() {
        val json = JSONObject(requireNotNull(javaClass.classLoader?.getResourceAsStream("feature-contract-vectors.json")).bufferedReader().use { it.readText() })
        val now = json.getLong("now_ms")
        val cases = json.getJSONArray("cases")
        for (index in 0 until cases.length()) {
            val test = cases.getJSONObject(index)
            val account = test.getString("account_id")
            val snapshot = FeatureSnapshot.fromJson(test.getJSONObject("snapshot"), account, now)
            assertEquals(test.getString("name"), test.getBoolean("valid"), snapshot != null)
            assertEquals(test.getString("name"), test.getBoolean("expected_enabled"), snapshot?.enabled("aeris_experimental_badge", account, now) == true)
            assertFalse(snapshot?.enabled("unknown_flag", account, now) == true)
            assertFalse(snapshot?.enabled("aeris_experimental_badge", "other-account", now) == true)
            assertFalse(snapshot?.enabled("aeris_experimental_badge", account, now + 30_000) == true)
        }
    }
}
