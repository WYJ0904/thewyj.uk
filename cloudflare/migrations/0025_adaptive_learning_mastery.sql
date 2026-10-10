/* Additive Task26. No legacy learning, account, business or Android data changes.
   Seeds preserve existing operator settings on replay. */
CREATE TABLE IF NOT EXISTS task26_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO task26_metadata(key,value) VALUES
 ('schema_version','1'),('algorithm_version','mastery-v1'),('course_version','aeris-language-v1')
 ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS task26_question_tickets(
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES task12_users(id),
 language TEXT NOT NULL CHECK(language IN ('english','japanese')),
 knowledge_id TEXT NOT NULL,
 question_id TEXT NOT NULL,
 question_json TEXT NOT NULL CHECK(json_valid(question_json)),
 point_json TEXT NOT NULL CHECK(json_valid(point_json)),
 course_version TEXT NOT NULL,
 algorithm_version TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('adaptive','weak','review')),
 issued_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 outcome_event_id TEXT,
 receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json))
);
CREATE INDEX IF NOT EXISTS idx_task26_tickets_user ON task26_question_tickets(user_id,language,issued_at,id);

CREATE TABLE IF NOT EXISTS task26_learning_events(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id TEXT NOT NULL REFERENCES task12_users(id),
 event_id TEXT NOT NULL CHECK(length(event_id) BETWEEN 8 AND 128),
 ticket_id TEXT NOT NULL REFERENCES task26_question_tickets(id),
 language TEXT NOT NULL CHECK(language IN ('english','japanese')),
 knowledge_id TEXT NOT NULL,
 question_id TEXT NOT NULL,
 family TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('question_shown','answer_submitted','answer_correct','answer_incorrect','answer_changed','retry','review_started','review_completed','skipped','timeout','explanation_opened')),
 correct INTEGER CHECK(correct IS NULL OR correct IN (0,1)),
 response_ms INTEGER NOT NULL DEFAULT 0 CHECK(response_ms BETWEEN 0 AND 600000),
 timing_verified INTEGER NOT NULL DEFAULT 0 CHECK(timing_verified IN (0,1)),
 difficulty INTEGER NOT NULL CHECK(difficulty BETWEEN 1 AND 5),
 accepted_at TEXT NOT NULL,
 algorithm_version TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('adaptive','weak','review')),
 platform TEXT NOT NULL CHECK(platform IN ('browser','native','webview')),
 channel TEXT NOT NULL CHECK(channel IN ('stable','beta','experimental')),
 input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 answer_digest TEXT NOT NULL DEFAULT '',
 mistake_code TEXT NOT NULL DEFAULT '',
 UNIQUE(user_id,event_id)
);
CREATE INDEX IF NOT EXISTS idx_task26_events_point ON task26_learning_events(user_id,language,knowledge_id,seq);
CREATE INDEX IF NOT EXISTS idx_task26_events_user ON task26_learning_events(user_id,kind,seq);
CREATE TRIGGER IF NOT EXISTS task26_events_immutable
 BEFORE UPDATE ON task26_learning_events BEGIN SELECT RAISE(ABORT,'task26_events_immutable'); END;

CREATE TABLE IF NOT EXISTS task26_mastery_states(
 user_id TEXT NOT NULL REFERENCES task12_users(id),
 language TEXT NOT NULL CHECK(language IN ('english','japanese')),
 knowledge_id TEXT NOT NULL,
 score REAL NOT NULL CHECK(score BETWEEN 0 AND 100),
 confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 next_review_at TEXT,
 algorithm_version TEXT NOT NULL,
 state_version INTEGER NOT NULL,
 last_event_seq INTEGER NOT NULL CHECK(last_event_seq>=0),
 state_json TEXT NOT NULL CHECK(json_valid(state_json)),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,language,knowledge_id)
);
CREATE INDEX IF NOT EXISTS idx_task26_review ON task26_mastery_states(user_id,language,next_review_at);

INSERT INTO task25_feature_flags(flag_key,description,enabled,kill_switch,channels_json,rollout_basis_points,updated_at) VALUES
 ('adaptive_learning','自适应语言练习',0,0,'["experimental"]',0,'2026-10-10T00:00:00.000Z'),
 ('mastery_score','知识点掌握度',0,0,'["experimental"]',0,'2026-10-10T00:00:00.000Z'),
 ('adaptive_review','智能间隔复习',0,0,'["experimental"]',0,'2026-10-10T00:00:00.000Z'),
 ('ai_error_explanation','答题后可选AI错因补充',0,0,'["experimental"]',0,'2026-10-10T00:00:00.000Z'),
 ('similar_word_explanation','答题后易混词与语法辨析',0,0,'["experimental"]',0,'2026-10-10T00:00:00.000Z')
 ON CONFLICT(flag_key) DO NOTHING;
