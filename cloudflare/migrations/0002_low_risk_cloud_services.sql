CREATE TABLE IF NOT EXISTS task11_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO task11_metadata (key, value, updated_at)
VALUES ('schema_version', '1', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS task11_changelog_entries (
    version TEXT PRIMARY KEY CHECK (length(version) BETWEEN 1 AND 80),
    build TEXT NOT NULL UNIQUE CHECK (length(build) BETWEEN 1 AND 120),
    release_date TEXT NOT NULL CHECK (length(release_date) = 10),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
    features_json TEXT NOT NULL DEFAULT '[]',
    improvements_json TEXT NOT NULL DEFAULT '[]',
    fixes_json TEXT NOT NULL DEFAULT '[]',
    security_json TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    source_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task11_changelog_release
ON task11_changelog_entries (release_date DESC, sort_order ASC, version DESC);

CREATE TABLE IF NOT EXISTS task11_feedback_items (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    username TEXT NOT NULL CHECK (length(username) BETWEEN 1 AND 80),
    feedback_type TEXT NOT NULL CHECK (feedback_type IN (
        'feature_suggestion', 'tool_error', 'page_issue',
        'account_issue', 'new_tool', 'other'
    )),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
    route TEXT NOT NULL DEFAULT '' CHECK (length(route) <= 180),
    tool_id TEXT NOT NULL DEFAULT '' CHECK (length(tool_id) <= 80),
    app_version TEXT NOT NULL DEFAULT '' CHECK (length(app_version) <= 80),
    browser_info TEXT NOT NULL DEFAULT '' CHECK (length(browser_info) <= 240),
    error_code TEXT NOT NULL DEFAULT '' CHECK (length(error_code) <= 80),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'viewed', 'accepted', 'completed', 'rejected'
    )),
    admin_note TEXT NOT NULL DEFAULT '' CHECK (length(admin_note) <= 1000),
    merged_into_id TEXT NOT NULL DEFAULT '' CHECK (length(merged_into_id) <= 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task11_feedback_owner
ON task11_feedback_items (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task11_feedback_admin
ON task11_feedback_items (status, feedback_type, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task11_feedback_public
ON task11_feedback_items (feedback_type, status, updated_at DESC)
WHERE merged_into_id = '';

CREATE INDEX IF NOT EXISTS idx_task11_feedback_merge
ON task11_feedback_items (merged_into_id)
WHERE merged_into_id != '';

CREATE TABLE IF NOT EXISTS task11_feedback_votes (
    feedback_id TEXT NOT NULL,
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    created_at TEXT NOT NULL,
    PRIMARY KEY (feedback_id, user_id),
    FOREIGN KEY (feedback_id) REFERENCES task11_feedback_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task11_feedback_votes_user
ON task11_feedback_votes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task11_feedback_audit_logs (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
    actor_user_id TEXT NOT NULL CHECK (length(actor_user_id) BETWEEN 1 AND 80),
    actor_username TEXT NOT NULL CHECK (length(actor_username) BETWEEN 1 AND 80),
    action TEXT NOT NULL CHECK (action IN (
        'feedback_update', 'feedback_merge', 'feedback_delete_spam', 'feedback_import'
    )),
    feedback_id TEXT NOT NULL CHECK (length(feedback_id) BETWEEN 1 AND 64),
    target_user_id TEXT NOT NULL DEFAULT '' CHECK (length(target_user_id) <= 80),
    before_json TEXT NOT NULL DEFAULT '{}',
    after_json TEXT NOT NULL DEFAULT '{}',
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task11_feedback_audit_created
ON task11_feedback_audit_logs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_task11_feedback_audit_item
ON task11_feedback_audit_logs (feedback_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task11_learning_sync_records (
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    data_type TEXT NOT NULL CHECK (data_type IN (
        'wrong_book', 'achievement', 'test_history',
        'daily_goal', 'language_settings', 'learning_config'
    )),
    record_id TEXT NOT NULL CHECK (length(record_id) BETWEEN 1 AND 700),
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 8 AND 80),
    client_version TEXT NOT NULL CHECK (length(client_version) BETWEEN 1 AND 80),
    server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
    created_at TEXT NOT NULL,
    server_updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, data_type, record_id)
);

CREATE INDEX IF NOT EXISTS idx_task11_sync_records_pull
ON task11_learning_sync_records (user_id, data_type, deleted, server_version);

CREATE TABLE IF NOT EXISTS task11_learning_sync_heads (
    user_id TEXT PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 80),
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task11_learning_sync_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 80),
    user_version INTEGER NOT NULL CHECK (user_version > 0),
    data_type TEXT NOT NULL CHECK (data_type IN (
        'wrong_book', 'achievement', 'test_history',
        'daily_goal', 'language_settings', 'learning_config'
    )),
    record_id TEXT NOT NULL CHECK (length(record_id) BETWEEN 1 AND 700),
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 8 AND 80),
    client_version TEXT NOT NULL CHECK (length(client_version) BETWEEN 1 AND 80),
    mutation_id TEXT NOT NULL CHECK (length(mutation_id) BETWEEN 1 AND 120),
    created_at TEXT NOT NULL,
    UNIQUE (user_id, user_version),
    UNIQUE (user_id, mutation_id)
);

CREATE INDEX IF NOT EXISTS idx_task11_sync_changes_pull
ON task11_learning_sync_changes (user_id, user_version ASC);

CREATE TABLE IF NOT EXISTS task11_usage_buckets (
    time_bucket TEXT NOT NULL CHECK (length(time_bucket) = 13),
    feature_id TEXT NOT NULL CHECK (length(feature_id) BETWEEN 1 AND 64),
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
    latency_bucket TEXT NOT NULL CHECK (latency_bucket IN (
        'lt_100', '100_499', '500_1999', 'gte_2000', 'unknown'
    )),
    error_code TEXT NOT NULL DEFAULT '' CHECK (length(error_code) <= 64),
    event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (time_bucket, feature_id, outcome, latency_bucket, error_code)
);

CREATE INDEX IF NOT EXISTS idx_task11_usage_recent
ON task11_usage_buckets (time_bucket DESC, feature_id, outcome);
