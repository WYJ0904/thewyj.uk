CREATE TABLE IF NOT EXISTS task18_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task18_admin_roles (
    user_id TEXT PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 80),
    role TEXT NOT NULL CHECK (role = 'admin'),
    granted_by_user_id TEXT NOT NULL CHECK (length(granted_by_user_id) BETWEEN 1 AND 80),
    granted_by_username TEXT NOT NULL CHECK (length(granted_by_username) BETWEEN 1 AND 80),
    granted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by_user_id) REFERENCES task12_users(id)
);

CREATE INDEX IF NOT EXISTS idx_task18_admin_roles_granted
ON task18_admin_roles (granted_at DESC, user_id);

CREATE TRIGGER IF NOT EXISTS task18_single_owner_insert
BEFORE INSERT ON task12_users
WHEN NEW.role = 'super_admin'
  AND EXISTS (SELECT 1 FROM task12_users WHERE role = 'super_admin')
BEGIN
    SELECT RAISE(ABORT, 'task18_single_owner_required');
END;

CREATE TRIGGER IF NOT EXISTS task18_single_owner_update
BEFORE UPDATE OF role ON task12_users
WHEN NEW.role = 'super_admin'
  AND OLD.role != 'super_admin'
  AND EXISTS (SELECT 1 FROM task12_users WHERE role = 'super_admin' AND id != NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'task18_single_owner_required');
END;

CREATE TRIGGER IF NOT EXISTS task18_owner_role_protected
BEFORE UPDATE OF role ON task12_users
WHEN OLD.role = 'super_admin' AND NEW.role != 'super_admin'
BEGIN
    SELECT RAISE(ABORT, 'task18_owner_role_protected');
END;

CREATE TRIGGER IF NOT EXISTS task18_owner_state_protected
BEFORE UPDATE OF banned, permanent_ban, deleted ON task12_users
WHEN OLD.role = 'super_admin'
  AND (NEW.banned != 0 OR NEW.permanent_ban != 0 OR NEW.deleted != 0)
BEGIN
    SELECT RAISE(ABORT, 'task18_owner_state_protected');
END;

CREATE TRIGGER IF NOT EXISTS task18_owner_delete_protected
BEFORE DELETE ON task12_users
WHEN OLD.role = 'super_admin'
BEGIN
    SELECT RAISE(ABORT, 'task18_owner_delete_protected');
END;

CREATE TRIGGER IF NOT EXISTS task18_admin_role_target_guard_insert
BEFORE INSERT ON task18_admin_roles
WHEN NOT EXISTS (
    SELECT 1 FROM task12_users
    WHERE id = NEW.user_id AND role = 'user' AND banned = 0 AND deleted = 0
)
BEGIN
    SELECT RAISE(ABORT, 'task18_admin_role_target_invalid');
END;

CREATE TRIGGER IF NOT EXISTS task18_admin_role_target_guard_update
BEFORE UPDATE OF user_id, role ON task18_admin_roles
WHEN NOT EXISTS (
    SELECT 1 FROM task12_users
    WHERE id = NEW.user_id AND role = 'user' AND banned = 0 AND deleted = 0
)
BEGIN
    SELECT RAISE(ABORT, 'task18_admin_role_target_invalid');
END;

CREATE TRIGGER IF NOT EXISTS task18_admin_account_state_guard
BEFORE UPDATE OF banned, permanent_ban, deleted ON task12_users
WHEN (NEW.banned != 0 OR NEW.permanent_ban != 0 OR NEW.deleted != 0)
  AND EXISTS (SELECT 1 FROM task18_admin_roles WHERE user_id = OLD.id)
BEGIN
    SELECT RAISE(ABORT, 'task18_admin_role_must_be_revoked');
END;

CREATE TRIGGER IF NOT EXISTS task18_admin_account_delete_guard
BEFORE DELETE ON task12_users
WHEN EXISTS (SELECT 1 FROM task18_admin_roles WHERE user_id = OLD.id)
BEGIN
    SELECT RAISE(ABORT, 'task18_admin_role_must_be_revoked');
END;

CREATE TABLE IF NOT EXISTS task18_admin_role_audit (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    actor_user_id TEXT NOT NULL CHECK (length(actor_user_id) BETWEEN 1 AND 80),
    actor_username TEXT NOT NULL CHECK (length(actor_username) BETWEEN 1 AND 80),
    actor_role TEXT NOT NULL CHECK (actor_role = 'super_admin'),
    target_user_id TEXT NOT NULL CHECK (length(target_user_id) BETWEEN 1 AND 80),
    target_username TEXT NOT NULL CHECK (length(target_username) BETWEEN 1 AND 80),
    action TEXT NOT NULL CHECK (action IN ('admin_grant', 'admin_revoke')),
    before_role TEXT NOT NULL CHECK (before_role IN ('user', 'admin')),
    after_role TEXT NOT NULL CHECK (after_role IN ('user', 'admin')),
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    request_id TEXT NOT NULL DEFAULT '' CHECK (length(request_id) <= 120),
    created_at TEXT NOT NULL,
    FOREIGN KEY (actor_user_id) REFERENCES task12_users(id),
    FOREIGN KEY (target_user_id) REFERENCES task12_users(id)
);

CREATE INDEX IF NOT EXISTS idx_task18_role_audit_created
ON task18_admin_role_audit (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task18_role_audit_target
ON task18_admin_role_audit (target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task18_admin_action_audit (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    actor_user_id TEXT NOT NULL CHECK (length(actor_user_id) BETWEEN 1 AND 80),
    actor_username TEXT NOT NULL CHECK (length(actor_username) BETWEEN 1 AND 80),
    actor_role TEXT NOT NULL CHECK (actor_role IN ('admin', 'super_admin')),
    target_type TEXT NOT NULL DEFAULT '' CHECK (length(target_type) <= 40),
    target_id TEXT NOT NULL DEFAULT '' CHECK (length(target_id) <= 120),
    target_label TEXT NOT NULL DEFAULT '' CHECK (length(target_label) <= 120),
    action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    before_json TEXT NOT NULL DEFAULT '{}' CHECK (length(before_json) <= 12000),
    after_json TEXT NOT NULL DEFAULT '{}' CHECK (length(after_json) <= 12000),
    error_code TEXT NOT NULL DEFAULT '' CHECK (length(error_code) <= 120),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    request_id TEXT NOT NULL DEFAULT '' CHECK (length(request_id) <= 120),
    created_at TEXT NOT NULL,
    FOREIGN KEY (actor_user_id) REFERENCES task12_users(id)
);

CREATE INDEX IF NOT EXISTS idx_task18_action_audit_created
ON task18_admin_action_audit (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task18_action_audit_actor
ON task18_admin_action_audit (actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_messages (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    message_type TEXT NOT NULL DEFAULT 'normal' CHECK (message_type IN (
        'normal', 'important', 'maintenance', 'account'
    )),
    sender_user_id TEXT NOT NULL CHECK (length(sender_user_id) BETWEEN 1 AND 80),
    sender_username TEXT NOT NULL CHECK (length(sender_username) BETWEEN 1 AND 80),
    sender_role TEXT NOT NULL CHECK (sender_role IN ('admin', 'super_admin')),
    target_scope TEXT NOT NULL CHECK (target_scope IN ('single', 'multiple', 'all')),
    requires_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (requires_confirmation IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    expires_at TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 120),
    recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count BETWEEN 0 AND 1000000),
    request_id TEXT NOT NULL DEFAULT '' CHECK (length(request_id) <= 120),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT NOT NULL DEFAULT '',
    revoked_by_user_id TEXT NOT NULL DEFAULT '' CHECK (length(revoked_by_user_id) <= 80),
    FOREIGN KEY (sender_user_id) REFERENCES task12_users(id),
    UNIQUE (sender_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_admin_messages_active
ON admin_messages (status, expires_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_messages_sender
ON admin_messages (sender_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_message_recipients (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES admin_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_message_recipients_user
ON admin_message_recipients (user_id, created_at DESC, message_id);

CREATE TABLE IF NOT EXISTS admin_message_receipts (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    first_seen_at TEXT NOT NULL DEFAULT '',
    dismissed_at TEXT NOT NULL DEFAULT '',
    acknowledged_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES admin_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_message_receipts_user
ON admin_message_receipts (user_id, updated_at DESC, message_id);

INSERT INTO task18_metadata (key, value, updated_at)
VALUES ('schema_version', '1', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
