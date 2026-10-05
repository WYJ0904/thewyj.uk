package uk.thewyj.app.core.web

import org.junit.Assert.assertEquals
import org.junit.Test

class WebFileSelectionTest {
    @Test fun multipleSafFilesRetainProviderUrisAndOrder() {
        val clip = listOf(
            "content://downloads/document/first%2Ffile.bin",
            "content://downloads/document/second.txt",
            "content://downloads/document/third.png",
        )
        assertEquals(clip, chooseWebFileUris(clip, listOf(clip.first())))
    }

    @Test fun singleSelectionUsesExistingParserFallback() {
        val parsed = listOf("content://downloads/document/single.txt")
        assertEquals(parsed, chooseWebFileUris(emptyList(), parsed))
        assertEquals(emptyList<String>(), chooseWebFileUris(emptyList(), emptyList()))
    }

    @Test fun remoteAndFilesystemUrisCannotEnterTrustedFileInput() {
        val clip = listOf("https://example.com/file", "file:///data/private", "content://downloads/allowed")
        assertEquals(listOf(clip.last()), chooseWebFileUris(clip, emptyList()))
        assertEquals(emptyList<String>(), chooseWebFileUris(listOf("file:///private"), listOf("content://ignored")))
    }
}
