CREATE TABLE IF NOT EXISTS task12_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO task12_metadata (key, value, updated_at)
VALUES ('schema_version', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS task12_users (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    username TEXT NOT NULL CHECK (length(username) BETWEEN 1 AND 40),
    username_normalized TEXT NOT NULL UNIQUE CHECK (length(username_normalized) BETWEEN 1 AND 80),
    password_hash TEXT NOT NULL DEFAULT '' CHECK (length(password_hash) <= 512),
    password_scheme TEXT NOT NULL DEFAULT 'pbkdf2_sha256' CHECK (password_scheme IN (
        'pbkdf2_sha256', 'reset_required', 'invalid'
    )),
    password_iterations INTEGER NOT NULL DEFAULT 0 CHECK (password_iterations BETWEEN 0 AND 2000000),
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'super_admin')),
    banned INTEGER NOT NULL DEFAULT 0 CHECK (banned IN (0, 1)),
    permanent_ban INTEGER NOT NULL DEFAULT 0 CHECK (permanent_ban IN (0, 1)),
    ban_reason TEXT NOT NULL DEFAULT '' CHECK (length(ban_reason) <= 500),
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
    registered_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_task12_users_state
ON task12_users (deleted, banned, registered_at DESC);

CREATE INDEX IF NOT EXISTS idx_task12_users_role
ON task12_users (role, username_normalized);

CREATE TABLE IF NOT EXISTS task12_sessions (
    token_digest TEXT PRIMARY KEY CHECK (length(token_digest) = 71 AND token_digest LIKE 'sha256$%'),
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    session_version INTEGER NOT NULL CHECK (session_version >= 1),
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
    revoked_at TEXT NOT NULL DEFAULT '',
    client_kind TEXT NOT NULL DEFAULT '' CHECK (length(client_kind) <= 40),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task12_sessions_user
ON task12_sessions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task12_sessions_expiry
ON task12_sessions (expires_at, revoked);

CREATE TABLE IF NOT EXISTS task12_login_audit_logs (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    user_id TEXT NOT NULL DEFAULT '' CHECK (length(user_id) <= 80),
    username TEXT NOT NULL DEFAULT '' CHECK (length(username) <= 40),
    success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
    reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 80),
    ip_address TEXT NOT NULL DEFAULT '' CHECK (length(ip_address) <= 80),
    country TEXT NOT NULL DEFAULT '' CHECK (length(country) <= 80),
    region TEXT NOT NULL DEFAULT '' CHECK (length(region) <= 120),
    city TEXT NOT NULL DEFAULT '' CHECK (length(city) <= 120),
    user_agent TEXT NOT NULL DEFAULT '' CHECK (length(user_agent) <= 400),
    source TEXT NOT NULL DEFAULT 'cloudflare_pages' CHECK (length(source) <= 40),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task12_login_audit_created
ON task12_login_audit_logs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task12_login_audit_user
ON task12_login_audit_logs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task12_account_audit_logs (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    actor_user_id TEXT NOT NULL CHECK (length(actor_user_id) BETWEEN 1 AND 80),
    actor_username TEXT NOT NULL CHECK (length(actor_username) BETWEEN 1 AND 40),
    target_user_id TEXT NOT NULL DEFAULT '' CHECK (length(target_user_id) <= 80),
    target_username TEXT NOT NULL DEFAULT '' CHECK (length(target_username) <= 40),
    action TEXT NOT NULL CHECK (action IN (
        'password_change', 'password_reset', 'ban', 'unban',
        'force_logout', 'self_delete', 'admin_delete', 'account_import'
    )),
    before_json TEXT NOT NULL DEFAULT '{}',
    after_json TEXT NOT NULL DEFAULT '{}',
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task12_account_audit_created
ON task12_account_audit_logs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task12_account_audit_target
ON task12_account_audit_logs (target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task12_auth_failure_windows (
    bucket_key TEXT PRIMARY KEY CHECK (length(bucket_key) = 64),
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task12_auth_failure_expiry
ON task12_auth_failure_windows (expires_at);
