package uk.thewyj.app.task21.payment

import android.app.Application
import android.graphics.Bitmap
import com.google.android.gms.tasks.TaskCompletionSource
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class FinanceP05OcrTaskLifetimeTest {
    @Test fun timeoutRetainsOnlyPrivateCopyAndLateCompletionCannotReturnAnOldResult() {
        val image=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888);val busy=AtomicBoolean();val pending=TaskCompletionSource<String>()
        lateinit var owned:Bitmap
        try {
            val result=PaymentOcrTaskLifetime.await(image,busy,{owned=it;pending.task},{throw TimeoutException("SYNTHETIC_TIMEOUT")})
            assertNull(result);assertTrue(busy.get());assertFalse(image.isRecycled);assertFalse(owned.isRecycled)
            assertNull(PaymentOcrTaskLifetime.await<String>(image,busy,{error("Do not queue another SDK image while one is pending")}))
            pending.setResult("late")
            assertFalse(busy.get());assertTrue(owned.isRecycled);assertFalse(image.isRecycled)
        } finally {image.recycle()}
    }
    @Test fun completedTaskReleasesItsCopyWithoutRecyclingCallerImage() {
        val image=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888);val busy=AtomicBoolean();lateinit var owned:Bitmap
        val executor=java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            assertEquals("done",executor.submit(java.util.concurrent.Callable {
                PaymentOcrTaskLifetime.await(image,busy,{owned=it;Tasks.forResult("done")})
            }).get(5,java.util.concurrent.TimeUnit.SECONDS))
            assertTrue(owned.isRecycled);assertFalse(image.isRecycled);assertFalse(busy.get())
            assertTrue(PaymentOcrTaskLifetime.TIMEOUT_MS<PaymentTicketEngine.DEFAULT_TTL_MS)
        } finally {executor.shutdownNow();image.recycle()}
    }
}
