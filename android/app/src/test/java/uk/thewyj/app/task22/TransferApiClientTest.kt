package uk.thewyj.app.task22

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class TransferApiClientTest {
    @Test fun readExactlyNeverOverReadsIntoTheNextPart() {
        // A 96-byte source with three 32-byte parts: each part read must be exact.
        val source = ByteArray(96) { it.toByte() }
        val part1 = ByteArrayOutputStream()
        val part2 = ByteArrayOutputStream()
        val part3 = ByteArrayOutputStream()
        val input = ByteArrayInputStream(source)

        assertEquals(32, TransferApiClient.readExactly(input, 32, part1) {})
        assertEquals(32, TransferApiClient.readExactly(input, 32, part2) {})
        assertEquals(32, TransferApiClient.readExactly(input, 32, part3) {})

        assertArrayEquals(source.copyOfRange(0, 32), part1.toByteArray())
        assertArrayEquals(source.copyOfRange(32, 64), part2.toByteArray())
        assertArrayEquals(source.copyOfRange(64, 96), part3.toByteArray())
    }

    @Test(expected = java.io.EOFException::class) fun readExactlyRejectsTruncatedPart() {
        val source = ByteArray(10) { it.toByte() }
        val output = ByteArrayOutputStream()
        TransferApiClient.readExactly(ByteArrayInputStream(source), 32, output) {}
    }
}
