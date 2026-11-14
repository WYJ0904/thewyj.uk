/* Preserve every original ledger ID and amount. A proved duplicate is retained
   as a system supersession, never represented as a fictitious bank refund. */
ALTER TABLE task16_finance_transactions ADD COLUMN system_superseded_by TEXT NOT NULL DEFAULT '';
ALTER TABLE task16_finance_transactions ADD COLUMN system_superseded_operation TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_task16_system_superseded ON task16_finance_transactions(user_id,system_superseded_by);
/* A system-completed control candidate must not masquerade as a user's reject. */
CREATE TABLE task21_payment_control_closures (
 user_id TEXT NOT NULL,event_id TEXT NOT NULL,reason TEXT NOT NULL CHECK(reason='system_control_completed'),
 created_at TEXT NOT NULL,PRIMARY KEY(user_id,event_id)
);
UPDATE task21_metadata SET value='6',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
UPDATE task16_metadata SET value='3',updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
