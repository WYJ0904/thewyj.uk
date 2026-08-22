DROP TRIGGER IF EXISTS task12_sessions_limit_after_insert;

CREATE TRIGGER IF NOT EXISTS task12_sessions_limit_after_insert
AFTER INSERT ON task12_sessions
BEGIN
    DELETE FROM task12_sessions
    WHERE token_digest IN (
        SELECT token_digest
        FROM task12_sessions
        WHERE user_id = NEW.user_id AND revoked = 0
        ORDER BY rowid DESC
        LIMIT -1 OFFSET 12
    );
END;
