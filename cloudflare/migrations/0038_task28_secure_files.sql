/* Additive metadata on the existing authorities. No object moves or quota table. */
ALTER TABLE task22_upload_sessions ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'share'
    CHECK (access_scope IN ('share', 'private'));
ALTER TABLE task22_upload_sessions ADD COLUMN finalize_token TEXT NOT NULL DEFAULT '';
ALTER TABLE task22_upload_sessions ADD COLUMN finalize_until TEXT NOT NULL DEFAULT '';
ALTER TABLE task22_upload_sessions ADD COLUMN cleanup_progress TEXT NOT NULL DEFAULT '{}';
ALTER TABLE task22_upload_sessions ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_task28_upload_idempotency ON task22_upload_sessions(owner_kind,owner_ref,idempotency_key)
    WHERE idempotency_key!='';
ALTER TABLE task22_shares ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'share'
    CHECK (access_scope IN ('share', 'private'));
ALTER TABLE task22_shares ADD COLUMN cleanup_progress TEXT NOT NULL DEFAULT '{}';
ALTER TABLE task22_download_grants ADD COLUMN file_id TEXT NOT NULL DEFAULT '';
ALTER TABLE task22_upload_files ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE task22_upload_files ADD COLUMN detected_mime TEXT NOT NULL DEFAULT '';
ALTER TABLE task22_upload_files ADD COLUMN integrity_status TEXT NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE task22_share_files ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE task22_share_files ADD COLUMN detected_mime TEXT NOT NULL DEFAULT '';
ALTER TABLE task22_share_files ADD COLUMN integrity_status TEXT NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE task22_upload_parts ADD COLUMN hash_verified INTEGER NOT NULL DEFAULT 0
    CHECK (hash_verified IN (0, 1));
ALTER TABLE task14_shares ADD COLUMN upload_token TEXT NOT NULL DEFAULT '';
ALTER TABLE task14_shares ADD COLUMN upload_until TEXT NOT NULL DEFAULT '';
ALTER TABLE task14_shares ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE task14_shares ADD COLUMN integrity_status TEXT NOT NULL DEFAULT 'legacy_unverified';

CREATE TABLE task28_file_events (
    id TEXT PRIMARY KEY,
    actor_ref TEXT NOT NULL DEFAULT '' CHECK (length(actor_ref) <= 96),
    resource_id TEXT NOT NULL CHECK (length(resource_id) <= 80),
    action TEXT NOT NULL CHECK (length(action) <= 48),
    outcome TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'pending', 'denied', 'failed')),
    created_at TEXT NOT NULL
);
CREATE INDEX idx_task28_file_events_resource ON task28_file_events(resource_id, created_at);
CREATE INDEX idx_task28_file_events_created ON task28_file_events(created_at);

/* Failed allocation rollback has no upload_file row; retain its MPU identifier
   for the existing Task22 cron, without creating a second storage authority. */
CREATE TABLE task28_multipart_cleanup (
    upload_id TEXT PRIMARY KEY,
    intent_kind TEXT NOT NULL DEFAULT 'abort' CHECK(intent_kind IN ('abort','create_unknown')),
    session_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    retry_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX idx_task28_multipart_cleanup_retry ON task28_multipart_cleanup(intent_kind,retry_at, created_at);

INSERT INTO task22_metadata(key, value) VALUES ('task28_schema_version', '1');
