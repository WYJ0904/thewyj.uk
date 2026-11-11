/* Source unit evidence is separate from immutable source amounts and receipts. */
CREATE TABLE task21_currency_units (
  user_id TEXT NOT NULL, event_id TEXT NOT NULL, currency TEXT NOT NULL,
  amount_exponent INTEGER NOT NULL CHECK(amount_exponent IN (0,2)),
  PRIMARY KEY(user_id,event_id)
);
/* Old JPY source records have no proven unit. Never backfill or rescale them. */
UPDATE task21_metadata SET value='8' WHERE key='schema_version';
