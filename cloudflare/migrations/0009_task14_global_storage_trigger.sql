CREATE TRIGGER IF NOT EXISTS task14_global_storage_before_insert
BEFORE INSERT ON task14_shares
WHEN NEW.share_type = 'file'
 AND NEW.state IN ('uploading', 'active', 'delete_pending')
 AND (
    SELECT COALESCE(SUM(size_bytes), 0) FROM task14_shares
    WHERE share_type = 'file' AND state IN ('uploading', 'active', 'delete_pending')
 ) + NEW.size_bytes > 5368709120
BEGIN
    SELECT RAISE(ABORT, 'task14_global_storage_quota');
END;
