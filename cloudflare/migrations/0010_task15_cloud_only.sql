CREATE TABLE IF NOT EXISTS task15_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO task15_metadata (key, value, updated_at)
VALUES ('schema_version', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS task15_quiz_sessions (
    token_digest TEXT PRIMARY KEY CHECK (length(token_digest) = 64),
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    language TEXT NOT NULL CHECK (language IN ('english', 'japanese')),
    words_json TEXT NOT NULL CHECK (length(words_json) BETWEEN 2 AND 131072),
    word_count INTEGER NOT NULL CHECK (word_count BETWEEN 1 AND 200),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task15_quiz_session_expiry
ON task15_quiz_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_task15_quiz_session_owner
ON task15_quiz_sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task15_ai_cache (
    cache_key TEXT PRIMARY KEY CHECK (length(cache_key) = 64),
    task_type TEXT NOT NULL CHECK (task_type IN ('judge', 'rubric', 'readings', 'vocabulary')),
    model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 160),
    result_json TEXT NOT NULL CHECK (length(result_json) BETWEEN 2 AND 65536),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
    last_hit_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_task15_ai_cache_expiry
ON task15_ai_cache (expires_at, task_type);

CREATE TABLE IF NOT EXISTS task15_ai_usage_daily (
    usage_date TEXT NOT NULL CHECK (length(usage_date) = 10),
    scope_key TEXT NOT NULL CHECK (length(scope_key) BETWEEN 6 AND 80),
    scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'user')),
    request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    cache_hit_count INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit_count >= 0),
    latency_ms_total INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms_total >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (usage_date, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_task15_ai_usage_date
ON task15_ai_usage_daily (usage_date, scope_type);

CREATE TABLE IF NOT EXISTS task15_ai_leases (
    slot_id INTEGER PRIMARY KEY CHECK (slot_id BETWEEN 1 AND 4),
    lease_token TEXT NOT NULL DEFAULT '' CHECK (length(lease_token) <= 80),
    subject_hash TEXT NOT NULL DEFAULT '' CHECK (length(subject_hash) IN (0, 64)),
    leased_until INTEGER NOT NULL DEFAULT 0 CHECK (leased_until >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO task15_ai_leases (slot_id) VALUES (1), (2), (3), (4);

CREATE TABLE IF NOT EXISTS task15_tool_favorites (
    user_id TEXT NOT NULL,
    tool_id TEXT NOT NULL CHECK (length(tool_id) BETWEEN 1 AND 80),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'cloud' CHECK (source IN ('cloud', 'legacy_import')),
    source_ref TEXT NOT NULL DEFAULT '' CHECK (length(source_ref) <= 80),
    PRIMARY KEY (user_id, tool_id),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task15_tool_favorites_owner
ON task15_tool_favorites (user_id, pinned DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS task15_tool_recent_usage (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    tool_id TEXT NOT NULL CHECK (length(tool_id) BETWEEN 1 AND 80),
    used_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'cloud' CHECK (source IN ('cloud', 'legacy_import')),
    source_ref TEXT NOT NULL DEFAULT '' CHECK (length(source_ref) <= 80),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task15_tool_recent_owner
ON task15_tool_recent_usage (user_id, used_at DESC);

CREATE INDEX IF NOT EXISTS idx_task15_tool_recent_stats
ON task15_tool_recent_usage (tool_id, used_at DESC);

CREATE TABLE IF NOT EXISTS task15_saved_tool_configs (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    tool_id TEXT NOT NULL CHECK (length(tool_id) BETWEEN 1 AND 80),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    config_json TEXT NOT NULL CHECK (length(config_json) BETWEEN 2 AND 51200),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'cloud' CHECK (source IN ('cloud', 'legacy_import')),
    source_ref TEXT NOT NULL DEFAULT '' CHECK (length(source_ref) <= 80),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task15_tool_configs_owner
ON task15_saved_tool_configs (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS task15_import_batches (
    source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 8 AND 80),
    kind TEXT NOT NULL CHECK (kind IN ('favorites', 'recent', 'configs')),
    source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
    received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
    applied_count INTEGER NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
    complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (source_key, kind)
);

CREATE TABLE IF NOT EXISTS task15_import_receipts (
    source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 8 AND 80),
    kind TEXT NOT NULL CHECK (kind IN ('favorites', 'recent', 'configs')),
    batch_key TEXT NOT NULL CHECK (length(batch_key) BETWEEN 8 AND 80),
    batch_digest TEXT NOT NULL CHECK (length(batch_digest) = 64),
    source_count INTEGER NOT NULL CHECK (source_count >= 0),
    received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
    applied_count INTEGER NOT NULL DEFAULT 0 CHECK (applied_count >= 0),
    complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_key, kind, batch_key),
    FOREIGN KEY (source_key, kind)
        REFERENCES task15_import_batches(source_key, kind)
        ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_task15_import_receipt_validate
BEFORE INSERT ON task15_import_receipts
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM task15_import_batches
            WHERE source_key = NEW.source_key AND kind = NEW.kind
        ) THEN RAISE(ABORT, 'task15_import_parent_missing')
        WHEN NEW.source_count != (
            SELECT source_count FROM task15_import_batches
            WHERE source_key = NEW.source_key AND kind = NEW.kind
        ) THEN RAISE(ABORT, 'task15_import_source_count_conflict')
        WHEN (
            SELECT complete FROM task15_import_batches
            WHERE source_key = NEW.source_key AND kind = NEW.kind
        ) = 1 THEN RAISE(ABORT, 'task15_import_already_complete')
        WHEN NEW.received_count + COALESCE((
            SELECT SUM(received_count) FROM task15_import_receipts
            WHERE source_key = NEW.source_key AND kind = NEW.kind
        ), 0) > NEW.source_count THEN RAISE(ABORT, 'task15_import_incomplete_source')
        WHEN NEW.complete = 1 AND NEW.received_count + COALESCE((
            SELECT SUM(received_count) FROM task15_import_receipts
            WHERE source_key = NEW.source_key AND kind = NEW.kind
        ), 0) != NEW.source_count THEN RAISE(ABORT, 'task15_import_incomplete_source')
    END;
END;

CREATE TRIGGER IF NOT EXISTS trg_task15_import_receipt_rollup
AFTER INSERT ON task15_import_receipts
BEGIN
    UPDATE task15_import_batches
    SET received_count = received_count + NEW.received_count,
        applied_count = applied_count + NEW.applied_count,
        complete = CASE WHEN NEW.complete = 1 THEN 1 ELSE complete END,
        updated_at = NEW.created_at
    WHERE source_key = NEW.source_key AND kind = NEW.kind;
END;
