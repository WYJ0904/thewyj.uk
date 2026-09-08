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

    @Test fun dedupesByFingerprintAndPersistsAcrossInstances() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = LocalNotificationArchive.inDirectory(dir, "account-a")
            assertTrue(store.append(record("id-1", "fingerprint-a")))
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
}

