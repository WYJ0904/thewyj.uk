package uk.thewyj.app.task21.store

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

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
    ],
    version = NotificationDatabase.SCHEMA_VERSION,
    exportSchema = true,
)
abstract class NotificationDatabase : RoomDatabase() {
    abstract fun notificationDao(): NotificationDao

    companion object {
        const val SCHEMA_VERSION = 1
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
                    .fallbackToDestructiveMigrationOnDowngrade(false)
                    .build()
                    .also { instance = it }
            }
    }
}
