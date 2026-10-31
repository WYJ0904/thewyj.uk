/* Additive reference data only. Existing IDs, amounts, receipts and holds stay intact. */
ALTER TABLE task16_finance_transactions ADD COLUMN amount_exponent INTEGER
  CHECK (amount_exponent IS NULL OR amount_exponent IN (0, 2));
ALTER TABLE task16_finance_budgets ADD COLUMN amount_exponent INTEGER
  CHECK (amount_exponent IS NULL OR amount_exponent IN (0, 2));
UPDATE task16_finance_transactions SET amount_exponent = 2
  WHERE currency IN ('CNY', 'USD', 'EUR', 'HKD', 'GBP');
UPDATE task16_finance_budgets SET amount_exponent = 2
  WHERE currency IN ('CNY', 'USD', 'EUR', 'HKD', 'GBP');
CREATE TRIGGER task16_currency_two_digit_insert AFTER INSERT ON task16_finance_transactions
WHEN NEW.currency IN ('CNY','USD','EUR','HKD','GBP') AND NEW.amount_exponent IS NULL
BEGIN UPDATE task16_finance_transactions SET amount_exponent=2 WHERE id=NEW.id; END;
CREATE TRIGGER task16_budget_two_digit_insert AFTER INSERT ON task16_finance_budgets
WHEN NEW.currency IN ('CNY','USD','EUR','HKD','GBP') AND NEW.amount_exponent IS NULL
BEGIN UPDATE task16_finance_budgets SET amount_exponent=2 WHERE id=NEW.id; END;
/* Historical JPY units were not proven by the old manual protocol. Do not rescale. */
CREATE TABLE task16_fx_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO task16_fx_metadata VALUES ('schema_version', '1');
CREATE TABLE task16_fx_rates (
  id TEXT PRIMARY KEY, base TEXT NOT NULL, quote TEXT NOT NULL,
  requested_date TEXT NOT NULL, rate_timestamp TEXT NOT NULL, rate TEXT NOT NULL,
  source TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  rounding TEXT NOT NULL CHECK(rounding = 'HALF_EVEN'), integrity_hash TEXT NOT NULL
);
CREATE TABLE task16_fx_cache (
  base TEXT NOT NULL, quote TEXT NOT NULL, requested_date TEXT NOT NULL,
  rate_id TEXT NOT NULL REFERENCES task16_fx_rates(id), fetched_at TEXT NOT NULL,
  PRIMARY KEY(base, quote, requested_date)
);
CREATE TABLE task16_fx_references (
  user_id TEXT NOT NULL, transaction_id TEXT NOT NULL, transaction_revision INTEGER NOT NULL,
  display_currency TEXT NOT NULL, rate_id TEXT NOT NULL REFERENCES task16_fx_rates(id),
  original_currency TEXT NOT NULL, original_minor INTEGER NOT NULL,
  amount_exponent INTEGER NOT NULL, converted_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(user_id, transaction_id, transaction_revision, display_currency)
);
CREATE TABLE task16_currency_preferences (
  user_id TEXT PRIMARY KEY, account_currency TEXT NOT NULL DEFAULT 'CNY',
  display_currency TEXT NOT NULL DEFAULT 'CNY', default_currency TEXT,
  revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE task16_currency_role_evidence (
  user_id TEXT NOT NULL, event_id TEXT NOT NULL, roles_json TEXT NOT NULL,
  PRIMARY KEY(user_id,event_id)
);
/* Wire protocol remains 1. Old server binaries reject these DB versions. */
UPDATE task16_metadata SET value='4' WHERE key='schema_version';
UPDATE task21_metadata SET value='7' WHERE key='schema_version';
