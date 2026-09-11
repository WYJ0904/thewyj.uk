/* Amount-unknown review candidates.

"向张三转账" carries a payment verb and a direction but no number. It must
become a real pending candidate the user can complete from the finance page
(edit the amount, then confirm), instead of being dropped. The amount stays 0
until the user fills it: nothing is invented, and confirmation still validates
amount > 0 in the service layer.

SQLite cannot relax a CHECK constraint in place, so the table is rebuilt with
amount_minor >= 0 while every other constraint (direction, status, lengths,
ownership) stays identical. */
CREATE TABLE IF NOT EXISTS task21_notification_candidates_v2 (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 80),
    user_id TEXT NOT NULL,
    event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 8 AND 80),
    direction TEXT NOT NULL CHECK (direction IN ('income', 'expense', 'refund')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'CNY' CHECK (length(currency) = 3),
    merchant TEXT NOT NULL DEFAULT '' CHECK (length(merchant) <= 160),
    counterparty TEXT NOT NULL DEFAULT '' CHECK (length(counterparty) <= 160),
    payment_channel TEXT NOT NULL DEFAULT '' CHECK (length(payment_channel) <= 40),
    occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms > 0),
    confidence INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1000),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
    finance_transaction_id TEXT NOT NULL DEFAULT '' CHECK (length(finance_transaction_id) <= 80),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    edited_json TEXT NOT NULL DEFAULT '{}',
    correction_count INTEGER NOT NULL DEFAULT 0,
    evidence_count INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO task21_notification_candidates_v2 (
    id, user_id, event_id, direction, amount_minor, currency, merchant, counterparty,
    payment_channel, occurred_at_ms, confidence, status, finance_transaction_id,
    created_at, updated_at, edited_json, correction_count, evidence_count
)
SELECT
    id, user_id, event_id, direction, amount_minor, currency, merchant, counterparty,
    payment_channel, occurred_at_ms, confidence, status, finance_transaction_id,
    created_at, updated_at, edited_json, correction_count, evidence_count
FROM task21_notification_candidates;

DROP TABLE task21_notification_candidates;

ALTER TABLE task21_notification_candidates_v2 RENAME TO task21_notification_candidates;

CREATE UNIQUE INDEX IF NOT EXISTS idx_task21_candidates_user_event
ON task21_notification_candidates (user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_task21_candidates_owner_status
ON task21_notification_candidates (user_id, status, created_at DESC, id);
