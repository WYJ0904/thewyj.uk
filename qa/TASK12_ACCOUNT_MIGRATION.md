# Task 12 Account And Session Migration Audit

## Scope And Source Of Truth

- Source schema audited: `local-backend/account_store.py` and the SQLite schema it initializes.
- Cloud target: D1 tables created by `cloudflare/migrations/0003_accounts_sessions.sql`, with the concurrent Session cap enforced by `0004_session_limit_trigger.sql` and deterministic newest-session ordering applied by `0005_session_limit_ordering.sql`.
- Stable identity: the existing SQLite `users.id` text value is copied unchanged.
- Cloud-primary switch: `TASK12_CLOUD_ACCOUNTS_ENABLED=true` selects D1 for account APIs. It never writes the same account mutation to SQLite.
- Legacy business compatibility: a short-lived signed identity assertion lets non-migrated Python business APIs look up the stable user ID. No D1 token or second SQLite Session is created.
- Out of scope: membership, entitlement, payment, temporary share, PDF and AI data. Those remain on the Python backend until later tasks.

## Audited SQLite Account Baseline

`users` currently includes stable ID, display and normalized username, PBKDF2 secret metadata encoded in the existing `secret` column, role, legacy membership fields, registration/login timestamps, ban/deletion state and `session_version`.

`sessions` currently stores a SHA-256 token digest, stable user ID, session version and activity timestamps. Existing code supports multiple sessions, forced invalidation after password/ban/delete changes and bounded retention.

`login_audit_logs` contains success/failure, reason, stable user ID when known, bounded network location supplied by Cloudflare, user agent, source and timestamp. It never stores a password or Session token.

## D1 Tables

| Table | Purpose |
| --- | --- |
| `task12_metadata` | Schema version only |
| `task12_users` | Stable identity, PBKDF2 metadata, role, ban/deletion and session version |
| `task12_sessions` | SHA-256 token digest, expiry, revocation, session version and coarse client kind |
| `task12_login_audit_logs` | Bounded login audit without credentials |
| `task12_account_audit_logs` | Password/ban/logout/delete/import actions without hashes or raw secrets |
| `task12_auth_failure_windows` | Hashed login limiter buckets |

## Password Migration

The migration tool classifies every source secret as one of: valid PBKDF2-SHA256, legacy hash, historical plaintext or invalid. Only valid PBKDF2 values are transferred. Legacy/plaintext records become `reset_required`; invalid records become `invalid`. Reports contain counts only.

Cloudflare Web Crypto verifies the exact legacy format:

`pbkdf2_sha256$310000$<base64url-salt>$<base64url-32-byte-digest>`

Successful login upgrades an accepted lower-iteration PBKDF2 record to the current 310,000-iteration baseline. Unknown users perform equivalent PBKDF2 work before a generic credential error is returned.

## Session Strategy

Task 12 uses strategy B: SQLite Session rows are counted but never imported. The D1 table only receives newly issued token digests. A formal cloud-primary switch therefore requires every existing device to log in again.

Password change, admin reset, ban/unban, forced logout and deletion increment `session_version` and revoke all D1 sessions. Session resolution checks digest, expiry, revocation, account state and version on every request. A D1 `AFTER INSERT` trigger atomically keeps at most 12 active sessions per user, including concurrent logins; insertion `rowid` breaks same-millisecond ties so the newest 12 survive.

## Migration And Cutover Gates

1. Run against an immutable SQLite backup in dry-run mode.
2. Require zero duplicate user IDs, duplicate normalized names and Task 11 orphaned owner IDs.
3. Apply `0003` and import only to Preview.
4. Compare source and target counts; test D1 login and Task 11 ownership.
5. Validate the signed legacy-business bridge with an isolated account.
6. Stop. Production migration and cloud-primary switch require separate approval.

Production import is blocked unless all three controls are present: the Production import feature flag, `--backup-confirmed`, and the exact confirmation phrase. The import API independently checks the confirmation header.

## Rollback Boundary

Before any cloud-primary account mutation, rollback is a feature-flag change back to legacy auth. After cloud password/account mutations exist, SQLite may contain stale authentication metadata. At that point rollback requires a controlled reconciliation and reauthentication/reset for affected users; blindly accepting old SQLite credentials is forbidden.

## Automated Coverage

- PBKDF2 compatibility and digest-only Session storage.
- Correct/wrong/missing-user login paths and login/register limiters.
- Multi-device and concurrent login, 12-session cap and expiry.
- Password change, reset, ban/unban, force logout and delete invalidation.
- Admin authorization and audit paths.
- Mobile/WeChat client classification.
- Idempotent stable-ID import and conflict detection.
- Legacy plaintext/hash classification without report leakage.
- Task 11 feedback ownership using D1 identity.
- HMAC bridge header stripping/signing, Python verification and cloud-primary rejection of old sessions.
- Existing same-origin/CSRF middleware and PWA/browser suites in Core CI.
