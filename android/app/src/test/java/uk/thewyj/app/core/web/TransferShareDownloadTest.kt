package uk.thewyj.app.core.web

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TransferShareDownloadTest {
    private val share = "share-abcdefghijklmnop"
    private val file = "file-abcdefghijklmnop"
    private val grant = "grant-ABCDEFGHIJKLMNOP1234"
    private val url = "https://thewyj.uk/api/transfer/shares/$share/download?file=$file&grant=$grant"

    @Test fun onlyAnExactSameOriginShareGrantCanWriteDownloads() {
        assertTrue(TransferShareDownloadUrl.accepts(url, "https://thewyj.uk"))
        assertTrue(TransferShareDownloadUrl.accepts(
            "https://thewyj.uk/api/transfer/shares/$share/download?grant=$grant&file=$file",
            "https://thewyj.uk",
        ))
        listOf(
            url.replace("https://", "http://"),
            url.replace("thewyj.uk", "thewyj.uk.evil.example"),
            url.replace("thewyj.uk", "user@thewyj.uk"),
            url.replace("thewyj.uk", "thewyj.uk:444"),
            url.replace("/download?", "/revoke?"),
            "$url&redirect=https://evil.example",
            "$url&grant=$grant",
            url.replace("/shares/", "/shares/%2e%2e/"),
        ).forEach { assertFalse(it, TransferShareDownloadUrl.accepts(it, "https://thewyj.uk")) }
    }

    @Test fun interruptedRangeResumesAtTheLastByteWrittenWithoutCorruption() {
        val source = ByteArray(20) { it.toByte() }
        val calls = mutableListOf<Pair<Long, Long>>()
        val output = ByteArrayOutputStream()
        val copied = copyTransferRanges(20, output, { start, end ->
            calls += start to end
            val bytes = source.copyOfRange(start.toInt(), end.toInt() + 1)
            val responseStream: InputStream = if (calls.size == 1) object : ByteArrayInputStream(bytes) {
                var delivered = 0
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                    if (delivered >= 3) throw IOException("network interrupted")
                    val read = super.read(buffer, offset, minOf(length, 3 - delivered))
                    if (read > 0) delivered += read
                    return read
                }
            } else ByteArrayInputStream(bytes)
            object : TransferRangeResponse {
                override val status = 206
                override val contentRange = "bytes $start-$end/20"
                override val contentLength = bytes.size.toLong()
                override val input = responseStream
                override fun close() = responseStream.close()
            }
        }, chunkBytes = 8)
        assertEquals(20L, copied)
        assertArrayEquals(source, output.toByteArray())
        assertEquals(listOf(0L to 7L, 3L to 7L, 8L to 15L, 16L to 19L), calls)
    }

    @Test fun wrongContentRangeCannotPublishAFile() {
        val output = ByteArrayOutputStream()
        assertThrows(IOException::class.java) {
            copyTransferRanges(8, output, { _, _ ->
                object : TransferRangeResponse {
                    override val status = 206
                    override val contentRange = "bytes 1-7/8"
                    override val contentLength = 8L
                    override val input: InputStream = ByteArrayInputStream(ByteArray(8))
                    override fun close() = input.close()
                }
            }, chunkBytes = 8)
        }
        assertEquals(0, output.size())
    }
}
