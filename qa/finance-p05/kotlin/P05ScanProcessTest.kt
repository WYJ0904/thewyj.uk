package uk.thewyj.app.task21.payment

import android.app.Application
import androidx.room.Room
import java.io.File
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class P05ScanBudgetSeedTest {
    @Test fun seed() {
        val out=File(System.getProperty("finance.p02.output"));out.mkdirs()
        val root=generateSequence(out){it.parentFile}.first {File(it,"android/app").isDirectory}
        val runtime=File(root,"docs/migration-evidence/p05-budget-${UUID.randomUUID().toString().take(8)}");check(runtime.mkdirs())
        val file=File(runtime,"budget.db")
        val db=Room.databaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java,file.absolutePath).allowMainThreadQueries().build()
        val ticket=PaymentTicketEngine(now={1000L}).create("synthetic-process-owner","rec","com.tencent.mm","event","wechat")
        try {val store=RoomPaymentRecognitionStore(db);store.saveTicket(ticket);repeat(8){assertTrue(PaymentPersistedScanBudget.reserve(store,ticket.accountId,ticket.ticketId,1000L))}}finally {db.close()}
        File(out,"seed.json").writeText(JSONObject().put("pid",ProcessHandle.current().pid()).put("database",file.absolutePath).put("ticket",ticket.ticketId).put("expires",ticket.expiresAtMs).toString())
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class P05ScanBudgetRestoreTest {
    @Test fun restore() {
        val out=File(System.getProperty("finance.p02.output"));val seed=JSONObject(File(out,"seed.json").readText())
        assertNotEquals(seed.getLong("pid"),ProcessHandle.current().pid())
        val db=Room.databaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java,seed.getString("database")).allowMainThreadQueries().build()
        try {
            val store=RoomPaymentRecognitionStore(db);val ticket=store.ticket("synthetic-process-owner",seed.getString("ticket"))!!
            assertEquals(8,ticket.scanAttempts);assertEquals(seed.getLong("expires"),ticket.expiresAtMs)
            assertFalse(PaymentPersistedScanBudget.reserve(store,ticket.accountId,ticket.ticketId,1001L));assertTrue(store.localBookings(ticket.accountId).isEmpty())
        } finally {db.close()}
        File(out,"restore.json").writeText(JSONObject().put("status","PASS").put("seed_pid",seed.getLong("pid")).put("restore_pid",ProcessHandle.current().pid()).put("scan_attempts",8).put("expiry_unchanged",true).toString())
    }
}
