package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Task 24.1 Notification Classification Layer.
 *
 * Real device: `com.github.metacubex.clash.meta` reposts a status notification
 * every second, which used to commit a Room revision (and therefore a UI
 * refresh) every time. Ongoing / progress / live readouts must not enter the
 * archive, while a chat message whose text really changed must.
 */
class NotificationClassificationTest {
    @Test fun ongoingFlagIsNeverArchived() {
        val decision = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.example.music",
                title = "正在播放",
                text = "歌曲 A",
                isOngoing = true,
            ),
        )
        assertFalse(decision.storeInArchive)
        assertEquals(NotificationClass.ONGOING, decision.kind)
    }

    @Test fun foregroundServiceStatusIsNeverArchived() {
        val decision = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.example.sync",
                title = "同步中",
                text = "正在同步 12 项",
                isForegroundService = true,
            ),
        )
        assertFalse(decision.storeInArchive)
    }

    @Test fun clashTrafficReadoutIsFilteredByPackageAndChannel() {
        val byPackage = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.github.metacubex.clash.meta",
                channelId = "clash_status_channel",
                title = "Clash Meta for Android",
                text = "35 Bytes/s ↑ 670 Bytes/s ↓",
            ),
        )
        assertFalse(byPackage.storeInArchive)

        val byChannel = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.example.vpnclient",
                channelId = "vpn_status",
                title = "VPN",
                text = "已连接",
            ),
        )
        assertFalse(byChannel.storeInArchive)
    }

    @Test fun downloadProgressIsFiltered() {
        val decision = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.example.downloader",
                title = "正在下载",
                text = "下载中 42%",
            ),
        )
        assertFalse(decision.storeInArchive)
        assertEquals(NotificationClass.PROGRESS, decision.kind)
    }

    @Test fun normalMessageIsArchived() {
        val decision = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.tencent.mm",
                channelId = "chat",
                title = "张三",
                text = "晚上一起吃饭吗",
                identityKey = "key:wechat:1",
                occurredAtMs = 1_000L,
            ),
        )
        assertTrue(decision.storeInArchive)
        assertEquals(NotificationClass.MESSAGE, decision.kind)
    }

    @Test fun groupSummaryIsArchived() {
        val decision = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.tencent.mm",
                title = "微信",
                text = "3 条新消息",
                isGroupSummary = true,
            ),
        )
        assertTrue(decision.storeInArchive)
        assertEquals(NotificationClass.GROUP_SUMMARY, decision.kind)
    }

    /**
     * Second layer for apps that never set the ongoing flag: the same identity
     * repeating the same text with only new numbers is a live readout, but the
     * first capture is kept and any real text change is always kept.
     */
    @Test fun numericOnlyChurnIsCoalescedButRealTextChangesAreKept() {
        val coalescer = NotificationLiveCoalescer(windowMs = 120_000L)
        assertFalse(coalescer.isNumericChurn("key:1", "Clash", "↓ 12.8 MB/s", 1_000L))
        assertFalse(coalescer.isNumericChurn("key:1", "Clash", "↓ 14.2 MB/s", 2_000L))
        assertFalse(coalescer.isNumericChurn("key:1", "Clash", "↓ 9.6 MB/s", 3_000L))
        assertFalse(coalescer.isNumericChurn("key:1", "Clash", "↓ 8.1 MB/s", 4_000L))
        // The fifth fast repeat is a readout, not a message.
        assertTrue(coalescer.isNumericChurn("key:1", "Clash", "↓ 7.2 MB/s", 5_000L))
        assertTrue(coalescer.isNumericChurn("key:1", "Clash", "↓ 6.4 MB/s", 6_000L))
        // A quiet window gives the identity a fresh chance to be archived.
        assertFalse(coalescer.isNumericChurn("key:1", "Clash", "↓ 6.1 MB/s", 200_000L))

        // Chat text that really changed is never churn, even with the same id.
        assertFalse(coalescer.isNumericChurn("key:wechat", "张三", "A", 1_000L))
        assertFalse(coalescer.isNumericChurn("key:wechat", "张三", "B", 2_000L))
        assertFalse(coalescer.isNumericChurn("key:wechat", "张三", "C", 3_000L))

        // Slow repeats (transfer receipts minutes apart) are always kept.
        assertFalse(coalescer.isNumericChurn("key:receipt", "转账", "已收款 ¥10.00", 1_000L))
        assertFalse(coalescer.isNumericChurn("key:receipt", "转账", "已收款 ¥20.00", 60_000L))
        assertFalse(coalescer.isNumericChurn("key:receipt", "转账", "已收款 ¥30.00", 120_000L))
        assertFalse(coalescer.isNumericChurn("key:receipt", "转账", "已收款 ¥40.00", 180_000L))
    }

    /**
     * Task 24 reopen #5: a recording timer is reposted every second without the
     * ongoing flag. The first post is a normal archive entry; every later tick is
     * the same notification, so the archive updates that row in place instead of
     * appending one entry per second.
     */
    @Test fun recordingTimerUpdatesOneRowInsteadOfAppending() {
        val first = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.samsung.android.app.screenrecorder",
                channelId = "recording",
                title = "屏幕录制",
                text = "录屏中 00:01",
                identityKey = "key:recorder:1",
                occurredAtMs = 1_000L,
            ),
        )
        assertTrue(first.storeInArchive)
        assertFalse("the first tick opens the entry", first.coalesceWithPrevious)
        assertEquals(NotificationClass.MESSAGE, first.kind)

        val second = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.samsung.android.app.screenrecorder",
                channelId = "recording",
                title = "屏幕录制",
                text = "录屏中 00:02",
                identityKey = "key:recorder:1",
                occurredAtMs = 2_000L,
            ),
        )
        assertTrue("the tick is still archived", second.storeInArchive)
        assertFalse("two posts one second apart are still two snapshots", second.coalesceWithPrevious)

        val third = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.samsung.android.app.screenrecorder",
                channelId = "recording",
                title = "屏幕录制",
                text = "录屏中 00:03",
                identityKey = "key:recorder:1",
                occurredAtMs = 3_000L,
            ),
        )
        assertTrue("the ticker now updates the existing row", third.coalesceWithPrevious)

        // A real content change (recording finished) is a new snapshot.
        val finished = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.samsung.android.app.screenrecorder",
                channelId = "recording",
                title = "屏幕录制",
                text = "录屏已保存",
                identityKey = "key:recorder:1",
                occurredAtMs = 4_000L,
            ),
        )
        assertTrue(finished.storeInArchive)
        assertFalse(finished.coalesceWithPrevious)
    }

    /**
     * Two identical real messages are two messages. They are only merged when
     * they arrive as one continuous readout (seconds apart on the same identity).
     */
    @Test fun identicalMessagesFarApartAreNeverMerged() {
        val first = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.tencent.mm",
                channelId = "chat",
                title = "老周横眉",
                text = "已支付100",
                identityKey = "key:wechat:9",
                occurredAtMs = 10_000L,
            ),
        )
        assertFalse(first.coalesceWithPrevious)

        val later = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.tencent.mm",
                channelId = "chat",
                title = "老周横眉",
                text = "已支付100",
                identityKey = "key:wechat:9",
                occurredAtMs = 90_000L,
            ),
        )
        assertTrue(later.storeInArchive)
        assertFalse("a real repeat keeps its own snapshot", later.coalesceWithPrevious)
    }

    /** Without a real Android identity there is nothing to coalesce. */
    @Test fun legacyCaptureWithoutIdentityIsNeverCoalesced() {
        val decision = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.example.recorder",
                title = "屏幕录制",
                text = "录屏中 00:01",
            ),
        )
        assertTrue(decision.storeInArchive)
        assertFalse(decision.coalesceWithPrevious)
    }

    /**
     * Real-device shape: the same WeChat notification id posts three receipts one
     * second apart. They share one digit-normalized shape, but each one is a real
     * ledger event and must keep its own snapshot.
     */
    @Test fun repeatedPaymentReceiptsAreNeverMerged() {
        val receipts = listOf(
            10_000L to "已收款 ¥10.00",
            11_000L to "已收款 ¥20.00",
            12_000L to "已收款 ¥30.00",
        )
        val decisions = receipts.map { (at, text) ->
            NotificationClassifier.classify(
                NotificationClassificationInput(
                    sourcePackage = "com.tencent.mm",
                    channelId = "chat",
                    title = "转账",
                    text = text,
                    identityKey = "key:receipts:1",
                    occurredAtMs = at,
                ),
            )
        }
        assertTrue(decisions.all { it.storeInArchive })
        assertFalse(
            "money-carrying captures always keep their own snapshot",
            decisions.any { it.coalesceWithPrevious },
        )
    }
}
