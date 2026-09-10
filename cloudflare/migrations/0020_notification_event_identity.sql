DROP INDEX IF EXISTS idx_task21_events_user_fingerprint;

CREATE INDEX IF NOT EXISTS idx_task21_events_user_fingerprint_lookup
ON task21_notification_events (user_id, fingerprint);

CREATE TABLE IF NOT EXISTS task21_notification_evidence (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 8 AND 80),
    candidate_id TEXT NOT NULL DEFAULT '' CHECK (length(candidate_id) <= 80),
    finance_transaction_id TEXT NOT NULL DEFAULT '' CHECK (length(finance_transaction_id) <= 80),
    source_type TEXT NOT NULL DEFAULT 'notification'
        CHECK (source_type IN ('notification', 'sms', 'accessibility')),
    source_package TEXT NOT NULL DEFAULT '' CHECK (length(source_package) <= 160),
    parser_version TEXT NOT NULL DEFAULT '' CHECK (length(parser_version) <= 40),
    amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
    direction TEXT NOT NULL DEFAULT 'unknown'
        CHECK (direction IN ('income', 'expense', 'refund', 'unknown')),
    provider_reference TEXT NOT NULL DEFAULT '' CHECK (length(provider_reference) <= 120),
    occurred_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (occurred_at_ms >= 0),
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    reconciliation_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (reconciliation_state IN ('pending', 'merged', 'confirmed', 'rejected', 'duplicate')),
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task21_evidence_user_event
ON task21_notification_evidence (user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_task21_evidence_user_candidate
ON task21_notification_evidence (user_id, candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task21_evidence_user_transaction
ON task21_notification_evidence (user_id, finance_transaction_id);

ALTER TABLE task21_notification_candidates ADD COLUMN edited_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE task21_notification_candidates ADD COLUMN correction_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task21_notification_candidates ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 1;

UPDATE task21_metadata
SET value = '2', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
