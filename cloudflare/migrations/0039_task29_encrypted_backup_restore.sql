/* Additive Task29 migration: user-level export metadata, restore job state machine,
   durable restore idempotency, and privacy-safe audit logs.
   Does not duplicate or alter existing business ledger or notification tables. */

CREATE TABLE IF NOT EXISTS task29_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO task29_metadata (key, value, updated_at)
VALUES
    ('schema_version', '1', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ('task29_backup_v1', 'enabled', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS task29_backup_exports (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('json', 'csv', 'encrypted')),
    schema_version TEXT NOT NULL,
    container_version INTEGER,
    scopes_json TEXT NOT NULL,
    counts_json TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
    payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
    cutoff_finance_version INTEGER NOT NULL DEFAULT 0 CHECK (cutoff_finance_version >= 0),
    cutoff_notification_at TEXT NOT NULL DEFAULT '',
    secure_file_id TEXT NOT NULL DEFAULT '',
    byte_length INTEGER NOT NULL DEFAULT 0 CHECK (byte_length >= 0),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task29_exports_owner_time
ON task29_backup_exports (user_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS task29_restore_jobs (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
    backup_sha256 TEXT NOT NULL CHECK (length(backup_sha256) = 64),
    manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
    payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
    source_export_id TEXT NOT NULL DEFAULT '',
    schema_version TEXT NOT NULL,
    container_version INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL CHECK (state IN (
        'prechecked',
        'confirmed',
        'applying',
        'completed',
        'failed',
        'cancelled',
        'rolled_back'
    )),
    conflict_policy TEXT NOT NULL DEFAULT 'skip_identical_reject_conflict' CHECK (conflict_policy IN (
        'skip_identical_reject_conflict',
        'skip_all_existing'
    )),
    scopes_json TEXT NOT NULL,
    precheck_summary_json TEXT NOT NULL,
    diff_preview_json TEXT NOT NULL,
    staged_plan_json TEXT NOT NULL,
    applied_log_json TEXT NOT NULL DEFAULT '[]',
    result_summary_json TEXT NOT NULL DEFAULT '',
    total_batches INTEGER NOT NULL DEFAULT 0 CHECK (total_batches >= 0),
    completed_batches INTEGER NOT NULL DEFAULT 0 CHECK (completed_batches >= 0),
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    stepup_grant_jti TEXT NOT NULL DEFAULT '',
    stepup_consumed_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_task29_jobs_owner_time
ON task29_restore_jobs (user_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_task29_jobs_owner_state
ON task29_restore_jobs (user_id, state, expires_at);

CREATE TABLE IF NOT EXISTS task29_restore_idempotency (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 120),
    backup_sha256 TEXT NOT NULL CHECK (length(backup_sha256) = 64),
    payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
    conflict_policy TEXT NOT NULL,
    job_id TEXT NOT NULL REFERENCES task29_restore_jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('completed', 'in_progress')),
    result_summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, idempotency_key),
    UNIQUE (user_id, payload_sha256, conflict_policy)
);

CREATE TABLE IF NOT EXISTS task29_backup_audit (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL DEFAULT '',
    export_id TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
    outcome TEXT NOT NULL CHECK (length(outcome) BETWEEN 1 AND 40),
    details_json TEXT NOT NULL DEFAULT '{}',
    request_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task29_audit_owner_time
ON task29_backup_audit (user_id, created_at DESC, id);
