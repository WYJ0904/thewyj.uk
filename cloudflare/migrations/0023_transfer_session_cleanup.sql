/* Additive Task 22 cleanup state. Keep the Task 22 schema marker at 2 so the
   currently deployed Pages code remains available while this migration lands. */
ALTER TABLE task22_upload_sessions ADD COLUMN cleanup_state TEXT NOT NULL DEFAULT ''
    CHECK (cleanup_state IN ('', 'pending', 'complete'));
ALTER TABLE task22_upload_sessions ADD COLUMN cleanup_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (cleanup_attempts >= 0);
ALTER TABLE task22_upload_sessions ADD COLUMN cleanup_retry_at TEXT NOT NULL DEFAULT '';
ALTER TABLE task22_upload_sessions ADD COLUMN cleanup_completed_at TEXT NOT NULL DEFAULT '';

UPDATE task22_upload_sessions
SET cleanup_state = 'pending'
WHERE state IN ('aborted', 'expired', 'failed');

CREATE INDEX IF NOT EXISTS idx_task22_session_cleanup
ON task22_upload_sessions (cleanup_state, cleanup_retry_at, state);
