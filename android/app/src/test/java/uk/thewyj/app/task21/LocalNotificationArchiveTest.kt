package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class LocalNotificationArchiveTest {
    private fun record(id: String, fingerprint: String) = LocalNotificationRecord(
        id = id, eventId = id, fingerprint = fingerprint, sourcePackage = "com.tencent.mm",
        title = "付款", text = "支付成功 ￥1.00", bigText = "", subText = "",
        receivedAtMs = 1_700_000_000_000L, parseStatus = ParseStatus.PARSED,
        direction = FinanceDirection.EXPENSE, amountMinor = 100, currency = "CNY",
        merchant = "示例商户", confidence = 950,
    )

    private fun recordWith(id: String, fingerprint: String, title: String, text: String) =
        record(id, fingerprint).copy(title = title, text = text)

    @Test fun dedupesByFingerprintAndPersistsAcrossInstances() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = LocalNotificationArchive.inDirectory(dir, "account-a")
            assertTrue(store.append(record("id-1", "fingerprint-a")))
            val archiveFile = File(dir, "notification-archive").listFiles()!!.single()
            assertTrue("fsync must not truncate the archive", archiveFile.length() > 0L)
            assertTrue(archiveFile.readText(Charsets.UTF_8).contains(LocalNotificationArchive.ARCHIVE_VERSION_LINE))
            assertFalse(store.append(record("id-2", "fingerprint-a")))
            assertEquals(1, store.listRecent(10).size)

            val reloaded = LocalNotificationArchive.inDirectory(dir, "account-a")
            assertEquals(1, reloaded.listRecent(10).size)
            assertEquals("id-1", reloaded.listRecent(10).first().id)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun clearForAccountRemovesLocalRecords() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = LocalNotificationArchive.inDirectory(dir, "account-a")
            store.append(record("id-1", "fingerprint-a"))
            store.clearForAccount("account-a")
            assertTrue(store.listRecent(10).isEmpty())
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun unicodeAndLargeNotificationSurvivesRoundTrip() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = LocalNotificationArchive.inDirectory(dir, "account-a")
            val largeText = "微信支付到账通知 💰 测试汉字与emoji：😀😃😄😁 金额￥128.00（大写壹佰贰拾捌元整）".repeat(400)
            store.append(recordWith("id-unicode", "fingerprint-unicode", "退款到账 ✅", largeText))
            val loaded = store.listRecent(10).single()
            assertEquals("退款到账 ✅", loaded.title)
            assertEquals(largeText, loaded.text)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun malformedAndPartialLinesAreSkippedWithoutLosingValidRecords() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = LocalNotificationArchive.inDirectory(dir, "account-a")
            store.append(record("id-valid", "fingerprint-valid"))
            val archiveFile = File(dir, "notification-archive").listFiles()!!.single()
            val valid = archiveFile.readText(Charsets.UTF_8)
            archiveFile.writeText(
                valid +
                    "!!!corrupt-line!!!\n" +
                    "not-base64-at-all\n" +
                    "cGFydGlhbC1yZWNvcmQ=\n",
                Charsets.UTF_8,
            )
            val loaded = LocalNotificationArchive.inDirectory(dir, "account-a").listRecent(10)
            assertEquals(1, loaded.size)
            assertEquals("id-valid", loaded.single().id)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun retentionIsBoundedToNewestRecords() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = LocalNotificationArchive.inDirectory(dir, "account-a")
            repeat(LocalNotificationArchive.MAX_ARCHIVE_RECORDS + 25) { index ->
                store.append(record("id-$index", "fingerprint-$index"))
            }
            val loaded = store.listRecent(Int.MAX_VALUE)
            assertEquals(LocalNotificationArchive.MAX_ARCHIVE_RECORDS, loaded.size)
            assertFalse(loaded.any { it.id == "id-0" })
            assertTrue(loaded.any { it.id == "id-${LocalNotificationArchive.MAX_ARCHIVE_RECORDS + 24}" })
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun accountsAreIsolatedByFile() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val storeA = LocalNotificationArchive.inDirectory(dir, "account-a")
            val storeB = LocalNotificationArchive.inDirectory(dir, "account-b")
            storeA.append(record("id-a", "fingerprint-a"))
            storeA.append(recordWith("id-secret-a", "fingerprint-a-2", "账户A", "只有A可见的正文"))
            storeB.append(recordWith("id-secret-b", "fingerprint-b", "账户B", "只有B可见的正文"))

            val listA = storeA.listRecent(10)
            val listB = storeB.listRecent(10)
            assertEquals(2, listA.size)
            assertEquals(1, listB.size)
            assertFalse(listA.any { it.id == "id-secret-b" })
            assertFalse(listB.any { it.id == "id-secret-a" })

            storeA.clearForAccount("account-a")
            assertTrue(storeA.listRecent(10).isEmpty())
            assertEquals(1, storeB.listRecent(10).size)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun deleteRemovesOnlyTheTargetRecord() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = LocalNotificationArchive.inDirectory(dir, "account-a")
            store.append(record("id-1", "fingerprint-1"))
            store.append(record("id-2", "fingerprint-2"))
            assertTrue(store.delete("id-1"))
            assertEquals(listOf("id-2"), store.listRecent(10).map { it.id })
            assertFalse(store.delete("id-missing"))
        } finally {
            dir.deleteRecursively()
        }
    }
}
