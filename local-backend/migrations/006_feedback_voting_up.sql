CREATE TABLE IF NOT EXISTS feedback_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    feedback_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    route TEXT NOT NULL DEFAULT '',
    tool_id TEXT NOT NULL DEFAULT '',
    app_version TEXT NOT NULL DEFAULT '',
    browser_info TEXT NOT NULL DEFAULT '',
    error_code TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT NOT NULL DEFAULT '',
    merged_into_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK(feedback_type IN (
        'feature_suggestion', 'tool_error', 'page_issue',
        'account_issue', 'new_tool', 'other'
    )),
    CHECK(status IN ('pending', 'viewed', 'accepted', 'completed', 'rejected'))
);

CREATE INDEX IF NOT EXISTS feedback_items_user_idx
    ON feedback_items(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_items_admin_idx
    ON feedback_items(status, feedback_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS feedback_items_merge_idx
    ON feedback_items(merged_into_id) WHERE merged_into_id != '';

CREATE TABLE IF NOT EXISTS feedback_votes (
    feedback_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(feedback_id, user_id),
    FOREIGN KEY(feedback_id) REFERENCES feedback_items(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS feedback_votes_user_idx
    ON feedback_votes(user_id, created_at DESC);

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES ('006_feedback_voting', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
