CREATE TABLE IF NOT EXISTS task16_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO task16_metadata (key, value, updated_at)
VALUES ('schema_version', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS task16_finance_devices (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 8 AND 80),
    platform TEXT NOT NULL CHECK (platform IN ('web', 'android', 'import')),
    label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 80),
    client_version TEXT NOT NULL DEFAULT '' CHECK (length(client_version) <= 80),
    last_sync_version INTEGER NOT NULL DEFAULT 0 CHECK (last_sync_version >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, device_id),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task16_finance_user_versions (
    user_id TEXT PRIMARY KEY,
    server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task16_finance_categories (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    applies_to TEXT NOT NULL DEFAULT 'both' CHECK (applies_to IN ('income', 'expense', 'both')),
    color TEXT NOT NULL DEFAULT '' CHECK (length(color) <= 16),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    sync_version INTEGER NOT NULL DEFAULT 0 CHECK (sync_version >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task16_categories_owner
ON task16_finance_categories (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS task16_finance_budgets (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    category_id TEXT NOT NULL DEFAULT '' CHECK (length(category_id) <= 80),
    period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'monthly', 'yearly', 'custom')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) = 3),
    starts_on TEXT NOT NULL DEFAULT '' CHECK (length(starts_on) <= 10),
    ends_on TEXT NOT NULL DEFAULT '' CHECK (length(ends_on) <= 10),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    sync_version INTEGER NOT NULL DEFAULT 0 CHECK (sync_version >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task16_budgets_owner
ON task16_finance_budgets (user_id, status, period_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS task16_finance_transactions (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('income', 'expense', 'refund')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) = 3),
    category_id TEXT NOT NULL DEFAULT '' CHECK (length(category_id) <= 80),
    merchant TEXT NOT NULL DEFAULT '' CHECK (length(merchant) <= 160),
    counterparty TEXT NOT NULL DEFAULT '' CHECK (length(counterparty) <= 160),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms > 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('automatic', 'manual', 'legacy_import')),
    reconciliation_state TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (reconciliation_state IN ('confirmed', 'automatic', 'pending', 'review')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    sync_version INTEGER NOT NULL DEFAULT 0 CHECK (sync_version >= 0),
    created_by_device TEXT NOT NULL DEFAULT '' CHECK (length(created_by_device) <= 80),
    import_source_key TEXT NOT NULL DEFAULT '' CHECK (length(import_source_key) <= 80),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task16_transactions_owner_time
ON task16_finance_transactions (user_id, status, occurred_at_ms DESC, id);
CREATE INDEX IF NOT EXISTS idx_task16_transactions_reconcile
ON task16_finance_transactions (user_id, direction, currency, amount_minor, occurred_at_ms DESC)
WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_task16_transactions_import
ON task16_finance_transactions (import_source_key, user_id)
WHERE import_source_key != '';

CREATE TABLE IF NOT EXISTS task16_finance_raw_events (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 8 AND 80),
    source_type TEXT NOT NULL CHECK (source_type IN ('notification', 'sms', 'accessibility', 'legacy_import')),
    source_event_id TEXT NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 160),
    source_provider TEXT NOT NULL CHECK (length(source_provider) BETWEEN 1 AND 80),
    provider_reference TEXT NOT NULL DEFAULT '' CHECK (length(provider_reference) <= 160),
    direction TEXT NOT NULL DEFAULT 'unknown'
        CHECK (direction IN ('income', 'expense', 'refund', 'pending', 'unknown')),
    amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) = 3),
    merchant TEXT NOT NULL DEFAULT '' CHECK (length(merchant) <= 160),
    counterparty TEXT NOT NULL DEFAULT '' CHECK (length(counterparty) <= 160),
    account_last4 TEXT NOT NULL DEFAULT '' CHECK (length(account_last4) IN (0, 4)),
    occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms > 0),
    captured_at_ms INTEGER NOT NULL CHECK (captured_at_ms > 0),
    text_fingerprint_sha256 TEXT NOT NULL DEFAULT '' CHECK (length(text_fingerprint_sha256) IN (0, 64)),
    classification TEXT NOT NULL CHECK (classification IN ('accepted', 'rejected', 'pending')),
    classification_reason TEXT NOT NULL DEFAULT '' CHECK (length(classification_reason) <= 120),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (length(metadata_json) <= 8000),
    sync_version INTEGER NOT NULL DEFAULT 0 CHECK (sync_version >= 0),
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task16_raw_source_event
ON task16_finance_raw_events (user_id, device_id, source_type, source_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task16_raw_provider_reference
ON task16_finance_raw_events (user_id, source_provider, provider_reference)
WHERE provider_reference != '';
CREATE INDEX IF NOT EXISTS idx_task16_raw_owner_time
ON task16_finance_raw_events (user_id, occurred_at_ms DESC, id);

CREATE TABLE IF NOT EXISTS task16_finance_transaction_events (
    transaction_id TEXT NOT NULL,
    raw_event_id TEXT NOT NULL,
    relation_status TEXT NOT NULL DEFAULT 'active' CHECK (relation_status IN ('active', 'detached')),
    confidence_milli INTEGER NOT NULL DEFAULT 1000 CHECK (confidence_milli BETWEEN 0 AND 1000),
    evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (length(evidence_json) <= 4000),
    linked_by TEXT NOT NULL CHECK (linked_by IN ('automatic', 'user', 'legacy_import')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (transaction_id, raw_event_id),
    FOREIGN KEY (transaction_id) REFERENCES task16_finance_transactions(id) ON DELETE CASCADE,
    FOREIGN KEY (raw_event_id) REFERENCES task16_finance_raw_events(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task16_one_active_transaction_per_raw
ON task16_finance_transaction_events (raw_event_id)
WHERE relation_status = 'active';
CREATE INDEX IF NOT EXISTS idx_task16_transaction_events_transaction
ON task16_finance_transaction_events (transaction_id, relation_status);

CREATE TABLE IF NOT EXISTS task16_finance_audit_logs (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    actor_device_id TEXT NOT NULL DEFAULT '' CHECK (length(actor_device_id) <= 80),
    action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
    entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 40),
    entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 80),
    before_json TEXT NOT NULL DEFAULT '{}' CHECK (length(before_json) <= 12000),
    after_json TEXT NOT NULL DEFAULT '{}' CHECK (length(after_json) <= 12000),
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task16_audit_owner
ON task16_finance_audit_logs (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS task16_finance_changes (
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 40),
    entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 80),
    operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete', 'restore', 'ingest', 'merge', 'split')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    payload_json TEXT NOT NULL CHECK (length(payload_json) BETWEEN 2 AND 32000),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, version),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task16_changes_owner
ON task16_finance_changes (user_id, version);

CREATE TABLE IF NOT EXISTS task16_finance_sync_operations (
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
CREATE INDEX IF NOT EXISTS idx_task16_sync_operations_device
ON task16_finance_sync_operations (user_id, device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task16_import_batches (
    source_key TEXT PRIMARY KEY CHECK (length(source_key) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    source_count INTEGER NOT NULL CHECK (source_count >= 0),
    received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
    applied_count INTEGER NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
    complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'rolled_back')),
    canonical_sha256 TEXT NOT NULL CHECK (length(canonical_sha256) = 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    rolled_back_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES task12_users(id)
);

CREATE TABLE IF NOT EXISTS task16_import_receipts (
    source_key TEXT NOT NULL,
    batch_key TEXT NOT NULL CHECK (length(batch_key) BETWEEN 8 AND 80),
    batch_digest TEXT NOT NULL CHECK (length(batch_digest) = 64),
    received_count INTEGER NOT NULL CHECK (received_count >= 0),
    applied_count INTEGER NOT NULL CHECK (applied_count >= 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_key, batch_key),
    FOREIGN KEY (source_key) REFERENCES task16_import_batches(source_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task16_import_record_receipts (
    source_key TEXT NOT NULL,
    record_id TEXT NOT NULL CHECK (length(record_id) BETWEEN 8 AND 80),
    record_digest TEXT NOT NULL CHECK (length(record_digest) = 64),
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_key, record_id),
    FOREIGN KEY (source_key) REFERENCES task16_import_batches(source_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task16_import_record_receipts_record
ON task16_import_record_receipts (record_id);

INSERT INTO task13_membership_plans (
    code, name, price_cents, currency, lifetime, duration_months,
    purchasable, priority, description, updated_at
) VALUES (
    'finance_monthly', '财务会员', 800, 'CNY', 0, 1,
    0, 44, 'Web 与 Android 共用的财务账本会员，有效期一个月。收款二维码配置完成前不公开销售。', CURRENT_TIMESTAMP
)
ON CONFLICT(code) DO UPDATE SET
    name = excluded.name,
    price_cents = excluded.price_cents,
    currency = excluded.currency,
    lifetime = excluded.lifetime,
    duration_months = excluded.duration_months,
    purchasable = excluded.purchasable,
    priority = excluded.priority,
    description = excluded.description,
    updated_at = excluded.updated_at;

INSERT OR IGNORE INTO task13_membership_entitlements (plan_code, entitlement_code) VALUES
    ('finance_monthly', 'finance_access'),
    ('all_access_monthly', 'finance_access'),
    ('all_access_lifetime', 'finance_access');
