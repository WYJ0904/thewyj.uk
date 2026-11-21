/* Uses Task12 and Task27 and adds no objects to their tables.
   Preview may apply this file via a scoped ledger before 0038–0040.
   Idempotent DDL lets the canonical ledger record 0041 in order later. */
CREATE TABLE IF NOT EXISTS aeris_ds_sso_requests (
  request_digest TEXT PRIMARY KEY NOT NULL,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
  session_digest TEXT NOT NULL,
  session_version INTEGER NOT NULL,
  security_version INTEGER NOT NULL,
  browser_state TEXT NOT NULL CHECK (length(browser_state) = 43),
  code_challenge TEXT NOT NULL CHECK (length(code_challenge) = 43),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  code_digest TEXT UNIQUE,
  code_expires_at INTEGER,
  exchanged_at INTEGER,
  issued_grant_id TEXT UNIQUE,
  CHECK ((code_digest IS NULL) = (code_expires_at IS NULL)),
  CHECK ((exchanged_at IS NULL) = (issued_grant_id IS NULL))
) STRICT;

CREATE INDEX IF NOT EXISTS aeris_ds_sso_requests_expiry ON aeris_ds_sso_requests(expires_at);
CREATE INDEX IF NOT EXISTS aeris_ds_sso_requests_user ON aeris_ds_sso_requests(user_id);

CREATE TABLE IF NOT EXISTS aeris_ds_sso_grants (
  grant_id TEXT PRIMARY KEY NOT NULL CHECK (length(grant_id) = 43),
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
  session_digest TEXT NOT NULL,
  session_version INTEGER NOT NULL,
  security_version INTEGER NOT NULL,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  security_policy_version TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > issued_at),
  revoked_at INTEGER,
  revoke_reason TEXT CHECK (revoke_reason IN ('expired', 'source_invalid')),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
) STRICT;

CREATE INDEX IF NOT EXISTS aeris_ds_sso_grants_expiry ON aeris_ds_sso_grants(expires_at);
CREATE INDEX IF NOT EXISTS aeris_ds_sso_grants_user ON aeris_ds_sso_grants(user_id);
