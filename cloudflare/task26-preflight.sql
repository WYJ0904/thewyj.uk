/* READ ONLY: run against the explicitly selected Preview database before 0025.
   This deliberately requires the existing ledger and Task25 prerequisites.
   Missing/partial prerequisites block migration; this file never repairs them.
   No user records, answers, sessions or business contents are exported. */
SELECT name, applied_at FROM wyj_d1_migrations ORDER BY id;
SELECT name, type, sql FROM sqlite_master
 WHERE name GLOB 'task26_*' OR name GLOB 'idx_task26_*'
 ORDER BY type, name;
SELECT key, value FROM task25_metadata ORDER BY key;
PRAGMA table_info(task12_users);
PRAGMA table_info(task25_feature_flags);
PRAGMA table_info(task26_metadata);
PRAGMA table_info(task26_question_tickets);
PRAGMA table_info(task26_learning_events);
PRAGMA table_info(task26_mastery_states);
SELECT flag_key, enabled, kill_switch, channels_json, rollout_basis_points, revision
 FROM task25_feature_flags
 WHERE flag_key IN ('adaptive_learning','mastery_score','adaptive_review',
                   'ai_error_explanation','similar_word_explanation')
 ORDER BY flag_key;
