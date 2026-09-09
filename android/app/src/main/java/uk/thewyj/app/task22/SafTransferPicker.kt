package uk.thewyj.app.task22

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.documentfile.provider.DocumentFile

/**
 * SAF-backed source enumeration. Directories are expanded into a flat list of
 * TransferFileSource entries with relative paths preserved; reading is
 * deferred to upload time so directory traversal never loads file bytes.
 */
object SafTransferPicker {
    fun documentSource(context: Context, uri: Uri): TransferFileSource? {
        val resolver = context.contentResolver
        val displayName = queryDisplayName(resolver, uri) ?: "unnamed"
        val size = querySize(resolver, uri)
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        return TransferFileSource(
            uri = uri.toString(),
            displayName = displayName,
            relativePath = displayName,
            sizeBytes = size,
            mimeType = mime,
        )
    }

    fun treeSources(context: Context, treeUri: Uri): List<TransferFileSource> {
        val document = DocumentFile.fromTreeUri(context, treeUri) ?: return emptyList()
        val result = mutableListOf<TransferFileSource>()
        collectDocument(context, document, "", result, 0)
        return result
    }

    private fun collectDocument(
        context: Context,
        document: DocumentFile,
        prefix: String,
        output: MutableList<TransferFileSource>,
        depth: Int,
    ) {
        if (depth > 32 || output.size >= 500) return
        if (document.isDirectory) {
            for (child in document.listFiles()) {
                collectDocument(context, child, if (prefix.isEmpty()) document.name.orEmpty() else "$prefix/${document.name.orEmpty()}", output, depth + 1)
            }
            return
        }
        val name = document.name ?: "unnamed"
        output.add(
            TransferFileSource(
                uri = document.uri.toString(),
                displayName = name,
                relativePath = if (prefix.isEmpty()) name else "$prefix/$name",
                sizeBytes = document.length(),
                mimeType = document.type ?: context.contentResolver.getType(document.uri) ?: "application/octet-stream",
            ),
        )
    }

    fun persistAccess(context: Context, uri: Uri, read: Boolean = true) {
        val flags = (if (read) Intent.FLAG_GRANT_READ_URI_PERMISSION else 0)
            .or(if (!read) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0)
        runCatching {
            context.contentResolver.takePersistableUriPermission(uri, flags)
        }
    }

    private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) return cursor.getString(index)
            }
        }
        return null
    }

    private fun querySize(resolver: ContentResolver, uri: Uri): Long {
        resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (index >= 0) return cursor.getLong(index)
            }
        }
        return 0L
    }
}
