/* Additive on the scoped DS Preview ledger and the canonical migration chain. */
CREATE TABLE IF NOT EXISTS aeris_ds_native_envelopes (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  owner TEXT NOT NULL,
  sealed TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
) STRICT;

CREATE INDEX IF NOT EXISTS aeris_ds_native_envelopes_expiry ON aeris_ds_native_envelopes(expires_at);

CREATE TABLE IF NOT EXISTS aeris_ds_native_nonces (
  nonce TEXT PRIMARY KEY NOT NULL CHECK (length(nonce) = 43),
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS aeris_ds_native_nonces_expiry ON aeris_ds_native_nonces(expires_at);
