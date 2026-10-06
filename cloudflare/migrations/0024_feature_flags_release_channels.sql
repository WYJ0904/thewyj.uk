/* Task 25: additive, idempotent infrastructure. Never updates business data or
   Stable Android release metadata. All seeded features are globally OFF. */
CREATE TABLE IF NOT EXISTS task25_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task25_feature_flags (
    flag_key TEXT PRIMARY KEY CHECK (length(flag_key) BETWEEN 2 AND 64),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    kill_switch INTEGER NOT NULL DEFAULT 0 CHECK (kill_switch IN (0, 1)),
    channels_json TEXT NOT NULL DEFAULT '["experimental"]'
        CHECK (json_valid(channels_json) AND json_type(channels_json) = 'array'),
    rollout_basis_points INTEGER NOT NULL DEFAULT 10000 CHECK (rollout_basis_points BETWEEN 0 AND 10000),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    updated_at TEXT NOT NULL,
    updated_by TEXT,
    mutation_id TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (updated_by) REFERENCES task12_users(id)
);

CREATE TABLE IF NOT EXISTS task25_user_flag_overrides (
    flag_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    enabled INTEGER CHECK (enabled IS NULL OR enabled IN (0, 1)),
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    request_id TEXT NOT NULL,
    PRIMARY KEY (flag_key, user_id),
    FOREIGN KEY (flag_key) REFERENCES task25_feature_flags(flag_key),
    FOREIGN KEY (user_id) REFERENCES task12_users(id),
    FOREIGN KEY (updated_by) REFERENCES task12_users(id)
);
CREATE INDEX IF NOT EXISTS idx_task25_overrides_user ON task25_user_flag_overrides(user_id, flag_key);

CREATE TABLE IF NOT EXISTS task25_release_preferences (
    user_id TEXT PRIMARY KEY,
    channel TEXT NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'beta', 'experimental')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES task12_users(id)
);

CREATE TABLE IF NOT EXISTS task25_flag_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flag_key TEXT NOT NULL,
    target_user_id TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    request_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS task25_flag_limit
BEFORE INSERT ON task25_feature_flags
WHEN NOT EXISTS (SELECT 1 FROM task25_feature_flags WHERE flag_key = NEW.flag_key)
 AND (SELECT COUNT(*) FROM task25_feature_flags) >= 200
BEGIN SELECT RAISE(ABORT, 'task25_flag_limit'); END;

CREATE TRIGGER IF NOT EXISTS task25_flag_insert_audit
AFTER INSERT ON task25_feature_flags WHEN NEW.updated_by IS NOT NULL
BEGIN
    INSERT INTO task25_flag_audit(flag_key, actor_user_id, action, before_json, after_json, request_id, created_at)
    VALUES(NEW.flag_key, NEW.updated_by, 'create', '{}',
        json_object('description', NEW.description, 'enabled', NEW.enabled, 'kill_switch', NEW.kill_switch,
            'channels', json(NEW.channels_json), 'rollout_basis_points', NEW.rollout_basis_points, 'revision', NEW.revision),
        NEW.request_id, NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS task25_flag_update_audit
AFTER UPDATE ON task25_feature_flags WHEN NEW.updated_by IS NOT NULL
BEGIN
    INSERT INTO task25_flag_audit(flag_key, actor_user_id, action, before_json, after_json, request_id, created_at)
    VALUES(NEW.flag_key, NEW.updated_by, 'update',
        json_object('description', OLD.description, 'enabled', OLD.enabled, 'kill_switch', OLD.kill_switch,
            'channels', json(OLD.channels_json), 'rollout_basis_points', OLD.rollout_basis_points, 'revision', OLD.revision),
        json_object('description', NEW.description, 'enabled', NEW.enabled, 'kill_switch', NEW.kill_switch,
            'channels', json(NEW.channels_json), 'rollout_basis_points', NEW.rollout_basis_points, 'revision', NEW.revision),
        NEW.request_id, NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS task25_override_insert_audit
AFTER INSERT ON task25_user_flag_overrides
BEGIN
    INSERT INTO task25_flag_audit(flag_key, target_user_id, actor_user_id, action, before_json, after_json, request_id, created_at)
    VALUES(NEW.flag_key, NEW.user_id, NEW.updated_by, 'override', '{}',
        json_object('enabled', NEW.enabled), NEW.request_id, NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS task25_override_update_audit
AFTER UPDATE ON task25_user_flag_overrides
BEGIN
    INSERT INTO task25_flag_audit(flag_key, target_user_id, actor_user_id, action, before_json, after_json, request_id, created_at)
    VALUES(NEW.flag_key, NEW.user_id, NEW.updated_by, 'override',
        json_object('enabled', OLD.enabled), json_object('enabled', NEW.enabled), NEW.request_id, NEW.updated_at);
END;

INSERT OR IGNORE INTO task25_feature_flags(flag_key, description, channels_json, rollout_basis_points, updated_at)
VALUES ('task25_validation', 'Harmless validation flag; no business data effects.', '["stable","beta","experimental"]', 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
INSERT OR IGNORE INTO task25_feature_flags(flag_key, description, updated_at)
VALUES ('aeris_experimental_badge', 'Cosmetic preview badge only.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
INSERT OR IGNORE INTO task25_metadata(key, value) VALUES ('schema_version', '1');
