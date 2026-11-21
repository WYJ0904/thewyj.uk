-- Dedicated DS merge journal. Task 13/16/21 data remains in the owning ledgers.
CREATE TABLE aeris_ds_merge_sandbox (
  sandbox_id TEXT PRIMARY KEY CHECK (length(sandbox_id)=43)
) STRICT;
CREATE TABLE aeris_ds_merge_test_accounts (
  subject TEXT PRIMARY KEY REFERENCES task12_users(id),
  sandbox_id TEXT NOT NULL REFERENCES aeris_ds_merge_sandbox(sandbox_id)
) STRICT;

CREATE TABLE aeris_ds_merges (
  id TEXT PRIMARY KEY CHECK (length(id)=43),
  version TEXT NOT NULL CHECK (length(version)=43),
  issuer TEXT NOT NULL,
  client_origin TEXT NOT NULL,
  sandbox_id TEXT NOT NULL REFERENCES aeris_ds_merge_sandbox(sandbox_id),
  actor_id TEXT NOT NULL REFERENCES task12_users(id),
  keep_id TEXT NOT NULL REFERENCES task12_users(id),
  config_id TEXT NOT NULL REFERENCES task12_users(id),
  members_json TEXT NOT NULL CHECK (json_valid(members_json) AND json_array_length(members_json) BETWEEN 2 AND 17),
  state TEXT NOT NULL DEFAULT 'REGISTERED' CHECK (state IN ('REGISTERED','STAGED','COMMITTED','COMPENSATED')),
  snapshot_digest TEXT CHECK (snapshot_digest IS NULL OR length(snapshot_digest)=64),
  summary_json TEXT CHECK (summary_json IS NULL OR json_valid(summary_json)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  changed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (state NOT IN ('STAGED','COMMITTED') OR (snapshot_digest IS NOT NULL AND summary_json IS NOT NULL))
) STRICT;
CREATE TABLE aeris_ds_merge_aborts (
  id TEXT PRIMARY KEY CHECK (length(id)=43),
  version TEXT NOT NULL CHECK (length(version)=43),
  sandbox_id TEXT NOT NULL REFERENCES aeris_ds_merge_sandbox(sandbox_id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

CREATE TABLE aeris_ds_merge_consents (
  merge_id TEXT NOT NULL REFERENCES aeris_ds_merges(id),
  subject TEXT NOT NULL REFERENCES task12_users(id),
  version TEXT NOT NULL CHECK (length(version)=43),
  purpose TEXT NOT NULL CHECK (purpose='ds_finance_reconciliation_v1'),
  grant_id TEXT NOT NULL REFERENCES aeris_ds_sso_grants(grant_id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at>created_at AND expires_at<=created_at+600),
  revoked_at INTEGER,
  PRIMARY KEY (merge_id,subject)
) STRICT;
CREATE TABLE aeris_ds_merge_receipts (
  merge_id TEXT NOT NULL REFERENCES aeris_ds_merges(id),
  kind TEXT NOT NULL CHECK(kind IN ('FINANCE','MEMBERSHIP')),
  subject TEXT NOT NULL REFERENCES task12_users(id),
  original_id TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (merge_id,kind,subject,original_id)
) STRICT;

-- Only a trusted provider adapter may issue a fact. This synthetic deployment
-- seeds facts through its isolated fixture. No browser or backchannel setter.
CREATE TABLE aeris_ds_merge_finance_facts (
  transaction_id TEXT NOT NULL REFERENCES task16_finance_transactions(id),
  revision INTEGER NOT NULL CHECK (revision>=1),
  subject TEXT NOT NULL REFERENCES aeris_ds_merge_test_accounts(subject),
  provider TEXT NOT NULL,
  provider_account TEXT NOT NULL,
  operation_ref TEXT NOT NULL,
  parent_ref TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('expense','income','refund','transfer','reversal')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  currency TEXT NOT NULL CHECK(length(currency)=3),
  amount_exponent INTEGER NOT NULL CHECK(amount_exponent BETWEEN 0 AND 4),
  evidence_digest TEXT NOT NULL CHECK(length(evidence_digest)=64),
  PRIMARY KEY (transaction_id,revision)
) STRICT;

CREATE TABLE aeris_ds_merge_conflicts (
  merge_id TEXT NOT NULL REFERENCES aeris_ds_merges(id),
  id TEXT NOT NULL CHECK(length(id)=64),
  kind TEXT NOT NULL,
  source_refs TEXT NOT NULL CHECK(json_valid(source_refs)),
  evidence_digest TEXT NOT NULL CHECK(length(evidence_digest)=64),
  blocking INTEGER NOT NULL CHECK(blocking IN (0,1)),
  suggestion TEXT NOT NULL CHECK(suggestion='KEEP_DISTINCT_OR_STOP'),
  state TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(state IN ('NEEDS_REVIEW','REVIEWED')),
  decision TEXT CHECK(decision IS NULL OR decision='KEEP_DISTINCT'),
  reviewer_id TEXT REFERENCES task12_users(id),
  reason TEXT,
  reviewed_at INTEGER,
  PRIMARY KEY (merge_id,id),
  CHECK ((state='REVIEWED')=(decision IS NOT NULL AND reviewer_id IS NOT NULL AND reason IS NOT NULL AND reviewed_at IS NOT NULL))
) STRICT;
CREATE TABLE aeris_ds_merge_reviewers (
  merge_id TEXT NOT NULL REFERENCES aeris_ds_merges(id),
  reviewer_id TEXT NOT NULL REFERENCES aeris_ds_merge_test_accounts(subject),
  assigned_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER,
  PRIMARY KEY (merge_id,reviewer_id)
) STRICT;
CREATE TABLE aeris_ds_merge_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  merge_id TEXT NOT NULL REFERENCES aeris_ds_merges(id),
  kind TEXT NOT NULL,
  actor_id TEXT REFERENCES task12_users(id),
  detail TEXT,
  occurred_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE INDEX aeris_ds_merge_events_by_merge ON aeris_ds_merge_events(merge_id,seq);

CREATE TRIGGER aeris_ds_merge_registered AFTER INSERT ON aeris_ds_merges BEGIN
  INSERT INTO aeris_ds_merge_events(merge_id,kind,actor_id) VALUES(NEW.id,NEW.state,NEW.actor_id);
END;
CREATE TRIGGER aeris_ds_merge_transition BEFORE UPDATE ON aeris_ds_merges
WHEN OLD.state<>NEW.state AND NOT (
  (OLD.state='REGISTERED' AND NEW.state='STAGED')
  OR (OLD.state='STAGED' AND NEW.state='COMMITTED')
  OR (OLD.state IN ('REGISTERED','STAGED','COMMITTED') AND NEW.state='COMPENSATED')
) BEGIN
  SELECT RAISE(ABORT,'invalid Aeris merge transition');
END;
CREATE TRIGGER aeris_ds_merge_advanced AFTER UPDATE OF state ON aeris_ds_merges
WHEN OLD.state<>NEW.state BEGIN
  INSERT INTO aeris_ds_merge_events(merge_id,kind,detail) VALUES(NEW.id,NEW.state,NEW.snapshot_digest);
END;
CREATE TRIGGER aeris_ds_merge_consent_created AFTER INSERT ON aeris_ds_merge_consents BEGIN
  INSERT INTO aeris_ds_merge_events(merge_id,kind,actor_id,detail)
  VALUES(NEW.merge_id,'FINANCE_READ_CONSENT',NEW.subject,NEW.purpose);
END;
CREATE TRIGGER aeris_ds_merge_consent_changed AFTER UPDATE ON aeris_ds_merge_consents BEGIN
  INSERT INTO aeris_ds_merge_events(merge_id,kind,actor_id,detail)
  VALUES(NEW.merge_id,IIF(NEW.revoked_at IS NULL,'FINANCE_READ_CONSENT','FINANCE_READ_WITHDRAWN'),NEW.subject,NEW.purpose);
END;
CREATE TRIGGER aeris_ds_merge_conflict_reviewed AFTER UPDATE OF state ON aeris_ds_merge_conflicts
WHEN OLD.state='NEEDS_REVIEW' AND NEW.state='REVIEWED' BEGIN
  INSERT INTO aeris_ds_merge_events(merge_id,kind,actor_id,detail)
  VALUES(NEW.merge_id,'CONFLICT_REVIEWED',NEW.reviewer_id,NEW.id);
END;
