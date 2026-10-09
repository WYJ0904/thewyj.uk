package uk.thewyj.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.core.features.FeatureSnapshot

/** Uses Android's JSONObject implementation; this is software emulator evidence. */
@RunWith(AndroidJUnit4::class)
class FeatureContractInstrumentedTest {
    @Test fun sharedContractOnAndroidRuntime() {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val contract = JSONObject(assets.open("feature-contract-vectors.json").bufferedReader().use { it.readText() })
        val now = contract.getLong("now_ms")
        val cases = contract.getJSONArray("cases")
        for (index in 0 until cases.length()) {
            val test = cases.getJSONObject(index)
            val owner = test.getString("account_id")
            val snapshot = FeatureSnapshot.fromJson(test.getJSONObject("snapshot"), owner, now)
            assertEquals(test.getString("name"), test.getBoolean("valid"), snapshot != null)
            assertEquals(test.getString("name"), test.getBoolean("expected_enabled"), snapshot?.enabled("aeris_experimental_badge", owner, now) == true)
            assertFalse(snapshot?.enabled("unknown_flag", owner, now) == true)
            assertFalse(snapshot?.enabled("aeris_experimental_badge", "other-account", now) == true)
            assertFalse(snapshot?.enabled("aeris_experimental_badge", owner, now + 30_000) == true)
        }
    }
}
