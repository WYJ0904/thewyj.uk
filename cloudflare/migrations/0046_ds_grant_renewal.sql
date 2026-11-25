/* Legacy grants retain their original expiry until signed activity converts a live grant. */
ALTER TABLE aeris_ds_sso_grants ADD COLUMN renewal_ceiling INTEGER
  CHECK (renewal_ceiling IS NULL OR (renewal_ceiling > issued_at AND renewal_ceiling >= expires_at));

ALTER TABLE aeris_ds_sso_grants ADD COLUMN renewed_at INTEGER
  CHECK (renewed_at IS NULL OR (renewal_ceiling IS NOT NULL AND renewed_at >= issued_at AND renewed_at < expires_at));

ALTER TABLE aeris_ds_sso_grants ADD COLUMN legacy_expires_at INTEGER
  CHECK (legacy_expires_at IS NULL OR
    (renewal_ceiling IS NOT NULL AND legacy_expires_at > issued_at AND legacy_expires_at < expires_at));
