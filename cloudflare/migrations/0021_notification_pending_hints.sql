/* Task 24.1 P0-3: unified pending-hint model.
   Amount-unknown and direction-unknown payments are real review items but must
   never invent money fields, and they must not touch the finance transaction
   CHECK constraints. They get their own table so Android and Web read the same
   pending state through one API. The table is additive: no existing table,
   constraint or row is modified, so the migration is safe to re-run. */
CREATE TABLE IF NOT EXISTS task21_notification_pending_hints (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    /* Stable device-side identity: the notification upload event id. */
    source_event_id TEXT NOT NULL CHECK (length(source_event_id) BETWEEN 8 AND 80),
    device_id TEXT NOT NULL DEFAULT '' CHECK (length(device_id) <= 80),
    source_type TEXT NOT NULL DEFAULT 'notification'
        CHECK (source_type IN ('notification', 'sms', 'bank', 'accessibility')),
    source_package TEXT NOT NULL DEFAULT '' CHECK (length(source_package) <= 160),
    app_label TEXT NOT NULL DEFAULT '' CHECK (length(app_label) <= 80),
    /* Structured evidence only - raw notification text never leaves the device. */
    evidence_summary TEXT NOT NULL DEFAULT '{}' CHECK (length(evidence_summary) <= 2000),
    amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor > 0),
    direction TEXT CHECK (direction IS NULL OR direction IN ('income', 'expense', 'refund', 'unknown')),
    merchant TEXT NOT NULL DEFAULT '' CHECK (length(merchant) <= 160),
    currency TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) <= 8),
    confidence INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1000),
    recognition_status TEXT NOT NULL DEFAULT 'PAYMENT_LIKELY'
        CHECK (recognition_status IN ('CONFIRMED_PAYMENT', 'PAYMENT_LIKELY', 'INSUFFICIENT_INFORMATION')),
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'confirmed', 'ignored', 'superseded', 'expired')),
    finance_entry_id TEXT NOT NULL DEFAULT '' CHECK (length(finance_entry_id) <= 80),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    confirmed_at TEXT NOT NULL DEFAULT '',
    ignored_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task21_hints_user_event
ON task21_notification_pending_hints (user_id, source_event_id);
CREATE INDEX IF NOT EXISTS idx_task21_hints_user_state
ON task21_notification_pending_hints (user_id, state, created_at DESC);
