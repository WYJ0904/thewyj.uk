/* READ ONLY: run after official 0025 apply, before any flag is enabled.
   Required: one ledger row, four tables, four indexes, one immutable trigger,
   three exact metadata values and five OFF/0%/Experimental-only definitions.
   If flags were previously configured, compare the approved before/after
   snapshot instead: migration replay must preserve those operator settings. */
SELECT name, applied_at FROM wyj_d1_migrations
 WHERE name='0025_adaptive_learning_mastery.sql';
SELECT key, value FROM task26_metadata ORDER BY key;
SELECT name, type, sql FROM sqlite_master
 WHERE name GLOB 'task26_*' OR name GLOB 'idx_task26_*'
 ORDER BY type, name;
PRAGMA table_info(task26_question_tickets);
PRAGMA table_info(task26_learning_events);
PRAGMA table_info(task26_mastery_states);
PRAGMA foreign_key_list(task26_question_tickets);
PRAGMA foreign_key_list(task26_learning_events);
PRAGMA foreign_key_list(task26_mastery_states);
SELECT flag_key, enabled, kill_switch, channels_json, rollout_basis_points, revision
 FROM task25_feature_flags
 WHERE flag_key IN ('adaptive_learning','mastery_score','adaptive_review',
                   'ai_error_explanation','similar_word_explanation')
 ORDER BY flag_key;
SELECT COUNT(*) AS invalid_mastery_rows FROM task26_mastery_states
 WHERE algorithm_version!='mastery-v1' OR state_version!=1
    OR score<0 OR score>100 OR confidence<0 OR confidence>1
    OR NOT json_valid(state_json);
SELECT COUNT(*) AS invalid_ticket_rows FROM task26_question_tickets
 WHERE algorithm_version!='mastery-v1' OR course_version!='aeris-language-v1'
    OR NOT json_valid(question_json) OR NOT json_valid(point_json)
    OR (receipt_json IS NOT NULL AND NOT json_valid(receipt_json));
SELECT COUNT(*) AS pending_projection_receipts FROM task26_question_tickets
 WHERE outcome_event_id IS NOT NULL AND receipt_json IS NULL;
