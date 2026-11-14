/* Additive Task27 migration. Never reapply or edit 0026-0034 for this feature. */
CREATE TABLE task27_security (
    user_id TEXT PRIMARY KEY REFERENCES task12_users(id) ON DELETE CASCADE,
    verified_email TEXT NOT NULL DEFAULT '' COLLATE NOCASE CHECK(length(verified_email) <= 254),
    email_verified_at TEXT NOT NULL DEFAULT '',
    mfa_method TEXT NOT NULL DEFAULT 'none' CHECK(mfa_method IN ('none','email','totp')),
    totp_ciphertext TEXT NOT NULL DEFAULT '',
    totp_last_step INTEGER NOT NULL DEFAULT -1,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    password_changed_at TEXT NOT NULL DEFAULT '',
    password_age_start_at TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1)),
    password_notice_at TEXT NOT NULL DEFAULT '',
    mfa_broadcast_at TEXT NOT NULL DEFAULT '',
    CHECK(mfa_method != 'email' OR (verified_email != '' AND email_verified_at != '')),
    CHECK(mfa_method != 'totp' OR totp_ciphertext != '')
);
CREATE UNIQUE INDEX task27_verified_email_unique ON task27_security(verified_email) WHERE verified_email != '';
INSERT INTO task27_security(user_id,password_age_start_at)
SELECT id,strftime('%Y-%m-%dT%H:%M:%SZ','now') FROM task12_users;

ALTER TABLE task12_sessions ADD COLUMN public_id TEXT NOT NULL DEFAULT '';
UPDATE task12_sessions SET public_id = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX task27_web_session_public_id ON task12_sessions(public_id) WHERE public_id != '';
CREATE TRIGGER task27_web_session_id AFTER INSERT ON task12_sessions WHEN NEW.public_id = ''
BEGIN
  UPDATE task12_sessions SET public_id = lower(hex(randomblob(16))) WHERE token_digest = NEW.token_digest;
END;

CREATE TABLE task27_challenges (
    token_digest TEXT PRIMARY KEY,
    user_id TEXT REFERENCES task12_users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('login','email_bind','mfa_setup','stepup','grant','password_reset','password_change','mfa_recovery','inbox_read_all','email_preview')),
    method TEXT NOT NULL CHECK(method IN ('none','email','totp','recovery')),
    code_hash TEXT NOT NULL DEFAULT '',
    session_digest TEXT NOT NULL DEFAULT '',
    session_version INTEGER NOT NULL DEFAULT 0,
    security_version INTEGER NOT NULL DEFAULT 0,
    scope TEXT NOT NULL DEFAULT '' CHECK(length(scope) <= 200),
    context_json TEXT NOT NULL DEFAULT '{}' CHECK(length(context_json) <= 16000),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX task27_challenges_user ON task27_challenges(user_id,kind,created_at DESC);
CREATE INDEX task27_challenges_expiry ON task27_challenges(expires_at);
CREATE TABLE task27_recovery_codes (
    user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(user_id,code_hash)
);
/* An assertion failure rolls back the entire D1 batch. No guard survives a commit. */
CREATE TABLE task27_atomic_guard (id TEXT PRIMARY KEY, passed INTEGER NOT NULL CHECK(passed = 1));
CREATE TABLE task27_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 80),
    request_id TEXT NOT NULL DEFAULT '' CHECK(length(request_id) <= 120),
    created_at TEXT NOT NULL
);
CREATE INDEX task27_events_user ON task27_events(user_id,created_at DESC,id DESC);
CREATE TABLE task27_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
    message_type TEXT NOT NULL,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
    event_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT NOT NULL DEFAULT '',
    UNIQUE(user_id,event_key)
);
CREATE INDEX task27_notifications_user ON task27_notifications(user_id,read_at,created_at DESC,id DESC);

ALTER TABLE admin_messages ADD COLUMN delivery_channel TEXT NOT NULL DEFAULT 'broadcast' CHECK(delivery_channel IN ('broadcast','inbox'));
ALTER TABLE admin_messages ADD COLUMN purpose TEXT NOT NULL DEFAULT 'general' CHECK(purpose IN ('general','version_update','policy_change','mfa_advice'));
ALTER TABLE admin_messages ADD COLUMN audience_condition TEXT NOT NULL DEFAULT '' CHECK(audience_condition IN ('','mfa_disabled'));
ALTER TABLE admin_message_receipts ADD COLUMN read_at TEXT NOT NULL DEFAULT '';
CREATE INDEX task27_message_channel ON admin_messages(delivery_channel,status,created_at DESC);

CREATE TABLE task27_policy_consents (
    user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
    terms_version TEXT NOT NULL,
    privacy_version TEXT NOT NULL,
    security_version TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    request_id TEXT NOT NULL DEFAULT '' CHECK(length(request_id) <= 120),
    PRIMARY KEY(user_id,terms_version,privacy_version,security_version)
);

CREATE TABLE task27_email_drafts (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL REFERENCES task12_users(id),
    subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 160),
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 8000),
    recipient_ids_json TEXT NOT NULL CHECK(length(recipient_ids_json) <= 2000),
    revision INTEGER NOT NULL DEFAULT 1,
    thread_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sending','sent','partial')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE task27_email_jobs (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES task27_email_drafts(id),
    user_id TEXT NOT NULL REFERENCES task12_users(id),
    recipient_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','queued','provider_delivered','rejected','failed','unknown')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
    provider_message_id TEXT NOT NULL DEFAULT '',
    error_code TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE(draft_id,user_id)
);
CREATE INDEX task27_email_jobs_draft ON task27_email_jobs(draft_id,status);

INSERT INTO task12_metadata(key,value,updated_at)
VALUES('task27_schema_version','1',strftime('%Y-%m-%dT%H:%M:%SZ','now'));
/* Existing accounts are grandfathered until an explicitly reviewed material update. */
INSERT INTO task12_metadata(key,value,updated_at)
VALUES('task27_require_policy_reaccept','0',strftime('%Y-%m-%dT%H:%M:%SZ','now'));
