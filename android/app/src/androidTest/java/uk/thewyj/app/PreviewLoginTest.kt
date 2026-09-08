package uk.thewyj.app

import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import uk.thewyj.app.core.auth.SecureCredentialStore
import uk.thewyj.app.core.session.SessionState
import java.io.File
import java.net.URI

/** Opt-in physical Preview login. Only a disposable QA account may be supplied. */
class PreviewLoginTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun loginThroughVisibleFormAndPersistCredentials() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("previewFixtureLogin") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val fixtureFile = File(context.filesDir, "task20-preview-login.json")
        try {
            val fixture = JSONObject(fixtureFile.readText())
            val username = fixture.getString("username")
            val expectedId = fixture.getString("user_id")
            assertTrue(BuildConfig.DEBUG && URI(BuildConfig.THEWYJ_BASE_URL).host.endsWith(".pages.dev"))
            assertTrue(fixture.getString("origin") == BuildConfig.THEWYJ_BASE_URL)
            assertTrue(username.matches(Regex("qa20_[a-z0-9]+")))
            compose.waitUntil(20_000) {
                compose.onAllNodesWithText("安全登录").fetchSemanticsNodes().isNotEmpty()
            }
            val fields = compose.onAllNodes(hasSetTextAction())
            fields[0].performTextReplacement(username)
            fields[1].performTextReplacement(fixture.getString("secret"))
            compose.onNodeWithText("安全登录").performScrollTo().performClick()
            compose.waitUntil(30_000) {
                (AppGraph.sessionRepository.state.value as? SessionState.Authenticated)?.account?.id == expectedId
            }
            assertTrue(SecureCredentialStore(context).loadActive()?.account?.id == expectedId)
        } catch (_: Throwable) {
            // Compose failures can include text-field semantics. Never emit fixture credentials.
            throw AssertionError("Preview physical UI login failed; inspect sanitized HTTP/UI state diagnostics")
        } finally {
            fixtureFile.delete()
        }
    }
}
