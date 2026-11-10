/* P03: additive structured evidence on the existing notification/finance pipeline. */
/* 0026 belongs to the independent Task 26 branch; do not reuse its number. */
ALTER TABLE task21_notification_events ADD COLUMN financial_phase TEXT NOT NULL DEFAULT ''
    CHECK (financial_phase IN ('', 'AUTHORIZED', 'SETTLED', 'RELEASED', 'EXPIRED', 'REFUNDED', 'REVIEW_REQUIRED'));
ALTER TABLE task21_notification_events ADD COLUMN lifecycle_reference TEXT NOT NULL DEFAULT '' CHECK (length(lifecycle_reference) <= 40);
ALTER TABLE task21_notification_events ADD COLUMN reference_namespace TEXT NOT NULL DEFAULT '' CHECK (length(reference_namespace) <= 160);
ALTER TABLE task21_notification_events ADD COLUMN currency_evidence TEXT NOT NULL DEFAULT '' CHECK (length(currency_evidence) <= 64);
ALTER TABLE task21_notification_events ADD COLUMN identity_review_reason TEXT NOT NULL DEFAULT '' CHECK (length(identity_review_reason) <= 80);
CREATE INDEX idx_task21_financial_lifecycle ON task21_notification_events
    (user_id, reference_namespace, lifecycle_reference, financial_phase);
CREATE INDEX idx_task16_owner_reference_direction ON task16_finance_raw_events (user_id, provider_reference, direction);
/* Strong references learned later attach evidence to existing raw/ledger IDs. */
CREATE TABLE task21_payment_reference_aliases (
    user_id TEXT NOT NULL, reference_provider TEXT NOT NULL, provider_reference TEXT NOT NULL,
    raw_event_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, reference_provider, provider_reference),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE,
    FOREIGN KEY (raw_event_id) REFERENCES task16_finance_raw_events(id)
);
/* Old servers must fail readiness rather than permit legacy manual confirmation of a hold. */
UPDATE task21_metadata SET value = '3', updated_at = CURRENT_TIMESTAMP WHERE key = 'schema_version';
