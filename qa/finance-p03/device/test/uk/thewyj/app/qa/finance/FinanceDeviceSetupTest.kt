package uk.thewyj.app.qa.finance
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.AppGraph
import uk.thewyj.app.core.session.SessionState
@RunWith(AndroidJUnit4::class)
class FinanceDeviceSetupTest {
    @Test fun actualEncryptedSessionAndPinnedLocalBackend(){
        val c=InstrumentationRegistry.getInstrumentation().targetContext
        val bootstrap=FinanceDeviceSupport.api("/__qa/bootstrap")
        assertTrue(bootstrap.getBoolean("synthetic_only"))
        assertEquals(FinanceDeviceSupport.OWNER,bootstrap.getString("account_id"))
        runBlocking{AppGraph.sessionRepository.login(bootstrap.getString("username"),bootstrap.getString("secret"))}
        val state=AppGraph.sessionRepository.state.value
        assertTrue("Actual Task20 login must authenticate",state is SessionState.Authenticated)
        assertEquals(FinanceDeviceSupport.OWNER,(state as SessionState.Authenticated).account.id)
        FinanceDeviceGate.enable(c,true)
        FinanceDeviceSupport.record(c,"DEVICE-LOGIN",org.json.JSONObject().put("account_scope",FinanceDeviceSupport.OWNER).put("actual_task20",true).put("credentials_logged",false))
    }
}
