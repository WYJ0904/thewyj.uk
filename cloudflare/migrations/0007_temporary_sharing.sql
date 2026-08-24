CREATE TABLE IF NOT EXISTS task14_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO task14_metadata (key, value, updated_at)
VALUES ('schema_version', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS task14_shares (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 80),
    owner_user_id TEXT NOT NULL CHECK (length(owner_user_id) BETWEEN 1 AND 80),
    share_type TEXT NOT NULL CHECK (share_type IN ('text', 'file', 'clipboard', 'qr', 'room')),
    kind TEXT NOT NULL DEFAULT '' CHECK (length(kind) <= 24),
    content_text TEXT NOT NULL DEFAULT '' CHECK (length(content_text) <= 102400),
    r2_object_key TEXT NOT NULL DEFAULT '' CHECK (length(r2_object_key) <= 320),
    file_name TEXT NOT NULL DEFAULT '' CHECK (length(file_name) <= 120),
    file_extension TEXT NOT NULL DEFAULT '' CHECK (length(file_extension) <= 12),
    mime_type TEXT NOT NULL DEFAULT '' CHECK (length(mime_type) <= 120),
    size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0 AND size_bytes <= 31457280),
    sha256_hex TEXT NOT NULL DEFAULT '' CHECK (length(sha256_hex) IN (0, 64)),
    password_hash TEXT NOT NULL DEFAULT '' CHECK (length(password_hash) <= 512),
    connection_code_digest TEXT NOT NULL DEFAULT '' CHECK (length(connection_code_digest) IN (0, 64)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    max_views INTEGER NOT NULL DEFAULT 1 CHECK (max_views BETWEEN 1 AND 1000),
    view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    max_downloads INTEGER NOT NULL DEFAULT 1 CHECK (max_downloads BETWEEN 1 AND 100),
    download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
    destroy_after_read INTEGER NOT NULL DEFAULT 0 CHECK (destroy_after_read IN (0, 1)),
    destroy_after_download INTEGER NOT NULL DEFAULT 0 CHECK (destroy_after_download IN (0, 1)),
    max_messages INTEGER NOT NULL DEFAULT 50 CHECK (max_messages BETWEEN 1 AND 200),
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN (
        'uploading', 'active', 'delete_pending', 'failed', 'deleted'
    )),
    deletion_reason TEXT NOT NULL DEFAULT '' CHECK (length(deletion_reason) <= 80),
    cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
    cleanup_retry_at TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'cloud' CHECK (length(source) <= 40),
    source_updated_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (owner_user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task14_clipboard_code
ON task14_shares (connection_code_digest)
WHERE connection_code_digest != '' AND share_type = 'clipboard';

CREATE INDEX IF NOT EXISTS idx_task14_share_owner
ON task14_shares (owner_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task14_share_expiry
ON task14_shares (state, expires_at, cleanup_retry_at);

CREATE INDEX IF NOT EXISTS idx_task14_share_storage
ON task14_shares (state, owner_user_id, size_bytes)
WHERE share_type = 'file';

CREATE TABLE IF NOT EXISTS task14_room_messages (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 80),
    room_id TEXT NOT NULL CHECK (length(room_id) BETWEEN 16 AND 80),
    author TEXT NOT NULL CHECK (length(author) BETWEEN 1 AND 30),
    message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 4096),
    created_at TEXT NOT NULL,
    FOREIGN KEY (room_id) REFERENCES task14_shares(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task14_room_messages
ON task14_room_messages (room_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS task14_download_grants (
    token_digest TEXT PRIMARY KEY CHECK (length(token_digest) = 64),
    share_id TEXT NOT NULL CHECK (length(share_id) BETWEEN 16 AND 80),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'completed', 'expired', 'revoked')),
    request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    range_request_count INTEGER NOT NULL DEFAULT 0 CHECK (range_request_count >= 0),
    active_request_id TEXT NOT NULL DEFAULT '' CHECK (length(active_request_id) <= 80),
    active_request_expires_at TEXT NOT NULL DEFAULT '',
    completed_at TEXT NOT NULL DEFAULT '',
    last_used_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (share_id) REFERENCES task14_shares(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task14_download_grant_expiry
ON task14_download_grants (expires_at, state);

CREATE INDEX IF NOT EXISTS idx_task14_download_grant_share
ON task14_download_grants (share_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task14_usage_daily (
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    usage_date TEXT NOT NULL CHECK (length(usage_date) = 10),
    create_count INTEGER NOT NULL DEFAULT 0 CHECK (create_count >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, usage_date),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task14_usage_daily_date
ON task14_usage_daily (usage_date);

CREATE TABLE IF NOT EXISTS task14_import_runs (
    source_key TEXT PRIMARY KEY CHECK (length(source_key) BETWEEN 8 AND 120),
    source_kind TEXT NOT NULL CHECK (length(source_kind) BETWEEN 1 AND 40),
    source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
    source_bytes INTEGER NOT NULL DEFAULT 0 CHECK (source_bytes >= 0),
    imported_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
    imported_bytes INTEGER NOT NULL DEFAULT 0 CHECK (imported_bytes >= 0),
    status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'rolled_back')),
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
