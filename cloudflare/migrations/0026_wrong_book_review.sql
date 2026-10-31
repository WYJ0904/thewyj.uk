/* Incremental only: preserve 0025, all legacy tickets/events and Task11 records. */
CREATE TABLE IF NOT EXISTS task26_wrong_review_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL,
 profile TEXT NOT NULL,
 language TEXT NOT NULL CHECK(language IN ('english','japanese')),
 record_id TEXT NOT NULL,
 review_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('answer','mistake','correction')),
 correct INTEGER NOT NULL CHECK(correct IN (0,1)),
 corrects TEXT,
 accepted_at TEXT NOT NULL,
 input_digest TEXT NOT NULL,
 algorithm_version TEXT NOT NULL CHECK(algorithm_version='wrong-review-v1'),
 UNIQUE(user_id,event_id),
 UNIQUE(user_id,attempt_id)
);
CREATE INDEX IF NOT EXISTS idx_task26_wrong_review_replay
 ON task26_wrong_review_events(user_id,profile,language,review_id,seq);
CREATE TRIGGER IF NOT EXISTS task26_wrong_review_immutable
 BEFORE UPDATE ON task26_wrong_review_events BEGIN SELECT RAISE(ABORT,'task26_wrong_review_immutable'); END;

CREATE TABLE IF NOT EXISTS task26_wrong_review_states (
 user_id TEXT NOT NULL REFERENCES task12_users(id) ON DELETE CASCADE,
 profile TEXT NOT NULL,
 language TEXT NOT NULL CHECK(language IN ('english','japanese')),
 review_id TEXT NOT NULL,
 last_event_seq INTEGER NOT NULL,
 state_json TEXT NOT NULL CHECK(json_valid(state_json)),
 PRIMARY KEY(user_id,profile,language,review_id)
);
