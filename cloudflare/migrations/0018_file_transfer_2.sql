CREATE TABLE IF NOT EXISTS task22_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO task22_metadata (key, value, updated_at)
VALUES ('schema_version', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS task22_upload_sessions (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 80),
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'guest')),
    owner_ref TEXT NOT NULL CHECK (length(owner_ref) BETWEEN 8 AND 96),
    state TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('active', 'published', 'aborted', 'expired', 'failed')),
    file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
    total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
    password_hash TEXT NOT NULL DEFAULT '' CHECK (length(password_hash) <= 512),
    minutes INTEGER NOT NULL DEFAULT 1440 CHECK (minutes BETWEEN 60 AND 10080),
    max_downloads INTEGER NOT NULL DEFAULT 5 CHECK (max_downloads BETWEEN 1 AND 100),
    one_time INTEGER NOT NULL DEFAULT 0 CHECK (one_time IN (0, 1)),
    share_id TEXT NOT NULL DEFAULT '' CHECK (length(share_id) <= 80),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_task22_session_owner
ON task22_upload_sessions (owner_kind, owner_ref, state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task22_session_expiry
ON task22_upload_sessions (state, expires_at);

CREATE TABLE IF NOT EXISTS task22_upload_files (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 80),
    session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 16 AND 80),
    relative_path TEXT NOT NULL CHECK (length(relative_path) BETWEEN 1 AND 512),
    file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream' CHECK (length(mime_type) <= 120),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    part_size INTEGER NOT NULL DEFAULT 16777216 CHECK (part_size BETWEEN 5242880 AND 33554432),
    part_count INTEGER NOT NULL CHECK (part_count >= 1),
    sha256_hex TEXT NOT NULL DEFAULT '' CHECK (length(sha256_hex) IN (0, 64)),
    preview_policy TEXT NOT NULL CHECK (preview_policy IN ('preview', 'download_only')),
    state TEXT NOT NULL DEFAULT 'allocated' CHECK (state IN ('allocated', 'complete')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task22_file_session
ON task22_upload_files (session_id, relative_path);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task22_file_path
ON task22_upload_files (session_id, relative_path);

CREATE TABLE IF NOT EXISTS task22_upload_parts (
    session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 16 AND 80),
    file_id TEXT NOT NULL CHECK (length(file_id) BETWEEN 16 AND 80),
    part_number INTEGER NOT NULL CHECK (part_number >= 1),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    sha256_hex TEXT NOT NULL DEFAULT '' CHECK (length(sha256_hex) IN (0, 64)),
    object_key TEXT NOT NULL CHECK (length(object_key) BETWEEN 16 AND 320),
    uploaded_at TEXT NOT NULL,
    PRIMARY KEY (session_id, file_id, part_number)
);

CREATE INDEX IF NOT EXISTS idx_task22_part_key
ON task22_upload_parts (object_key);

CREATE TABLE IF NOT EXISTS task22_shares (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 80),
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'guest')),
    owner_ref TEXT NOT NULL CHECK (length(owner_ref) BETWEEN 8 AND 96),
    password_hash TEXT NOT NULL DEFAULT '' CHECK (length(password_hash) <= 512),
    total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
    file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
    max_downloads INTEGER NOT NULL DEFAULT 5 CHECK (max_downloads BETWEEN 1 AND 100),
    download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
    one_time INTEGER NOT NULL DEFAULT 0 CHECK (one_time IN (0, 1)),
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked', 'delete_pending', 'deleted')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT '',
    deletion_reason TEXT NOT NULL DEFAULT '' CHECK (length(deletion_reason) <= 80),
    cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
    cleanup_retry_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_task22_share_owner
ON task22_shares (owner_kind, owner_ref, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task22_share_expiry
ON task22_shares (state, expires_at, cleanup_retry_at);

CREATE TABLE IF NOT EXISTS task22_share_files (
    share_id TEXT NOT NULL CHECK (length(share_id) BETWEEN 16 AND 80),
    file_id TEXT NOT NULL CHECK (length(file_id) BETWEEN 16 AND 80),
    relative_path TEXT NOT NULL CHECK (length(relative_path) BETWEEN 1 AND 512),
    file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream' CHECK (length(mime_type) <= 120),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    part_size INTEGER NOT NULL DEFAULT 16777216 CHECK (part_size BETWEEN 5242880 AND 33554432),
    part_count INTEGER NOT NULL CHECK (part_count >= 1),
    sha256_hex TEXT NOT NULL DEFAULT '' CHECK (length(sha256_hex) IN (0, 64)),
    preview_policy TEXT NOT NULL CHECK (preview_policy IN ('preview', 'download_only')),
    PRIMARY KEY (share_id, file_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task22_share_file_path
ON task22_share_files (share_id, relative_path);

CREATE TABLE IF NOT EXISTS task22_download_grants (
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
    last_used_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_task22_grant_expiry
ON task22_download_grants (expires_at, state);

CREATE INDEX IF NOT EXISTS idx_task22_grant_share
ON task22_download_grants (share_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task22_usage_daily (
    owner_ref TEXT NOT NULL CHECK (length(owner_ref) BETWEEN 8 AND 96),
    usage_date TEXT NOT NULL CHECK (length(usage_date) = 10),
    create_count INTEGER NOT NULL DEFAULT 0 CHECK (create_count >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_ref, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_task22_usage_date
ON task22_usage_daily (usage_date);
