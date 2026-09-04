CREATE TABLE IF NOT EXISTS task20_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO task20_metadata (key, value, updated_at)
VALUES ('schema_version', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS task20_device_sessions (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 80),
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    device_id_digest TEXT NOT NULL CHECK (length(device_id_digest) = 64),
    refresh_token_digest TEXT NOT NULL UNIQUE
        CHECK (length(refresh_token_digest) = 71 AND refresh_token_digest LIKE 'sha256$%'),
    access_token_digest TEXT NOT NULL
        CHECK (length(access_token_digest) = 71 AND access_token_digest LIKE 'sha256$%'),
    session_version INTEGER NOT NULL CHECK (session_version >= 1),
    rotation_counter INTEGER NOT NULL DEFAULT 0 CHECK (rotation_counter >= 0),
    last_rotation_key TEXT NOT NULL DEFAULT '' CHECK (length(last_rotation_key) <= 80),
    app_version TEXT NOT NULL DEFAULT '' CHECK (length(app_version) <= 40),
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    access_expires_at TEXT NOT NULL,
    refresh_expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
    revoked_at TEXT NOT NULL DEFAULT '',
    revoke_reason TEXT NOT NULL DEFAULT '' CHECK (length(revoke_reason) <= 80),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task20_device_sessions_user
ON task20_device_sessions (user_id, revoked, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_task20_device_sessions_device
ON task20_device_sessions (device_id_digest, revoked, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_task20_device_sessions_expiry
ON task20_device_sessions (refresh_expires_at, revoked);

CREATE TABLE IF NOT EXISTS task20_used_refresh_tokens (
    token_digest TEXT PRIMARY KEY
        CHECK (length(token_digest) = 71 AND token_digest LIKE 'sha256$%'),
    session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 16 AND 80),
    rotation_key TEXT NOT NULL CHECK (length(rotation_key) BETWEEN 8 AND 80),
    used_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES task20_device_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task20_used_refresh_session
ON task20_used_refresh_tokens (session_id, used_at DESC);

CREATE INDEX IF NOT EXISTS idx_task20_used_refresh_expiry
ON task20_used_refresh_tokens (expires_at);

CREATE TRIGGER IF NOT EXISTS task20_device_session_cleanup_after_delete
AFTER DELETE ON task20_device_sessions
BEGIN
    DELETE FROM task12_sessions WHERE token_digest = OLD.access_token_digest;
END;

CREATE TRIGGER IF NOT EXISTS task20_device_session_limit_after_insert
AFTER INSERT ON task20_device_sessions
BEGIN
    DELETE FROM task20_device_sessions
    WHERE id IN (
        SELECT id
        FROM task20_device_sessions
        WHERE user_id = NEW.user_id AND revoked = 0
        ORDER BY last_seen_at DESC, id DESC
        LIMIT -1 OFFSET 8
    );
END;
