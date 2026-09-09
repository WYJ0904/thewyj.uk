CREATE TABLE IF NOT EXISTS task21_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO task21_metadata (key, value, updated_at)
VALUES ('schema_version', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS task21_notification_events (
    event_id TEXT PRIMARY KEY CHECK (length(event_id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 8 AND 80),
    fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
    source_package TEXT NOT NULL DEFAULT '' CHECK (length(source_package) <= 160),
    source_type TEXT NOT NULL DEFAULT 'notification'
        CHECK (source_type IN ('notification', 'sms', 'accessibility')),
    event_type TEXT NOT NULL DEFAULT 'other'
        CHECK (event_type IN ('transaction', 'refund', 'marketing', 'verification', 'other')),
    parser_version TEXT NOT NULL DEFAULT '' CHECK (length(parser_version) <= 40),
    parse_status TEXT NOT NULL
        CHECK (parse_status IN ('parsed', 'candidate', 'unparsed')),
    direction TEXT NOT NULL DEFAULT ''
        CHECK (direction IN ('', 'income', 'expense', 'refund')),
    amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) = 3),
    payment_channel TEXT NOT NULL DEFAULT '' CHECK (length(payment_channel) <= 40),
    merchant TEXT NOT NULL DEFAULT '' CHECK (length(merchant) <= 160),
    counterparty TEXT NOT NULL DEFAULT '' CHECK (length(counterparty) <= 160),
    confidence INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1000),
    occurred_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (occurred_at_ms >= 0),
    received_at_ms INTEGER NOT NULL CHECK (received_at_ms > 0),
    candidate_id TEXT NOT NULL DEFAULT '' CHECK (length(candidate_id) <= 80),
    finance_transaction_id TEXT NOT NULL DEFAULT '' CHECK (length(finance_transaction_id) <= 80),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task21_events_user_event
ON task21_notification_events (user_id, event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task21_events_user_fingerprint
ON task21_notification_events (user_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_task21_events_owner_time
ON task21_notification_events (user_id, status, received_at_ms DESC, event_id);

CREATE TABLE IF NOT EXISTS task21_notification_candidates (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 8 AND 80),
    direction TEXT NOT NULL CHECK (direction IN ('income', 'expense', 'refund')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) = 3),
    merchant TEXT NOT NULL DEFAULT '' CHECK (length(merchant) <= 160),
    counterparty TEXT NOT NULL DEFAULT '' CHECK (length(counterparty) <= 160),
    payment_channel TEXT NOT NULL DEFAULT '' CHECK (length(payment_channel) <= 40),
    occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms > 0),
    confidence INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
    finance_transaction_id TEXT NOT NULL DEFAULT '' CHECK (length(finance_transaction_id) <= 80),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task21_candidates_user_event
ON task21_notification_candidates (user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_task21_candidates_owner_status
ON task21_notification_candidates (user_id, status, created_at DESC, id);

CREATE TABLE IF NOT EXISTS task21_notification_sync_operations (
    user_id TEXT NOT NULL,
    operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 8 AND 80),
    device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 8 AND 80),
    operation_type TEXT NOT NULL CHECK (length(operation_type) BETWEEN 3 AND 80),
    payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
    result_version INTEGER NOT NULL DEFAULT 0 CHECK (result_version >= 0),
    result_json TEXT NOT NULL CHECK (length(result_json) BETWEEN 2 AND 16000),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, operation_id),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task21_sync_operations_device
ON task21_notification_sync_operations (user_id, device_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task21_finance_notification_source
ON task16_finance_raw_events (user_id, source_type, source_event_id)
WHERE source_type = 'notification' AND source_event_id != '';
