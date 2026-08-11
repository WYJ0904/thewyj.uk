DROP TABLE IF EXISTS learning_sync_changes;
DROP TABLE IF EXISTS learning_sync_heads;
DROP TABLE IF EXISTS learning_sync_records;
DELETE FROM schema_migrations WHERE version = '007_learning_sync';
