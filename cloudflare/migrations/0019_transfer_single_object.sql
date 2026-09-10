ALTER TABLE task22_upload_files ADD COLUMN object_key TEXT NOT NULL DEFAULT '';
ALTER TABLE task22_upload_files ADD COLUMN upload_id TEXT NOT NULL DEFAULT '';
ALTER TABLE task22_upload_parts ADD COLUMN etag TEXT NOT NULL DEFAULT '';
ALTER TABLE task22_share_files ADD COLUMN object_key TEXT NOT NULL DEFAULT '';

UPDATE task22_metadata
SET value = '2', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';
