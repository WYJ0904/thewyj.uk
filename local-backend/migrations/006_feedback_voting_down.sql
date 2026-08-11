DROP TABLE IF EXISTS feedback_votes;
DROP TABLE IF EXISTS feedback_items;

DELETE FROM schema_migrations
WHERE version = '006_feedback_voting';
