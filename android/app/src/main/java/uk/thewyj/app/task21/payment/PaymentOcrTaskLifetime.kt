package uk.thewyj.app.task21.payment

import android.graphics.Bitmap
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** A timed-out SDK task owns its private bitmap until completion; it cannot queue more images. */
internal object PaymentOcrTaskLifetime {
    const val TIMEOUT_MS=10_000L
    fun <T> await(bitmap:Bitmap,busy:AtomicBoolean,process:(Bitmap)->Task<T>,
                  wait:(Task<T>)->T={Tasks.await(it,TIMEOUT_MS,TimeUnit.MILLISECONDS)}):T? {
        if (!busy.compareAndSet(false,true)) return null
        val owned=runCatching {bitmap.copy(Bitmap.Config.ARGB_8888,false)}.getOrNull()
        if (owned==null) {busy.set(false);return null}
        val task=try {process(owned)} catch (_:Exception) {owned.recycle();busy.set(false);return null}
        task.addOnCompleteListener(Executor {it.run()}) {
            try {owned.recycle()} finally {busy.set(false)}
        }
        return runCatching {wait(task)}.getOrNull()
    }
}
