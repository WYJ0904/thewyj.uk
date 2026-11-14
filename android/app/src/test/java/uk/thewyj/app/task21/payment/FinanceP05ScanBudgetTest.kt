package uk.thewyj.app.task21.payment

import android.app.Application
import androidx.room.Room
import java.util.concurrent.Callable
import java.util.concurrent.Executors
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
class FinanceP05ScanBudgetTest {
    @Test fun concurrentReservationsNeverGrantMoreThanEightReads() {
        val db=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java).allowMainThreadQueries().build()
        val pool=Executors.newFixedThreadPool(4)
        try {
            val store=RoomPaymentRecognitionStore(db);val ticket=PaymentTicketEngine(now={1000L}).create("owner","rec","com.tencent.mm","event","wechat");store.saveTicket(ticket)
            val results=pool.invokeAll((1..24).map { Callable {PaymentPersistedScanBudget.reserve(store,"owner",ticket.ticketId,1000L)} }).map {it.get()}
            assertEquals(8,results.count {it});assertEquals(8,store.ticket("owner",ticket.ticketId)!!.scanAttempts)
        } finally {pool.shutdownNow();db.close()}
    }
    @Test fun processReopenAndInMemoryEvictionCannotResetTheTicketBudget() {
        val context=RuntimeEnvironment.getApplication();val name="p05-scan-budget.db";context.deleteDatabase(name)
        fun open()=Room.databaseBuilder(context,NotificationDatabase::class.java,name).allowMainThreadQueries().build()
        var db=open();val ticket=PaymentTicketEngine(now={1000L}).create("owner","rec","com.tencent.mm","event","wechat")
        try {
            var store=RoomPaymentRecognitionStore(db);store.saveTicket(ticket)
            repeat(8){assertTrue(PaymentPersistedScanBudget.reserve(store,"owner",ticket.ticketId,1000L))}
            db.close();db=open();store=RoomPaymentRecognitionStore(db)
            assertFalse(PaymentPersistedScanBudget.reserve(store,"owner",ticket.ticketId,1001L))
            assertEquals(ticket.expiresAtMs,store.ticket("owner",ticket.ticketId)!!.expiresAtMs)
        } finally {db.close();context.deleteDatabase(name)}
    }
    @Test fun wrongAccountOldTicketAndOutOfWindowTimeFailClosed() {
        val db=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            val store=RoomPaymentRecognitionStore(db);val ticket=PaymentTicketEngine(now={1000L}).create("owner","rec","com.tencent.mm","event","wechat");store.saveTicket(ticket)
            assertFalse(PaymentPersistedScanBudget.reserve(store,"other-owner",ticket.ticketId,1000L))
            assertFalse(PaymentPersistedScanBudget.reserve(store,"owner",ticket.ticketId,999L))
            assertFalse(PaymentPersistedScanBudget.reserve(store,"owner",ticket.ticketId,91001L))
            assertTrue(PaymentPersistedScanBudget.reserve(store,"owner",ticket.ticketId,91000L))
            store.saveTicket(ticket.copy(state=PaymentTicketState.CONFIRMED))
            assertFalse(PaymentPersistedScanBudget.reserve(store,"owner",ticket.ticketId,1000L))
        } finally {db.close()}
    }
}
