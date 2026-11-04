package uk.thewyj.app.qa

import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import uk.thewyj.app.task21.NotificationOfflineQueue
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.*

/** Each method runs in a separate own QA process; no formal data or network. */
class CandidateRoomRecoveryTest {
    private val owner="qa3-hf4-room-recovery"
    private val event="qa3-hf4-durable-event"
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val expected get()=File(context.getExternalFilesDir(null),"hf4-recovery-expected.json")
    @Test fun S01_seedDurableRoomAndOutbox() {
        check(context.packageName=="uk.thewyj.app.qa.hf4")
        check(!expected.exists()) { "Preserve earlier recovery fixture; do not overwrite" }
        D01Probe.stage("ROOM_SEED")
        ActivityScenario.launch(StateAcceptanceActivity::class.java).use { scenario ->
            lateinit var a:StateAcceptanceActivity
            scenario.onActivity { a=it }
            runBlocking { a.configure(owner,emptyList()) }
            runBlocking(Dispatchers.IO) {
                val record=a.recognition(owner,event,123,direction="INCOME",complete=true)
                a.store.saveRecognition(record)
                assertNotNull(PaymentRecognitionCoordinator(a.store).autoBook(owner,record.recognitionId))
                LocalPaymentLedger.recover(a,owner,"qa3-hf4-device")
                val bookings=a.store.localBookings(owner)
                assertEquals(1,bookings.size)
                val queue=NotificationOfflineQueue.inDirectory(a.filesDir,owner).peekRequests()
                assertTrue(queue.size>=2)
                expected.writeText(JSONObject().put("pid",android.os.Process.myPid()).put("transaction",bookings.single().transactionId)
                    .put("recognition",record.recognitionId).put("operationIds",JSONArray(queue.map{it.operationId}.sorted())).toString())
                D01Probe.write("room-seeded",JSONObject().put("bookings",1).put("queueRequests",queue.size))
            }
        }
        D01Probe.stage("idle")
    }
    @Test fun S02_afterProcessRestartRecoverWithoutDuplication() {
        check(context.packageName=="uk.thewyj.app.qa.hf4")
        D01Probe.stage("ROOM_RESTART_VERIFY")
        val old=JSONObject(expected.readText())
        assertNotEquals(old.getInt("pid"),android.os.Process.myPid())
        runBlocking(Dispatchers.IO) {
            val database=NotificationDatabase.get(context)
            val store=RoomPaymentRecognitionStore(database)
            val before=store.localBookings(owner)
            assertEquals(1,before.size)
            assertEquals(old.getString("transaction"),before.single().transactionId)
            assertEquals("FINANCE_RECORDED",store.recognition(owner,old.getString("recognition"))!!.state)
            assertEquals(old.getString("transaction"),store.candidateForRecognition(owner,old.getString("recognition"))!!.financeTransactionId)
            val queue=NotificationOfflineQueue.inDirectory(context.filesDir,owner)
            assertEquals(old.getJSONArray("operationIds").toString(),JSONArray(queue.peekRequests().map{it.operationId}.sorted()).toString())
            repeat(3) { LocalPaymentLedger.recover(context,owner,"qa3-hf4-device") }
            assertEquals(1,store.localBookings(owner).size)
            assertEquals(old.getString("transaction"),store.localBookings(owner).single().transactionId)
            assertEquals(old.getJSONArray("operationIds").toString(),JSONArray(queue.peekRequests().map{it.operationId}.sorted()).toString())
            D01Probe.write("room-restart-verified",JSONObject().put("differentProcess",true).put("bookingCount",1)
                .put("outboxOperationsRetained",queue.peekRequests().size).put("recoveryReplays",3))
        }
        D01Probe.stage("idle")
    }
}
