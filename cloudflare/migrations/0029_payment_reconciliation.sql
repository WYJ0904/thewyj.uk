/* P03-A: immutable reconciliation journal and effective source associations.
   The Task16 ledger remains the only formal ledger. No historic event is rewritten. */
CREATE TABLE task21_payment_reconciliations (
 user_id TEXT NOT NULL, operation_id TEXT NOT NULL, payload_digest TEXT NOT NULL,
 command_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','applied')),
 reason TEXT NOT NULL, before_json TEXT NOT NULL, result_json TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE task21_payment_effective_events (
 user_id TEXT NOT NULL, event_id TEXT NOT NULL, canonical_event_id TEXT NOT NULL,
 transaction_id TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),
 financial_phase TEXT NOT NULL, lifecycle_operation TEXT NOT NULL, lifecycle_revision INTEGER NOT NULL,
 lifecycle_reference TEXT NOT NULL, provider_reference TEXT NOT NULL, reference_namespace TEXT NOT NULL,
 operation_id TEXT NOT NULL, excluded INTEGER NOT NULL CHECK(excluded IN (0,1)),
 PRIMARY KEY(user_id,event_id)
);
CREATE INDEX idx_task21_effective_operation ON task21_payment_effective_events(user_id,reference_namespace,lifecycle_reference,provider_reference);
CREATE TABLE task21_payment_reconciliation_guards (
 user_id TEXT NOT NULL, operation_id TEXT NOT NULL, passed INTEGER NOT NULL CHECK(passed=1),
 PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE task21_payment_user_decisions (
 user_id TEXT NOT NULL, event_id TEXT NOT NULL, decision TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,event_id)
);
CREATE VIEW task21_payment_effective_view AS SELECT
 e.event_id,e.user_id,e.device_id,e.fingerprint,e.source_package,e.source_type,e.event_type,
 e.parser_version,CASE WHEN o.event_id IS NOT NULL AND o.excluded=0 THEN 'parsed' ELSE e.parse_status END AS parse_status,
 e.direction,COALESCE(o.amount_minor,e.amount_minor) AS amount_minor,e.currency,e.payment_channel,e.merchant,e.counterparty,e.confidence,
 e.occurred_at_ms,e.received_at_ms,e.candidate_id,COALESCE(o.transaction_id,e.finance_transaction_id) AS finance_transaction_id,
 e.status,e.created_at,e.updated_at,e.deleted_at,COALESCE(o.provider_reference,e.provider_reference) AS provider_reference,e.lifecycle_identity,
 COALESCE(o.financial_phase,e.financial_phase) AS financial_phase,COALESCE(o.lifecycle_reference,e.lifecycle_reference) AS lifecycle_reference,
 COALESCE(o.reference_namespace,e.reference_namespace) AS reference_namespace,e.currency_evidence,
 CASE WHEN o.event_id IS NOT NULL AND o.excluded=0 THEN '' ELSE e.identity_review_reason END AS identity_review_reason,
 COALESCE(o.lifecycle_operation,e.lifecycle_operation) AS lifecycle_operation,COALESCE(o.lifecycle_revision,e.lifecycle_revision) AS lifecycle_revision,
 CASE WHEN o.event_id IS NOT NULL AND o.excluded=0 THEN '' ELSE e.lifecycle_review_reason END AS lifecycle_review_reason,
 COALESCE(o.canonical_event_id,e.event_id) AS canonical_event_id,COALESCE(o.excluded,0) AS excluded
 FROM task21_notification_events e LEFT JOIN task21_payment_effective_events o ON o.user_id=e.user_id AND o.event_id=e.event_id;
/* Old writers do not understand corrections and must fail readiness. */
UPDATE task21_metadata SET value='5',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
/* Old Task16 raw writers must also stop; their API compares this to wire v1.
   Current code separates database readiness from the unchanged wire protocol. */
UPDATE task16_metadata SET value='2',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
