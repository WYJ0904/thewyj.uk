package uk.thewyj.app.core.web

import org.junit.Assert.assertEquals
import org.junit.Test

class ThewyjDownloadNameTest {
    @Test
    fun prefersUtf8FilenameOverAsciiFallback() {
        assertEquals(
            "测试文件 中文 日本語 2026.pdf",
            downloadName(
                "https://thewyj.uk/api/transfer/shares/share-id/download?file=file-id&grant=token",
                "attachment; filename=\"download.pdf\"; filename*=UTF-8''%E6%B5%8B%E8%AF%95%E6%96%87%E4%BB%B6%20%E4%B8%AD%E6%96%87%20%E6%97%A5%E6%9C%AC%E8%AA%9E%202026.pdf",
            ),
        )
    }

    @Test
    fun keepsExecutableExtensionAndNeutralizesPathSeparators() {
        assertEquals(
            "setup.exe",
            downloadName("https://thewyj.uk/download?grant=token", "attachment; filename=\"setup.exe\""),
        )
        assertEquals(
            "nested_name.zip",
            downloadName("https://thewyj.uk/download?grant=token", "attachment; filename*=UTF-8''nested%2Fname.zip"),
        )
    }
}
