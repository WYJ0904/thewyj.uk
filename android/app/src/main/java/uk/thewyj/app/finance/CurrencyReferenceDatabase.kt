package uk.thewyj.app.finance

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

/** A reference cache, never a second ledger. Original notification ledger upgrades additively to v15. */
@Entity(tableName = "fx_rates")
data class CachedCurrencyRate(@PrimaryKey val id: String, val snapshotJson: String)
@Entity(tableName = "fx_references", primaryKeys = ["accountId", "transactionId", "revision", "quote"],
    foreignKeys = [ForeignKey(entity = CachedCurrencyRate::class, parentColumns = ["id"], childColumns = ["rateId"], onDelete = ForeignKey.NO_ACTION)],
    indices = [Index("rateId")])
data class CachedCurrencyReference(val accountId: String, val transactionId: String, val revision: Long, val quote: String,
    val rateId: String, val originalCurrency: String, val originalMinor: Long, val convertedMinor: Long)
@Entity(tableName = "currency_preferences")
data class CachedCurrencyPreferences(@PrimaryKey val accountId: String, val accountCurrency: String, val displayCurrency: String,
    val defaultCurrency: String?, val revision: Long)
@Entity(tableName = "currency_role_evidence", primaryKeys = ["accountId", "sourceEventId"])
data class CachedCurrencyRoles(val accountId: String, val sourceEventId: String, val rolesJson: String, val capturedAtMs: Long)
@Entity(tableName = "manual_currency_decisions", primaryKeys = ["accountId", "recognitionId"])
data class ManualCurrencyDecision(val accountId: String, val recognitionId: String, val currency: String, val confirmedAtMs: Long)
@Entity(tableName = "source_currency_units", primaryKeys = ["accountId", "sourceEventId"])
data class CachedSourceCurrencyUnit(val accountId: String, val sourceEventId: String, val currency: String, val amountExponent: Int)
@Dao
interface CurrencyReferenceDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE) fun putSourceUnit(unit: CachedSourceCurrencyUnit)
    @Query("SELECT * FROM source_currency_units WHERE accountId=:account AND sourceEventId=:source")
    fun sourceUnit(account: String, source: String): CachedSourceCurrencyUnit?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putCurrencyDecision(decision: ManualCurrencyDecision)
    @Query("SELECT * FROM manual_currency_decisions WHERE accountId=:account AND recognitionId=:id")
    fun currencyDecision(account: String, id: String): ManualCurrencyDecision?
    @Insert(onConflict = OnConflictStrategy.IGNORE) fun putRate(rate: CachedCurrencyRate): Long
    @Insert(onConflict = OnConflictStrategy.IGNORE) fun putReference(reference: CachedCurrencyReference): Long
    @Query("SELECT * FROM fx_rates WHERE id=:id") fun rate(id: String): CachedCurrencyRate?
    @Query("SELECT * FROM fx_references WHERE accountId=:account AND transactionId=:id AND revision=:revision AND quote=:quote")
    fun reference(account: String, id: String, revision: Long, quote: String): CachedCurrencyReference?
    @Query("SELECT * FROM fx_references WHERE accountId=:account ORDER BY transactionId,revision LIMIT 1000")
    fun references(account: String): List<CachedCurrencyReference>
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putPreferences(preferences: CachedCurrencyPreferences)
    @Query("SELECT * FROM currency_preferences WHERE accountId=:account") fun preferences(account: String): CachedCurrencyPreferences?
    @Insert(onConflict = OnConflictStrategy.IGNORE) fun putRoles(roles: CachedCurrencyRoles): Long
    @Query("SELECT * FROM currency_role_evidence WHERE accountId=:account AND sourceEventId=:id") fun roles(account: String, id: String): CachedCurrencyRoles?
}
@Database(entities = [CachedCurrencyRate::class, CachedCurrencyReference::class, CachedCurrencyPreferences::class, CachedCurrencyRoles::class, ManualCurrencyDecision::class, CachedSourceCurrencyUnit::class], version = 1, exportSchema = true)
abstract class CurrencyReferenceDatabase : RoomDatabase() {
    abstract fun currencies(): CurrencyReferenceDao
    companion object {
        @Volatile private var instance: CurrencyReferenceDatabase? = null
        fun get(context: Context): CurrencyReferenceDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, CurrencyReferenceDatabase::class.java, "wyj-currency-reference.db")
                .build().also { instance = it }
        }
    }
}
