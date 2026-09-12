package uk.thewyj.app.task21.screenshot

import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import java.util.concurrent.Executor
import uk.thewyj.app.task21.CaptureTrace
import uk.thewyj.app.task21.NotificationArchiveSink
import uk.thewyj.app.task21.NotificationCaptureCoordinator
import uk.thewyj.app.task21.ScreenshotMediaEvent

/**
 * Task 24.1 R4: MediaStore screenshot fallback.
 *
 * Samsung/One UI keeps one "截图已保存" notification slot and replaces it in
 * place for every new screenshot, so the notification callback cannot prove how
 * many screenshots were taken. MediaStore is the authoritative source, but only
 * when the app really holds the full image read grant - Android 14+ "Selected
 * Photos Access" still delivers collection-change callbacks while the new
 * screenshot URI stays unreadable. A change notification is therefore never
 * treated as proof that the image can be copied.
 */
class ScreenshotMediaObserver(
    private val context: Context,
    private val account: () -> NotificationCaptureCoordinator.CaptureAccount?,
    private val sink: () -> NotificationArchiveSink?,
    private val executor: Executor,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val archiveSink: NotificationArchiveSink? by lazy { runCatching { sink() }.getOrNull() }
    private var registered = false
    private val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) {
            dispatchScan()
        }

        override fun onChange(selfChange: Boolean, uri: Uri?) {
            dispatchScan()
        }
    }

    fun start() {
        if (!registered) {
            registered = runCatching {
                context.contentResolver.registerContentObserver(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    true,
                    observer,
                )
                true
            }.getOrDefault(false)
            CaptureTrace.stage(
                TRACE_ID,
                "screenshot-observer",
                "state=${if (registered) "registered" else "register-failed"} " +
                    "capability=${MediaReadPolicy.current(context).name.lowercase()}",
            )
        }
        // Catch up on screenshots taken while the listener was not bound.
        dispatchScan()
    }

    fun stop() {
        if (!registered) return
        runCatching { context.contentResolver.unregisterContentObserver(observer) }
        registered = false
    }

    private fun dispatchScan() {
        executor.execute { runCatching { scan() } }
    }

    /**
     * One scan. Returns how many screenshots were handed to the archive; the
     * capability is re-read every time so a permission change is honoured
     * immediately (and a limited grant can never be mistaken for a full one).
     */
    fun scan(incrementalLookbackMs: Long = DEFAULT_LOOKBACK_MS): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
        val capability = MediaReadPolicy.current(context)
        CaptureTrace.stage(TRACE_ID, MediaReadPolicy.logStage(capability))
        if (!MediaReadPolicy.allowsMediaStoreImport(capability)) {
            // Degraded on purpose: the notification payload (when it has a
            // picture) stays the only source, and nothing from MediaStore is
            // copied or linked.
            CaptureTrace.stage(TRACE_ID, "media-store-skipped", "reason=capability_${capability.name.lowercase()}")
            return 0
        }
        val current = account() ?: return 0
        if (!current.archiveEntitled) return 0
        val target = archiveSink ?: return 0
        val watermark = ScreenshotWatermark(context)
        val rows = queryScreenshots(incrementalLookbackMs)
        if (rows.isEmpty()) return 0
        if (!watermark.initialized) {
            // First run after install: adopt the current state instead of
            // importing the user's entire screenshot history.
            watermark.adopt(rows.maxOf { it.rowId })
            CaptureTrace.stage(TRACE_ID, "screenshot-observer-initialized", "maxRowId=${rows.maxOf { it.rowId }}")
            return 0
        }
        var imported = 0
        for (row in rows) {
            if (row.rowId <= watermark.lastRowId) continue
            if (imported >= MAX_IMPORTS_PER_SCAN) break
            CaptureTrace.stage(
                TRACE_ID,
                "screenshot-detected",
                "origin=media_store rowId=${row.rowId} mime=${row.mimeType.ifBlank { "-" }}",
            )
            val outcome = target.storeMediaStoreScreenshot(
                current.accountId,
                ScreenshotMediaEvent(
                    fingerprint = ScreenshotEvidence.mediaStoreFingerprint(row.rowId),
                    rowId = row.rowId,
                    sourcePackage = row.ownerPackage.ifBlank { ScreenshotOwner.packageName(context) },
                    appLabel = "",
                    title = row.displayName.ifBlank { "截图" },
                    text = "",
                    capturedAtMs = row.capturedAtMs,
                    mediaUri = row.uri,
                    mediaMime = row.mimeType,
                    mediaState = "available",
                ),
            )
            CaptureTrace.stage(TRACE_ID, "media-${outcome.name.lowercase()}", "rowId=${row.rowId}")
            watermark.advance(row.rowId)
            imported += 1
        }
        return imported
    }

    private fun queryScreenshots(lookbackMs: Long): List<ScreenshotRow> {
        val resolver: ContentResolver = context.contentResolver
        val sinceSeconds = ((if (lookbackMs > 0) now() - lookbackMs else 0L) / 1000L).coerceAtLeast(0L)
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.MIME_TYPE,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.RELATIVE_PATH,
            MediaStore.Images.Media.OWNER_PACKAGE_NAME,
        )
        val selection = "(${MediaStore.Images.Media.RELATIVE_PATH} LIKE ? " +
            "OR ${MediaStore.Images.Media.BUCKET_DISPLAY_NAME} = ?) " +
            "AND ${MediaStore.Images.Media.DATE_ADDED} >= ?"
        val args = arrayOf("%Screenshots%", "Screenshots", sinceSeconds.toString())
        val rows = mutableListOf<ScreenshotRow>()
        runCatching {
            resolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                selection,
                args,
                "${MediaStore.Images.Media.DATE_ADDED} ASC, ${MediaStore.Images.Media._ID} ASC",
            )?.use { cursor ->
                val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val nameColumn = cursor.getColumnIndex(MediaStore.Images.Media.DISPLAY_NAME)
                val mimeColumn = cursor.getColumnIndex(MediaStore.Images.Media.MIME_TYPE)
                val addedColumn = cursor.getColumnIndex(MediaStore.Images.Media.DATE_ADDED)
                val takenColumn = cursor.getColumnIndex(MediaStore.Images.Media.DATE_TAKEN)
                val ownerColumn = cursor.getColumnIndex(MediaStore.Images.Media.OWNER_PACKAGE_NAME)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idColumn)
                    val addedSeconds = if (addedColumn >= 0) cursor.getLong(addedColumn) else 0L
                    val takenMs = if (takenColumn >= 0 && !cursor.isNull(takenColumn)) cursor.getLong(takenColumn) else 0L
                    rows += ScreenshotRow(
                        rowId = id,
                        displayName = if (nameColumn >= 0) cursor.getString(nameColumn).orEmpty() else "",
                        mimeType = if (mimeColumn >= 0) cursor.getString(mimeColumn).orEmpty() else "",
                        capturedAtMs = if (takenMs > 0) takenMs else addedSeconds * 1000L,
                        ownerPackage = if (ownerColumn >= 0) cursor.getString(ownerColumn).orEmpty() else "",
                        uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id).toString(),
                    )
                }
            }
        }
        return rows
    }

    data class ScreenshotRow(
        val rowId: Long,
        val displayName: String,
        val mimeType: String,
        val capturedAtMs: Long,
        val ownerPackage: String,
        val uri: String,
    )

    companion object {
        const val TRACE_ID = "screenshot-observer"

        /** How far back a scan looks for rows it has not archived yet. */
        const val DEFAULT_LOOKBACK_MS = 30L * 60L * 1000L

        /** Bounded work per scan; the next change callback continues. */
        const val MAX_IMPORTS_PER_SCAN = 12
    }
}

/**
 * Persisted MediaStore row watermark. Without it a restart would re-open the
 * whole lookback window; the archive identity still dedupes, but the watermark
 * keeps the work tiny.
 */
class ScreenshotWatermark(context: Context) {
    private val preferences = context.applicationContext
        .getSharedPreferences("thewyj-screenshot-observer", Context.MODE_PRIVATE)

    val initialized: Boolean get() = preferences.contains(KEY_LAST_ROW_ID)

    val lastRowId: Long get() = preferences.getLong(KEY_LAST_ROW_ID, 0L)

    fun adopt(rowId: Long) = preferences.edit().putLong(KEY_LAST_ROW_ID, rowId).apply()

    fun advance(rowId: Long) {
        if (rowId > lastRowId) preferences.edit().putLong(KEY_LAST_ROW_ID, rowId).apply()
    }

    companion object {
        const val KEY_LAST_ROW_ID = "last_screenshot_row_id"
    }
}

/**
 * Package shown in history when MediaStore does not expose the capturing app
 * (screenshots usually have no owner package). Falls back to the system UI so
 * the entry never claims a wrong third-party app.
 */
object ScreenshotOwner {
    private val CANDIDATES = listOf(
        "com.samsung.android.app.smartcapture",
        "com.samsung.android.screenshot",
        "com.android.systemui",
    )

    fun packageName(context: Context, candidates: List<String> = CANDIDATES): String {
        val packages = context.packageManager
        return candidates.firstOrNull { candidate ->
            runCatching { packages.getPackageInfo(candidate, 0) }.isSuccess
        } ?: candidates.last()
    }
}
