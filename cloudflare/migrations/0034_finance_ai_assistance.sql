/* P06 assistance is separate from transaction facts, source events and receipts.
   Additive and idempotent; never rewrites any existing financial table. */
CREATE TABLE IF NOT EXISTS finance_ai_consents (
  user_id TEXT PRIMARY KEY REFERENCES task12_users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS finance_ai_observations (
  user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
  hint_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  anchor_digest TEXT NOT NULL,
  input_json TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 2),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,hint_id)
);
CREATE TABLE IF NOT EXISTS finance_ai_decisions (
  user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
  hint_id TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  model_version TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  consent_revision INTEGER NOT NULL,
  lease_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','suggestion','review','rejected','failed','timed_out','invalidated')),
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  provider_calls INTEGER NOT NULL DEFAULT 0 CHECK(provider_calls BETWEEN 0 AND 2),
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK(latency_ms >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,hint_id,input_digest,model_version)
);
CREATE TABLE IF NOT EXISTS finance_ai_budgets (
  period_key TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  reserved_calls INTEGER NOT NULL DEFAULT 0 CHECK(reserved_calls >= 0),
  provider_calls INTEGER NOT NULL DEFAULT 0 CHECK(provider_calls >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(period_key,scope_key)
);
CREATE INDEX IF NOT EXISTS finance_ai_decisions_account_time
  ON finance_ai_decisions(user_id,updated_at);
