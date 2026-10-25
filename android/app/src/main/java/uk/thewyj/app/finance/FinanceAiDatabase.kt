package uk.thewyj.app.finance

import android.content.Context
import androidx.room.*

/** Optional assistance cache. It never owns or copies a financial ledger. */
@Entity(tableName="ai_observations",primaryKeys=["accountId","recognitionId"])
data class FinanceAiObservation(
    val accountId:String,val recognitionId:String,val eventId:String,
    val recordDigest:String,val inputDigest:String,val packetJson:String,val expiresAtMs:Long,
    val capturedAtMs:Long=0,
    val status:String="captured",val responseJson:String="",val updatedAtMs:Long,
)
@Entity(tableName="ai_account_state")
data class FinanceAiAccountState(@PrimaryKey val accountId:String,val available:Boolean,
    val consent:Boolean,val consentRevision:Long,val updatedAtMs:Long,val localRevokePending:Boolean=false,val modelVersion:String="")
@Entity(tableName="ai_audit")
data class FinanceAiAudit(@PrimaryKey val id:String,val accountId:String,val recognitionId:String,
    val eventId:String,val responseJson:String,val createdAtMs:Long)

@Dao
interface FinanceAiDao {
    @Insert(onConflict=OnConflictStrategy.REPLACE) fun put(row:FinanceAiObservation)
    @Query("SELECT * FROM ai_observations WHERE accountId=:account AND recognitionId=:recognition")
    fun observation(account:String,recognition:String):FinanceAiObservation?
    @Query("SELECT * FROM ai_observations WHERE accountId=:account AND status IN ('captured','waiting_sync','running') ORDER BY updatedAtMs LIMIT 30")
    fun pending(account:String):List<FinanceAiObservation>
    @Query("SELECT * FROM ai_observations WHERE accountId=:account ORDER BY updatedAtMs DESC LIMIT 300")
    fun observations(account:String):List<FinanceAiObservation>
    @Query("UPDATE ai_observations SET status=:status,responseJson=:response,updatedAtMs=:at WHERE accountId=:account AND recognitionId=:recognition AND recordDigest=:recordDigest AND inputDigest=:inputDigest")
    fun publish(account:String,recognition:String,recordDigest:String,inputDigest:String,status:String,response:String,at:Long):Int
    @Query("UPDATE ai_observations SET eventId=:event WHERE accountId=:account AND recognitionId=:recognition AND recordDigest=:recordDigest AND inputDigest=:inputDigest AND eventId=''")
    fun linkEvent(account:String,recognition:String,recordDigest:String,inputDigest:String,event:String):Int
    @Insert(onConflict=OnConflictStrategy.REPLACE) fun putState(state:FinanceAiAccountState)
    @Query("SELECT * FROM ai_account_state WHERE accountId=:account") fun state(account:String):FinanceAiAccountState?
    @Insert(onConflict=OnConflictStrategy.IGNORE) fun audit(row:FinanceAiAudit)
    @Query("SELECT * FROM ai_audit WHERE accountId=:account ORDER BY createdAtMs") fun auditRows(account:String):List<FinanceAiAudit>
}
@Database(entities=[FinanceAiObservation::class,FinanceAiAccountState::class,FinanceAiAudit::class],version=1,exportSchema=true)
abstract class FinanceAiDatabase:RoomDatabase(){
    abstract fun assistance():FinanceAiDao
    companion object {
        @Volatile private var instance:FinanceAiDatabase?=null
        fun get(context:Context):FinanceAiDatabase=instance?:synchronized(this){instance?:Room.databaseBuilder(context.applicationContext,FinanceAiDatabase::class.java,"wyj-finance-ai.db").build().also{instance=it}}
    }
}
