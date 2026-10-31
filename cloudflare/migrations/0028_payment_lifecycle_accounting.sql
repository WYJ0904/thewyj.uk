/* P03 closeout: optional source facts and auditable acceptance of lifecycle controls. */
ALTER TABLE task21_notification_events ADD COLUMN lifecycle_operation TEXT NOT NULL DEFAULT ''
    CHECK (lifecycle_operation IN ('','AUTHORIZE','CAPTURE','REFUND','RELEASE','CLOSE'));
ALTER TABLE task21_notification_events ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0
    CHECK (lifecycle_revision BETWEEN 0 AND 999999999);
ALTER TABLE task21_notification_events ADD COLUMN lifecycle_review_reason TEXT NOT NULL DEFAULT '';
/* This is a validation marker linked to the existing event, not a financial ledger. */
CREATE TABLE task21_payment_lifecycle_guards (
    user_id TEXT NOT NULL, event_id TEXT NOT NULL, passed INTEGER NOT NULL CHECK (passed = 1),
    PRIMARY KEY (user_id,event_id)
);
/* v3 cannot enforce partial refunds/releases: it must not continue after this migration. */
UPDATE task21_metadata SET value='4', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';
