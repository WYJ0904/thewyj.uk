/* Exact provider/message lifecycle aliases for one canonical payment review.
   No raw notification title, body, sender or message is stored. */
ALTER TABLE task21_notification_events ADD COLUMN provider_reference TEXT NOT NULL DEFAULT ''
    CHECK (length(provider_reference) <= 40);
ALTER TABLE task21_notification_events ADD COLUMN lifecycle_identity TEXT NOT NULL DEFAULT ''
    CHECK (length(lifecycle_identity) <= 64);
ALTER TABLE task21_notification_pending_hints ADD COLUMN provider_reference TEXT NOT NULL DEFAULT ''
    CHECK (length(provider_reference) <= 40);
ALTER TABLE task21_notification_pending_hints ADD COLUMN lifecycle_identity TEXT NOT NULL DEFAULT ''
    CHECK (length(lifecycle_identity) <= 64);
ALTER TABLE task21_notification_pending_hints ADD COLUMN payment_channel TEXT NOT NULL DEFAULT ''
    CHECK (length(payment_channel) <= 40);

CREATE TABLE IF NOT EXISTS task21_notification_review_aliases (
    user_id TEXT NOT NULL,
    event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 8 AND 80),
    hint_id TEXT NOT NULL CHECK (length(hint_id) BETWEEN 8 AND 80),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, event_id),
    FOREIGN KEY (user_id) REFERENCES task12_users(id) ON DELETE CASCADE,
    FOREIGN KEY (hint_id) REFERENCES task21_notification_pending_hints(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task21_review_alias_hint
ON task21_notification_review_aliases (user_id, hint_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task21_hint_reference
ON task21_notification_pending_hints
  (user_id, source_package, payment_channel, provider_reference, COALESCE(direction, 'unknown'))
WHERE provider_reference != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_task21_hint_lifecycle
ON task21_notification_pending_hints (user_id, source_package, payment_channel, lifecycle_identity)
WHERE lifecycle_identity != '';
