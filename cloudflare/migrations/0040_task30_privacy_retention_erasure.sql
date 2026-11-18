/* Task30: Privacy Control, Data Retention Policy, and Verifiable Secure Erasure */

CREATE TABLE IF NOT EXISTS task30_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO task30_metadata (key, value, updated_at)
VALUES ('schema_version', '2026-11-18-v1', '2026-11-18T00:00:00.000Z');

CREATE TABLE IF NOT EXISTS task30_user_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
  consent_key TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 0 CHECK (granted IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('granted', 'revoked', 'not_configured')),
  scope TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  granted_at TEXT,
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (user_id, consent_key)
);

CREATE INDEX IF NOT EXISTS idx_task30_consents_user
  ON task30_user_consents(user_id, consent_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS task30_erasure_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('category_erasure', 'account_erasure', 'consent_revocation', 'cleanup_run')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('category', 'account')),
  categories_json TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL CHECK (mode IN ('preview', 'commit')),
  status TEXT NOT NULL CHECK (status IN (
    'requested',
    'verified',
    'access_revoked',
    'cleanup_pending',
    'completed',
    'retry_pending',
    'partially_completed',
    'blocked_by_retention',
    'failed',
    'cancelled'
  )),
  idempotency_key TEXT,
  confirmation_text TEXT,
  stepup_scope TEXT,
  stepup_verified INTEGER NOT NULL DEFAULT 0 CHECK (stepup_verified IN (0, 1)),
  access_revoked_at TEXT,
  requested_by TEXT NOT NULL,
  request_id TEXT NOT NULL,
  preview_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  exception_summary_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task30_requests_user_created
  ON task30_erasure_requests(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task30_requests_user_idempotency
  ON task30_erasure_requests(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task30_requests_status
  ON task30_erasure_requests(status, next_retry_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS task30_erasure_tasks (
  id TEXT PRIMARY KEY,
  request_id_ref TEXT NOT NULL REFERENCES task30_erasure_requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('d1_records', 'r2_object', 'r2_multipart', 'share_revoke', 'sync_tombstone', 'session_revoke')),
  target_ref TEXT NOT NULL,
  r2_key TEXT,
  upload_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'access_revoked', 'cleaning', 'completed', 'retry_pending', 'blocked_by_retention', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task30_tasks_request
  ON task30_erasure_tasks(request_id_ref, status, updated_at ASC);

CREATE INDEX IF NOT EXISTS idx_task30_tasks_pending
  ON task30_erasure_tasks(user_id, status, category_key);

CREATE TABLE IF NOT EXISTS task30_erasure_generations (
  user_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  last_erasure_request_id TEXT,
  last_erasure_at TEXT NOT NULL,
  PRIMARY KEY (user_id, category_key)
);

CREATE TABLE IF NOT EXISTS task30_erasure_tombstones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  tombstone_level TEXT NOT NULL DEFAULT 'permanent_erasure' CHECK (tombstone_level IN ('soft_delete', 'permanent_erasure')),
  erasure_request_id TEXT,
  reason TEXT NOT NULL,
  tombstone_generation INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_task30_tombstones_lookup
  ON task30_erasure_tombstones(user_id, entity_type, entity_key);

CREATE INDEX IF NOT EXISTS idx_task30_tombstones_expiry
  ON task30_erasure_tombstones(expires_at);

CREATE TABLE IF NOT EXISTS task30_cleanup_runs (
  id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('manual', 'scheduled', 'api', 'post_erasure')),
  triggered_by TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  environment TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  next_scheduled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task30_cleanup_runs_started
  ON task30_cleanup_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS task30_privacy_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  category_key TEXT,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task30_privacy_audit_user
  ON task30_privacy_audit(user_id, created_at DESC);

INSERT OR IGNORE INTO task25_feature_flags (
  flag_key,
  description,
  enabled,
  kill_switch,
  channels_json,
  rollout_basis_points,
  revision,
  updated_at,
  updated_by,
  mutation_id,
  request_id
)
VALUES (
  'task30_privacy_v1',
  'Task30 隐私控制、数据留存与安全删除中心',
  1,
  0,
  '["production","preview","local"]',
  10000,
  1,
  '2026-11-18T00:00:00.000Z',
  NULL,
  'seed-task30-privacy-v1',
  'seed-task30-privacy-v1'
);
