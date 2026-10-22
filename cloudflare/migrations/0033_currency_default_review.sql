/* Preserve original monetary facts; provenance is an additive review state. */
ALTER TABLE task21_notification_events ADD COLUMN currency_review_required INTEGER NOT NULL DEFAULT 0 CHECK(currency_review_required IN (0,1));
ALTER TABLE task21_notification_events ADD COLUMN currency_decision_source TEXT NOT NULL DEFAULT '';
ALTER TABLE task21_notification_pending_hints ADD COLUMN currency_review_required INTEGER NOT NULL DEFAULT 0 CHECK(currency_review_required IN (0,1));
ALTER TABLE task21_notification_pending_hints ADD COLUMN currency_decision_source TEXT NOT NULL DEFAULT '';
ALTER TABLE task16_finance_transactions ADD COLUMN currency_review_required INTEGER NOT NULL DEFAULT 0 CHECK(currency_review_required IN (0,1));
ALTER TABLE task16_finance_transactions ADD COLUMN currency_decision_source TEXT NOT NULL DEFAULT '';
DROP VIEW task21_payment_effective_view;
CREATE VIEW task21_payment_effective_view AS SELECT
 e.event_id,e.user_id,e.device_id,e.fingerprint,e.source_package,e.source_type,e.event_type,
 e.parser_version,CASE WHEN o.event_id IS NOT NULL AND o.excluded=0 THEN 'parsed' ELSE e.parse_status END AS parse_status,
 e.direction,COALESCE(o.amount_minor,e.amount_minor) AS amount_minor,e.currency,e.payment_channel,e.merchant,e.counterparty,e.confidence,
 e.occurred_at_ms,e.received_at_ms,e.candidate_id,COALESCE(o.transaction_id,e.finance_transaction_id) AS finance_transaction_id,
 e.status,e.created_at,e.updated_at,e.deleted_at,COALESCE(o.provider_reference,e.provider_reference) AS provider_reference,e.lifecycle_identity,
 COALESCE(o.financial_phase,e.financial_phase) AS financial_phase,COALESCE(o.lifecycle_reference,e.lifecycle_reference) AS lifecycle_reference,
 COALESCE(o.reference_namespace,e.reference_namespace) AS reference_namespace,e.currency_evidence,e.currency_review_required,e.currency_decision_source,
 CASE WHEN o.event_id IS NOT NULL AND o.excluded=0 THEN '' ELSE e.identity_review_reason END AS identity_review_reason,
 COALESCE(o.lifecycle_operation,e.lifecycle_operation) AS lifecycle_operation,COALESCE(o.lifecycle_revision,e.lifecycle_revision) AS lifecycle_revision,
 CASE WHEN o.event_id IS NOT NULL AND o.excluded=0 THEN '' ELSE e.lifecycle_review_reason END AS lifecycle_review_reason,
 COALESCE(o.canonical_event_id,e.event_id) AS canonical_event_id,COALESCE(o.excluded,0) AS excluded
 FROM task21_notification_events e LEFT JOIN task21_payment_effective_events o ON o.user_id=e.user_id AND o.event_id=e.event_id;
UPDATE task16_metadata SET value='5' WHERE key='schema_version';
UPDATE task21_metadata SET value='9' WHERE key='schema_version';
