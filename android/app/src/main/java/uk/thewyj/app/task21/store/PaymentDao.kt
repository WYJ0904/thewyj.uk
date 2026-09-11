package uk.thewyj.app.task21.store

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PaymentDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertRecognition(recognition: PaymentRecognitionEntity)

    @Query("SELECT * FROM payment_recognitions WHERE accountId = :accountId AND recognitionId = :recognitionId")
    fun recognition(accountId: String, recognitionId: String): PaymentRecognitionEntity?

    @Query("SELECT * FROM payment_recognitions WHERE accountId = :accountId AND sourceEventId = :sourceEventId LIMIT 1")
    fun recognitionBySourceEvent(accountId: String, sourceEventId: String): PaymentRecognitionEntity?

    /**
     * Looks a recognition up by the structured-event identity it was uploaded
     * under, so a confirmed ledger booking can close the local pending state.
     */
    @Query("SELECT * FROM payment_recognitions WHERE accountId = :accountId AND uploadEventId = :uploadEventId LIMIT 1")
    fun recognitionByUploadEvent(accountId: String, uploadEventId: String): PaymentRecognitionEntity?

    @Query("SELECT COUNT(*) FROM payment_recognitions WHERE accountId = :accountId")
    fun recognitionCount(accountId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertTicket(ticket: PaymentTicketEntity)

    @Query("SELECT * FROM payment_tickets WHERE accountId = :accountId AND ticketId = :ticketId")
    fun ticket(accountId: String, ticketId: String): PaymentTicketEntity?

    @Query(
        """
        SELECT * FROM payment_tickets
        WHERE accountId = :accountId AND sourcePackage = :sourcePackage
          AND state IN ('CREATED', 'WAITING_FOR_ACCESSIBILITY', 'ENRICHED', 'CANDIDATE_CREATED')
        ORDER BY createdAtMs DESC LIMIT 1
        """,
    )
    fun activeTicketForPackage(accountId: String, sourcePackage: String): PaymentTicketEntity?

    @Query("SELECT * FROM payment_tickets WHERE accountId = :accountId AND recognitionId = :recognitionId ORDER BY createdAtMs DESC")
    fun ticketsForRecognition(accountId: String, recognitionId: String): List<PaymentTicketEntity>

    /**
     * Packages that currently own an active enrichment ticket. The accessibility
     * service uses this as a cheap gate so it never touches the database (or the
     * node tree) for SystemUI/launcher/IME noise.
     */
    @Query(
        """
        SELECT DISTINCT sourcePackage FROM payment_tickets
        WHERE accountId = :accountId AND expiresAtMs > :nowMs
          AND state IN ('CREATED', 'WAITING_FOR_ACCESSIBILITY', 'ENRICHED', 'CANDIDATE_CREATED')
        """,
    )
    fun activeTicketPackages(accountId: String, nowMs: Long): List<String>

    @Query(
        """
        SELECT * FROM payment_tickets
        WHERE accountId = :accountId AND state IN ('CREATED', 'WAITING_FOR_ACCESSIBILITY')
        ORDER BY createdAtMs DESC LIMIT :limit
        """,
    )
    fun openTickets(accountId: String, limit: Int): List<PaymentTicketEntity>

    @Query(
        """
        SELECT * FROM payment_recognitions
        WHERE accountId = :accountId AND state IN (:states)
        ORDER BY updatedAtMs DESC LIMIT :limit
        """,
    )
    fun recognitionsByState(accountId: String, states: List<String>, limit: Int): List<PaymentRecognitionEntity>

    @Query("SELECT COUNT(*) FROM payment_tickets WHERE accountId = :accountId")
    fun ticketCount(accountId: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertCandidate(candidate: PaymentCandidateEntity)

    @Query("SELECT * FROM payment_candidates WHERE accountId = :accountId AND candidateId = :candidateId")
    fun candidate(accountId: String, candidateId: String): PaymentCandidateEntity?

    @Query("SELECT * FROM payment_candidates WHERE accountId = :accountId AND recognitionId = :recognitionId LIMIT 1")
    fun candidateForRecognition(accountId: String, recognitionId: String): PaymentCandidateEntity?

    @Query("SELECT * FROM payment_candidates WHERE accountId = :accountId AND status = :status ORDER BY createdAtMs DESC LIMIT :limit")
    fun candidatesByStatus(accountId: String, status: String, limit: Int): List<PaymentCandidateEntity>

    @Query("SELECT COUNT(*) FROM payment_candidates WHERE accountId = :accountId AND status = 'pending'")
    fun pendingCandidateCount(accountId: String): Int

    /** Live pending count for the "待确认交易" banner. */
    @Query("SELECT COUNT(*) FROM payment_candidates WHERE accountId = :accountId AND status = 'pending'")
    fun observePendingCandidateCount(accountId: String): Flow<Int>

    @Query(
        """
        SELECT * FROM payment_candidates
        WHERE accountId = :accountId AND status IN ('pending', 'confirmed')
          AND hasAmount = 1 AND amountMinor = :amountMinor
          AND occurredAtMs BETWEEN :fromMs AND :toMs
        ORDER BY ABS(occurredAtMs - :occurredAtMs) ASC LIMIT 1
        """,
    )
    fun reconciliationCandidates(
        accountId: String,
        amountMinor: Long,
        occurredAtMs: Long,
        fromMs: Long,
        toMs: Long,
    ): List<PaymentCandidateEntity>

    @Query("DELETE FROM payment_candidates WHERE accountId = :accountId AND candidateId = :candidateId")
    fun deleteCandidate(accountId: String, candidateId: String): Int

    @Query("DELETE FROM payment_tickets WHERE accountId = :accountId AND expiresAtMs < :cutoffMs AND state = 'EXPIRED'")
    fun purgeExpiredTickets(accountId: String, cutoffMs: Long): Int
}
