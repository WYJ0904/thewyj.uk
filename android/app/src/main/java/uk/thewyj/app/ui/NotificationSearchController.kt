package uk.thewyj.app.ui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Input updates immediately; only the latest settled query reaches storage. */
internal class NotificationSearchController(
    private val scope: CoroutineScope,
    private val updateInput: (String) -> Unit,
    private val query: suspend () -> Unit,
    private val debounceMillis: Long = 225,
) {
    private var job: Job? = null
    private var latest: String? = null

    fun submit(value: String) {
        if (value == latest) return
        latest = value
        updateInput(value)
        job?.cancel()
        job = scope.launch {
            delay(debounceMillis)
            query()
        }
    }

    fun cancel() { job?.cancel(); job = null }
}
