package uk.thewyj.app.task21.store

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface PaymentReconciliationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun saveAlias(row: PaymentReconciliationAliasEntity)
    @Query("SELECT * FROM payment_reconciliation_aliases WHERE accountId=:accountId AND sourceEventId=:sourceEventId")
    fun alias(accountId: String, sourceEventId: String): PaymentReconciliationAliasEntity?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun saveJournal(row: PaymentReconciliationEntity)
    @Query("SELECT * FROM payment_reconciliations WHERE accountId=:accountId AND operationId=:operationId")
    fun journal(accountId: String, operationId: String): PaymentReconciliationEntity?
    @Query("SELECT * FROM payment_reconciliations WHERE accountId=:accountId AND state='staged' ORDER BY createdAtMs,operationId")
    fun staged(accountId: String): List<PaymentReconciliationEntity>
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun saveEffective(row: PaymentEffectiveRecognitionEntity)
    @Query("SELECT * FROM payment_effective_recognitions WHERE accountId=:accountId AND recognitionId=:recognitionId")
    fun effective(accountId: String, recognitionId: String): PaymentEffectiveRecognitionEntity?
    @Query("SELECT * FROM payment_effective_recognitions WHERE accountId=:accountId AND canonicalRecognitionId=:recognitionId AND excluded=0")
    fun members(accountId: String, recognitionId: String): List<PaymentEffectiveRecognitionEntity>
    @Insert(onConflict = OnConflictStrategy.IGNORE) fun decide(row: PaymentUserDecisionEntity)
    @Query("SELECT COUNT(*) FROM payment_user_decisions WHERE accountId=:accountId AND recognitionId=:recognitionId")
    fun hasDecision(accountId: String, recognitionId: String): Int
    @Update fun updateBooking(row: LocalPaymentBookingEntity)
    @Insert(onConflict = OnConflictStrategy.ABORT) fun supersede(row: PaymentBookingSupersessionEntity)
    @Query("SELECT * FROM payment_booking_supersessions WHERE accountId=:accountId AND transactionId=:transactionId")
    fun supersession(accountId: String, transactionId: String): PaymentBookingSupersessionEntity?
}
