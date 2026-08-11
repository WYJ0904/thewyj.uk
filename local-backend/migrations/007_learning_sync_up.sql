CREATE TABLE IF NOT EXISTS learning_sync_records (
    user_id TEXT NOT NULL,
    data_type TEXT NOT NULL,
    record_id TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    client_id TEXT NOT NULL,
    client_version TEXT NOT NULL DEFAULT '',
    server_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    server_updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, data_type, record_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS learning_sync_records_user_type_idx
    ON learning_sync_records(user_id, data_type, deleted, server_version);

CREATE TABLE IF NOT EXISTS learning_sync_heads (
    user_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_sync_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    user_version INTEGER NOT NULL,
    data_type TEXT NOT NULL,
    record_id TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    client_id TEXT NOT NULL,
    client_version TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS learning_sync_changes_user_version_unique
    ON learning_sync_changes(user_id, user_version);

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES ('007_learning_sync', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
