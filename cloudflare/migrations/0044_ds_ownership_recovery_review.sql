/* Additive ownership review schema. Existing permanent recovery holds remain authoritative. */
CREATE TABLE IF NOT EXISTS aeris_ds_ownership_recovery_versions (
  user_id TEXT PRIMARY KEY REFERENCES task12_users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1)
) STRICT;

INSERT OR IGNORE INTO aeris_ds_ownership_recovery_versions (user_id,event_id,generation)
SELECT user_id,id,1 FROM (
  SELECT user_id,id,ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC,id DESC) AS newest
  FROM task27_events WHERE event_type='password_recovered'
) WHERE newest=1;

CREATE TRIGGER IF NOT EXISTS aeris_ds_ownership_review_recovery_version
AFTER INSERT ON task27_events WHEN NEW.event_type='password_recovered'
BEGIN
  INSERT INTO aeris_ds_ownership_recovery_versions(user_id,event_id,generation)
  VALUES(NEW.user_id,NEW.id,1)
  ON CONFLICT(user_id) DO UPDATE SET event_id=excluded.event_id,generation=generation+1;
END;

CREATE TABLE IF NOT EXISTS aeris_ds_ownership_review_cases (
  id TEXT PRIMARY KEY CHECK (length(id)=43),
  attempt_digest TEXT NOT NULL UNIQUE CHECK (length(attempt_digest)=71),
  actor_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
  actor_grant TEXT NOT NULL CHECK (length(actor_grant)=43),
  ds_user_id TEXT NOT NULL,
  ds_scope TEXT NOT NULL CHECK (length(ds_scope)=43),
  target_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE CHECK (target_id!=actor_id),
  target_session_version INTEGER NOT NULL CHECK (target_session_version>=1),
  target_security_version INTEGER NOT NULL CHECK (target_security_version>=1),
  recovery_event_id TEXT NOT NULL,
  recovery_generation INTEGER NOT NULL CHECK (recovery_generation>=1),
  purpose TEXT NOT NULL CHECK (purpose='ds_account_ownership_recovery_review_v1'),
  state TEXT NOT NULL CHECK (state IN ('UNDER_REVIEW','MORE_EVIDENCE_REQUIRED','DENIED','APPROVED_FOR_REAUTH','REVOKED','CLOSED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>=1),
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at>requested_at AND expires_at<=requested_at+14400),
  approval_expires_at INTEGER,
  changed_at INTEGER NOT NULL,
  CHECK (state!='APPROVED_FOR_REAUTH' OR approval_expires_at IS NOT NULL)
) STRICT;

CREATE INDEX IF NOT EXISTS aeris_ds_ownership_review_actor ON aeris_ds_ownership_review_cases(actor_grant,ds_scope,requested_at);
CREATE INDEX IF NOT EXISTS aeris_ds_ownership_review_queue ON aeris_ds_ownership_review_cases(state,expires_at,requested_at);

CREATE TABLE IF NOT EXISTS aeris_ds_ownership_reviewers (
  id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
  case_scope TEXT NOT NULL CHECK (case_scope='*' OR length(case_scope)=43),
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at>=granted_at)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS aeris_ds_ownership_reviewer_active
ON aeris_ds_ownership_reviewers(reviewer_id,case_scope) WHERE revoked_at IS NULL;

CREATE TRIGGER IF NOT EXISTS aeris_ds_ownership_reviewer_immutable
BEFORE UPDATE ON aeris_ds_ownership_reviewers WHEN OLD.id IS NOT NEW.id OR OLD.reviewer_id IS NOT NEW.reviewer_id
  OR OLD.case_scope IS NOT NEW.case_scope OR OLD.granted_at IS NOT NEW.granted_at
  OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
BEGIN
  SELECT RAISE(ABORT,'invalid reviewer authorization change');
END;

CREATE TABLE IF NOT EXISTS aeris_ds_ownership_review_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES aeris_ds_ownership_review_cases(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('UNDER_REVIEW','MORE_EVIDENCE_REQUIRED','DENIED','APPROVED_FOR_REAUTH','REVOKED','CLOSED','evidence','more_evidence','deny','approve','revoke')),
  reviewer_id TEXT,
  authority_id TEXT,
  reviewer_session_version INTEGER,
  reviewer_security_version INTEGER,
  reason_code TEXT,
  evidence_digest TEXT CHECK (evidence_digest IS NULL OR length(evidence_digest)=71),
  occurred_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS aeris_ds_ownership_review_events_case ON aeris_ds_ownership_review_events(case_id,revision,kind);

CREATE UNIQUE INDEX IF NOT EXISTS aeris_ds_ownership_review_approve_once
ON aeris_ds_ownership_review_events(case_id,revision,reviewer_id) WHERE kind='approve';

CREATE TRIGGER IF NOT EXISTS aeris_ds_ownership_review_requested
AFTER INSERT ON aeris_ds_ownership_review_cases
BEGIN
  INSERT INTO aeris_ds_ownership_review_events(id,case_id,revision,kind,occurred_at)
  VALUES(lower(hex(randomblob(16))),NEW.id,NEW.revision,NEW.state,NEW.changed_at);
END;

CREATE TRIGGER IF NOT EXISTS aeris_ds_ownership_review_transition
AFTER UPDATE OF state ON aeris_ds_ownership_review_cases WHEN OLD.state!=NEW.state
BEGIN
  INSERT INTO aeris_ds_ownership_review_events(id,case_id,revision,kind,occurred_at)
  VALUES(lower(hex(randomblob(16))),NEW.id,NEW.revision,NEW.state,NEW.changed_at);
END;

CREATE TABLE IF NOT EXISTS aeris_ds_ownership_review_receipts (
  case_id TEXT PRIMARY KEY REFERENCES aeris_ds_ownership_review_cases(id) ON DELETE CASCADE,
  proof_id TEXT NOT NULL UNIQUE REFERENCES aeris_ds_ownership_proofs(proof_id) ON DELETE CASCADE
) STRICT;

CREATE TRIGGER IF NOT EXISTS aeris_ds_ownership_review_receipt_consume
AFTER INSERT ON aeris_ds_ownership_review_receipts
BEGIN
  UPDATE aeris_ds_ownership_review_cases SET state='CLOSED',changed_at=unixepoch()
  WHERE id=NEW.case_id AND state='APPROVED_FOR_REAUTH';
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'review approval already closed') END;
END;
