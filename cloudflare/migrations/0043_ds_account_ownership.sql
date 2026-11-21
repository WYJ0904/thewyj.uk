/* Additive to the canonical chain and the isolated DS Provider Preview ledger. */
CREATE TABLE IF NOT EXISTS aeris_ds_ownership_recovery_holds (
  user_id TEXT PRIMARY KEY REFERENCES task12_users(id) ON DELETE CASCADE
) STRICT;

/* Retain a hold even if the security event is later removed under retention policy. */
INSERT OR IGNORE INTO aeris_ds_ownership_recovery_holds (user_id)
SELECT DISTINCT user_id FROM task27_events WHERE event_type = 'password_recovered';

CREATE TRIGGER IF NOT EXISTS aeris_ds_ownership_hold_after_recovery
AFTER INSERT ON task27_events
WHEN NEW.event_type = 'password_recovered'
BEGIN
  INSERT OR IGNORE INTO aeris_ds_ownership_recovery_holds (user_id) VALUES (NEW.user_id);
END;

CREATE TABLE IF NOT EXISTS aeris_ds_ownership_proofs (
  proof_id TEXT PRIMARY KEY CHECK (length(proof_id) = 43),
  attempt_digest TEXT NOT NULL UNIQUE CHECK (length(attempt_digest) = 71 AND substr(attempt_digest, 1, 7) = 'sha256$'),
  actor_grant TEXT NOT NULL CHECK (length(actor_grant) = 43),
  target_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
  target_session_version INTEGER NOT NULL CHECK (target_session_version >= 1),
  target_security_version INTEGER NOT NULL CHECK (target_security_version >= 1),
  method TEXT NOT NULL CHECK (method IN ('none', 'totp', 'email')),
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  security_policy_version TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > issued_at AND expires_at <= issued_at + 600)
) STRICT;

CREATE INDEX IF NOT EXISTS aeris_ds_ownership_proofs_expiry ON aeris_ds_ownership_proofs(expires_at);
CREATE INDEX IF NOT EXISTS aeris_ds_ownership_proofs_target ON aeris_ds_ownership_proofs(target_id);
