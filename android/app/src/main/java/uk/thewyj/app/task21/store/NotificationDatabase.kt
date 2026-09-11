package uk.thewyj.app.task21.store

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Local-only notification storage. The database lives in the app's private
 * storage, is account-scoped by column, and is never uploaded: only the
 * minimised structured finance evidence leaves the device.
 */
@Database(
    entities = [
        NotificationInstanceEntity::class,
        NotificationRevisionEntity::class,
        NotificationAppPolicyEntity::class,
        NotificationRuleEntity::class,
        NotificationSettingsEntity::class,
        PaymentRecognitionEntity::class,
        PaymentTicketEntity::class,
        PaymentCandidateEntity::class,
    ],
    version = NotificationDatabase.SCHEMA_VERSION,
    exportSchema = true,
)
abstract class NotificationDatabase : RoomDatabase() {
    abstract fun notificationDao(): NotificationDao
    abstract fun paymentDao(): PaymentDao

    companion object {
        const val SCHEMA_VERSION = 5
        const val DATABASE_NAME = "wyj-notifications.db"

        @Volatile
        private var instance: NotificationDatabase? = null

        fun get(context: Context): NotificationDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    NotificationDatabase::class.java,
                    DATABASE_NAME,
                )
                    // The local archive is user data: never drop it on upgrade.
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
                    .fallbackToDestructiveMigrationOnDowngrade(false)
                    .build()
                    .also { instance = it }
            }

        /**
         * v1 -> v2 adds the payment recognition tables. Existing notification
         * history, app policies, rules and settings are untouched.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                PAYMENT_V2_DDL.forEach { statement -> db.execSQL(statement) }
            }
        }

        /**
         * v2 -> v3 records which structured-event identity a payment recognition
         * was uploaded under. Blank means the payment hint is local-only (the
         * amount was unknown at capture time), so this device owns the booking.
         * Notification history, tickets and candidates are untouched.
         */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "ALTER TABLE `payment_recognitions` ADD COLUMN `uploadEventId` TEXT NOT NULL DEFAULT ''",
                )
            }
        }

        /**
         * v3 -> v4 adds the notification favourite flag used by retention
         * ("收藏的通知不自动删除"). Existing history is untouched.
         */
        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `notification_instances` ADD COLUMN `pinned` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `notification_instances` ADD COLUMN `pinnedAt` INTEGER NOT NULL DEFAULT 0")
            }
        }

        /**
         * v4 -> v5 stores the picture Android already exposed on a notification
         * (screenshot thumbnail / BigPictureStyle / large icon) as a local file
         * reference. Existing history is untouched; mediaState records
         * "unavailable" when an image notification could not be read.
         */
        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `notification_revisions` ADD COLUMN `mediaPath` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `notification_revisions` ADD COLUMN `mediaMime` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `notification_revisions` ADD COLUMN `mediaState` TEXT NOT NULL DEFAULT 'none'")
            }
        }

        internal val PAYMENT_V2_DDL = listOf(
            """
            CREATE TABLE IF NOT EXISTS `payment_recognitions` (
                `recognitionId` TEXT NOT NULL, `accountId` TEXT NOT NULL, `state` TEXT NOT NULL,
                `notificationId` INTEGER NOT NULL, `sourcePackage` TEXT NOT NULL, `sourceType` TEXT NOT NULL,
                `sourceEventId` TEXT NOT NULL, `paymentChannel` TEXT NOT NULL, `amountMinor` INTEGER NOT NULL,
                `hasAmount` INTEGER NOT NULL, `currency` TEXT NOT NULL, `direction` TEXT NOT NULL,
                `merchant` TEXT NOT NULL, `providerReference` TEXT NOT NULL, `createdAtMs` INTEGER NOT NULL,
                `updatedAtMs` INTEGER NOT NULL, PRIMARY KEY(`recognitionId`)
            )
            """.trimIndent(),
            "CREATE INDEX IF NOT EXISTS `index_payment_recognitions_accountId_updatedAtMs` ON `payment_recognitions` (`accountId`, `updatedAtMs`)",
            "CREATE INDEX IF NOT EXISTS `index_payment_recognitions_accountId_sourceEventId` ON `payment_recognitions` (`accountId`, `sourceEventId`)",
            """
            CREATE TABLE IF NOT EXISTS `payment_tickets` (
                `ticketId` TEXT NOT NULL, `accountId` TEXT NOT NULL, `recognitionId` TEXT NOT NULL,
                `sourcePackage` TEXT NOT NULL, `sourceEventId` TEXT NOT NULL, `paymentChannel` TEXT NOT NULL,
                `amountHintMinor` INTEGER NOT NULL, `hasAmountHint` INTEGER NOT NULL, `missingFields` TEXT NOT NULL,
                `state` TEXT NOT NULL, `attempts` INTEGER NOT NULL, `createdAtMs` INTEGER NOT NULL,
                `expiresAtMs` INTEGER NOT NULL, `enrichedAmountMinor` INTEGER NOT NULL,
                `hasEnrichedAmount` INTEGER NOT NULL, `enrichedDirection` TEXT NOT NULL,
                `enrichedMerchant` TEXT NOT NULL, `enrichedProviderReference` TEXT NOT NULL,
                `enrichedAtMs` INTEGER NOT NULL, PRIMARY KEY(`ticketId`)
            )
            """.trimIndent(),
            "CREATE INDEX IF NOT EXISTS `index_payment_tickets_accountId_state` ON `payment_tickets` (`accountId`, `state`)",
            "CREATE INDEX IF NOT EXISTS `index_payment_tickets_recognitionId` ON `payment_tickets` (`recognitionId`)",
            "CREATE INDEX IF NOT EXISTS `index_payment_tickets_accountId_sourcePackage_state` ON `payment_tickets` (`accountId`, `sourcePackage`, `state`)",
            """
            CREATE TABLE IF NOT EXISTS `payment_candidates` (
                `candidateId` TEXT NOT NULL, `accountId` TEXT NOT NULL, `recognitionId` TEXT NOT NULL,
                `status` TEXT NOT NULL, `amountMinor` INTEGER NOT NULL, `hasAmount` INTEGER NOT NULL,
                `direction` TEXT NOT NULL, `category` TEXT NOT NULL, `merchant` TEXT NOT NULL,
                `occurredAtMs` INTEGER NOT NULL, `channel` TEXT NOT NULL, `confidence` INTEGER NOT NULL,
                `reason` TEXT NOT NULL, `editedAmountMinor` INTEGER NOT NULL, `hasEditedAmount` INTEGER NOT NULL,
                `editedDirection` TEXT NOT NULL, `editedCategory` TEXT NOT NULL, `editedMerchant` TEXT NOT NULL,
                `editedOccurredAtMs` INTEGER NOT NULL, `hasEditedOccurredAt` INTEGER NOT NULL,
                `editedNote` TEXT NOT NULL, `financeTransactionId` TEXT NOT NULL, `createdAtMs` INTEGER NOT NULL,
                `updatedAtMs` INTEGER NOT NULL, PRIMARY KEY(`candidateId`)
            )
            """.trimIndent(),
            "CREATE INDEX IF NOT EXISTS `index_payment_candidates_accountId_status_createdAtMs` ON `payment_candidates` (`accountId`, `status`, `createdAtMs`)",
            "CREATE INDEX IF NOT EXISTS `index_payment_candidates_recognitionId` ON `payment_candidates` (`recognitionId`)",
        )
    }
}
