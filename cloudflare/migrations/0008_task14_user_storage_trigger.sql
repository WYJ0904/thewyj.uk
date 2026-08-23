CREATE TRIGGER IF NOT EXISTS task14_user_storage_before_insert
BEFORE INSERT ON task14_shares
WHEN NEW.share_type = 'file'
 AND NEW.state IN ('uploading', 'active', 'delete_pending')
 AND (
    SELECT COALESCE(SUM(size_bytes), 0) FROM task14_shares
    WHERE owner_user_id = NEW.owner_user_id AND share_type = 'file'
      AND state IN ('uploading', 'active', 'delete_pending')
 ) + NEW.size_bytes > 524288000
BEGIN
    SELECT RAISE(ABORT, 'task14_user_storage_quota');
END;
