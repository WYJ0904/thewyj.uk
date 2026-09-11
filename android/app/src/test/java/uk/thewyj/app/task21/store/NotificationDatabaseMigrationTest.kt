package uk.thewyj.app.task21.store

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.util.UUID

/**
 * Schema v1 -> v2 migration test. It rebuilds a real v1 database from the
 * exported schema (including the Room identity hash), inserts user data, then
 * opens it through Room with MIGRATION_1_2 and verifies that:
 *  - notification history, policies, rules and settings are preserved;
 *  - the new payment tables exist and are usable.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationDatabaseMigrationTest {
    private lateinit var context: Context
    private lateinit var databaseFile: File
    private var database: NotificationDatabase? = null

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        databaseFile = File(context.cacheDir, "migration-${UUID.randomUUID()}.db")
    }

    @After fun tearDown() {
        database?.close()
        databaseFile.delete()
    }

    @Test fun migrationFromV1KeepsNotificationDataAndAddsPaymentTables() {
        val schema = loadV1Schema()
        createV1Database(schema)

        database = Room.databaseBuilder(context, NotificationDatabase::class.java, databaseFile.absolutePath)
            .addMigrations(
                NotificationDatabase.MIGRATION_1_2,
                NotificationDatabase.MIGRATION_2_3,
                NotificationDatabase.MIGRATION_3_4,
                NotificationDatabase.MIGRATION_4_5,
            )
            .allowMainThreadQueries()
            .build()
        val notificationStore = RoomNotificationStore(database!!)
        val paymentStore = RoomPaymentRecognitionStore(database!!)

        // v1 data survived.
        val history = notificationStore.history("account-a", NotificationQuery())
        assertEquals(1, history.size)
        assertEquals("微信支付", history.first().title)
        assertEquals("访问前不可丢失", notificationStore.settings("account-a")?.legacyMigrationState)
        assertEquals(1, notificationStore.appPolicies("account-a").size)
        assertEquals(1, notificationStore.rules("account-a").size)

        // The v2 payment tables are present and usable.
        paymentStore.saveTicket(
            uk.thewyj.app.task21.payment.PaymentTicket(
                ticketId = "ticket-1",
                accountId = "account-a",
                recognitionId = "rec-1",
                sourcePackage = "com.tencent.mm",
                sourceEventId = "notification#k#1",
                paymentChannel = "wechat",
                amountHintMinor = null,
                missingFields = setOf("amount"),
                createdAtMs = 1_000L,
                expiresAtMs = 91_000L,
                state = uk.thewyj.app.task21.payment.PaymentTicketState.WAITING_FOR_ACCESSIBILITY,
            ),
        )
        assertEquals(1, paymentStore.ticketsForRecognition("account-a", "rec-1").size)
        assertEquals(
            "amount",
            paymentStore.ticketsForRecognition("account-a", "rec-1").first().missingFields.first(),
        )
        assertNotNull(database!!.openHelper.writableDatabase)
        assertTrue(databaseFile.length() > 0)
    }

    private fun loadV1Schema(): JSONObject {
        val file = File("schemas/uk.thewyj.app.task21.store.NotificationDatabase/1.json")
        if (!file.exists()) {
            error("exported v1 schema missing at ${file.absolutePath}")
        }
        return JSONObject(file.readText()).getJSONObject("database")
    }

    /**
     * v2 -> v3 adds `payment_recognitions.uploadEventId`, which records whether
     * a recognised payment was uploaded (server owns the booking) or stayed
     * local (the device books it after verification). Existing recognitions,
     * tickets, candidates and notification history must survive.
     */
    @Test fun migrationFromV2AddsUploadIdentityAndKeepsPaymentData() {
        val schema = loadSchema(2)
        createDatabaseFromSchema(schema, version = 2)
        insertV2PaymentRows()

        database = Room.databaseBuilder(context, NotificationDatabase::class.java, databaseFile.absolutePath)
            .addMigrations(
                NotificationDatabase.MIGRATION_1_2,
                NotificationDatabase.MIGRATION_2_3,
                NotificationDatabase.MIGRATION_3_4,
                NotificationDatabase.MIGRATION_4_5,
            )
            .allowMainThreadQueries()
            .build()
        val store = RoomPaymentRecognitionStore(database!!)

        val recognition = store.recognition("account-a", "rec-2")
        assertNotNull("v2 recognition must survive the v3 migration", recognition)
        assertEquals("", recognition!!.uploadEventId)
        assertEquals(2800L, recognition.amountMinor)
        assertEquals("WAITING_FOR_ENRICHMENT", recognition.state)
        assertEquals(1, store.ticketsForRecognition("account-a", "rec-2").size)
        assertEquals(1, store.pendingCandidateCount("account-a"))

        // The new column is writable through the normal store API.
        store.saveRecognition(recognition.copy(uploadEventId = "evt-uploaded-2"))
        assertEquals("evt-uploaded-2", store.recognition("account-a", "rec-2")?.uploadEventId)
    }

    /**
     * v3 -> v4 adds the notification favourite flag used by retention
     * ("收藏的通知不自动删除"). History must survive and the new columns must be
     * usable through the normal store API.
     */
    @Test fun migrationFromV3AddsFavouriteFlagAndKeepsHistory() {
        val schema = loadSchema(3)
        createDatabaseFromSchema(schema, version = 3)
        insertV3HistoryRow()

        database = Room.databaseBuilder(context, NotificationDatabase::class.java, databaseFile.absolutePath)
            .addMigrations(
                NotificationDatabase.MIGRATION_1_2,
                NotificationDatabase.MIGRATION_2_3,
                NotificationDatabase.MIGRATION_3_4,
                NotificationDatabase.MIGRATION_4_5,
            )
            .allowMainThreadQueries()
            .build()
        val store = RoomNotificationStore(database!!)

        val history = store.history("account-a", NotificationQuery())
        assertEquals(1, history.size)
        assertEquals("微信支付", history.first().title)
        assertEquals(false, history.first().pinned)
        assertEquals(0, store.pinnedCount("account-a"))

        assertTrue(store.setPinned("account-a", history.first().instanceId, pinned = true))
        assertEquals(1, store.pinnedCount("account-a"))
        assertEquals(true, store.history("account-a", NotificationQuery()).first().pinned)

        // A favourite survives every retention period.
        assertEquals(0, store.purgeExpired("account-a", System.currentTimeMillis() + 1))
        assertTrue(store.setPinned("account-a", history.first().instanceId, pinned = false))
        assertEquals(1, store.purgeExpired("account-a", System.currentTimeMillis() + 1))
    }

    private fun insertV3HistoryRow() {
        val sqlite = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
        sqlite.execSQL(
            "INSERT INTO notification_instances (instanceId, accountId, identityKey, sourcePackage, sourceType, " +
                "notificationKey, notificationId, tag, groupKey, channelId, postTime, firstSeenAt, lastSeenAt, " +
                "removedAt, status, revisionCount, latestRevisionId, isGroup, isGroupSummary, financeLinked) VALUES " +
                "('inst-3', 'account-a', 'key:k3', 'com.tencent.mm', 'notification', 'k3', 3, '', '', 'chat', 1000, " +
                "1000, 1000, 0, 'active', 1, 'rev-3', 0, 0, 0)",
        )
        sqlite.execSQL(
            "INSERT INTO notification_revisions (revisionId, instanceId, accountId, title, text, bigText, subText, " +
                "infoText, summaryText, textLines, contentHash, capturedAt, parseStatus, direction, amountMinor, " +
                "currency, merchant, confidence) VALUES ('rev-3', 'inst-3', 'account-a', '微信支付', '已支付 ￥28.00', " +
                "'', '', '', '', '', 'hash-3', 1000, 'PARSED', 'EXPENSE', 2800, 'CNY', '', 900)",
        )
        sqlite.close()
    }

    private fun loadSchema(version: Int): JSONObject {
        val file = File("schemas/uk.thewyj.app.task21.store.NotificationDatabase/$version.json")
        if (!file.exists()) error("exported v$version schema missing at ${file.absolutePath}")
        return JSONObject(file.readText()).getJSONObject("database")
    }

    private fun createDatabaseFromSchema(schema: JSONObject, version: Int) {
        val sqlite = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
        val entities = schema.getJSONArray("entities")
        for (index in 0 until entities.length()) {
            val entity = entities.getJSONObject(index)
            sqlite.execSQL(entity.getString("createSql").replace("${'$'}{TABLE_NAME}", entity.getString("tableName")))
            val indices = entity.optJSONArray("indices") ?: continue
            for (indexIndex in 0 until indices.length()) {
                val indexJson = indices.getJSONObject(indexIndex)
                sqlite.execSQL(indexJson.getString("createSql").replace("${'$'}{TABLE_NAME}", entity.getString("tableName")))
            }
        }
        sqlite.execSQL("CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY, identity_hash TEXT)")
        sqlite.execSQL(
            "INSERT OR REPLACE INTO room_master_table (id, identity_hash) VALUES (42, ?)",
            arrayOf(schema.getString("identityHash")),
        )
        sqlite.version = version
        sqlite.close()
    }

    private fun insertV2PaymentRows() {
        val sqlite = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
        sqlite.execSQL(
            "INSERT INTO payment_recognitions (recognitionId, accountId, state, notificationId, sourcePackage, " +
                "sourceType, sourceEventId, paymentChannel, amountMinor, hasAmount, currency, direction, merchant, " +
                "providerReference, createdAtMs, updatedAtMs) VALUES ('rec-2', 'account-a', 'WAITING_FOR_ENRICHMENT', 7, " +
                "'com.tencent.mm', 'NOTIFICATION', 'notification#k#2', 'wechat', 2800, 1, 'CNY', 'EXPENSE', '示例商户', '', 2000, 2000)",
        )
        sqlite.execSQL(
            "INSERT INTO payment_tickets (ticketId, accountId, recognitionId, sourcePackage, sourceEventId, " +
                "paymentChannel, amountHintMinor, hasAmountHint, missingFields, state, attempts, createdAtMs, " +
                "expiresAtMs, enrichedAmountMinor, hasEnrichedAmount, enrichedDirection, enrichedMerchant, " +
                "enrichedProviderReference, enrichedAtMs) VALUES ('ticket-2', 'account-a', 'rec-2', 'com.tencent.mm', " +
                "'notification#k#2', 'wechat', 0, 0, 'amount', 'WAITING_FOR_ACCESSIBILITY', 0, 2000, 92000, 0, 0, '', '', '', 0)",
        )
        sqlite.execSQL(
            "INSERT INTO payment_candidates (candidateId, accountId, recognitionId, status, amountMinor, hasAmount, " +
                "direction, category, merchant, occurredAtMs, channel, confidence, reason, editedAmountMinor, " +
                "hasEditedAmount, editedDirection, editedCategory, editedMerchant, editedOccurredAtMs, " +
                "hasEditedOccurredAt, editedNote, financeTransactionId, createdAtMs, updatedAtMs) VALUES " +
                "('cand-2', 'account-a', 'rec-2', 'pending', 2800, 1, 'EXPENSE', '', '示例商户', 2000, 'wechat', 940, '', " +
                "0, 0, '', '', '', 0, 0, '', '', 2000, 2000)",
        )
        sqlite.close()
    }

    private fun createV1Database(schema: JSONObject) {
        val sqlite = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
        val entities = schema.getJSONArray("entities")
        for (index in 0 until entities.length()) {
            val entity = entities.getJSONObject(index)
            sqlite.execSQL(entity.getString("createSql").replace("${'$'}{TABLE_NAME}", entity.getString("tableName")))
            val indices = entity.optJSONArray("indices") ?: continue
            for (indexIndex in 0 until indices.length()) {
                val indexJson = indices.getJSONObject(indexIndex)
                sqlite.execSQL(indexJson.getString("createSql").replace("${'$'}{TABLE_NAME}", entity.getString("tableName")))
            }
        }
        sqlite.execSQL("CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY, identity_hash TEXT)")
        sqlite.execSQL(
            "INSERT OR REPLACE INTO room_master_table (id, identity_hash) VALUES (42, ?)",
            arrayOf(schema.getString("identityHash")),
        )
        sqlite.execSQL(
            """
            INSERT INTO notification_instances (
                instanceId, accountId, identityKey, sourcePackage, sourceType, notificationKey, notificationId,
                tag, groupKey, channelId, postTime, firstSeenAt, lastSeenAt, removedAt, status, revisionCount,
                latestRevisionId, isGroup, isGroupSummary, financeLinked
            ) VALUES ('inst-1', 'account-a', 'key:k1', 'com.tencent.mm', 'notification', 'k1', 1, '', '', 'chat',
                1000, 1000, 1000, 0, 'active', 1, 'rev-1', 0, 0, 0)
            """.trimIndent(),
        )
        sqlite.execSQL(
            """
            INSERT INTO notification_revisions (
                revisionId, instanceId, accountId, title, text, bigText, subText, infoText, summaryText,
                textLines, contentHash, capturedAt, parseStatus, direction, amountMinor, currency, merchant, confidence
            ) VALUES ('rev-1', 'inst-1', 'account-a', '微信支付', '支付成功 ￥28.00', '', '', '', '', '',
                'hash-1', 1000, 'PARSED', 'EXPENSE', 2800, 'CNY', '', 900)
            """.trimIndent(),
        )
        sqlite.execSQL(
            "INSERT INTO notification_settings (accountId, retentionDays, legacyMigrationState, legacyImportedCount, updatedAt) " +
                "VALUES ('account-a', 30, '访问前不可丢失', 0, 1000)",
        )
        sqlite.execSQL(
            "INSERT INTO notification_app_policies (accountId, sourcePackage, enabled, updatedAt) VALUES ('account-a', 'com.tencent.mm', 1, 1000)",
        )
        sqlite.execSQL(
            "INSERT INTO notification_rules (ruleId, accountId, name, enabled, appScope, includeKeywords, excludeKeywords, matchAll, updatedAt) " +
                "VALUES ('rule-1', 'account-a', '支付', 1, '*', '支付', '营销', 0, 1000)",
        )
        sqlite.version = 1
        sqlite.close()
    }
}
