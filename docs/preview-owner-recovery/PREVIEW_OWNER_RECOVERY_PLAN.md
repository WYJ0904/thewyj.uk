# Preview Owner Minimal Controlled Recovery Plan (H1)

## 1. Root Cause & Existing Path Audit

- **Target account**: `task18-preview-owner-10f06c88` on Preview D1 `wyj-cloud-preview` (`a3e6253b-689f-49f3-998b-7c5828ea255a`).
- **Observed state**: Sole `super_admin`, `banned = 0`, `permanent_ban = 0`, `deleted = 0`, `password_scheme = 'reset_required'`, `password_hash = ''`, and zero active sessions.
- **Why login is blocked**:
  - `functions/_lib/task12-service.mjs` (`loginAccount`) rejects any account where `password_scheme !== 'pbkdf2_sha256' || !password_hash` with HTTP `403 password_reset_required`.
  - `functions/_lib/task20-service.mjs` (`loginTask20Device`) delegates to `loginAccount`, so Android login is also blocked with `403 password_reset_required`.
- **Why no existing recovery path works**:
  - `POST /api/account/secret` (`changeOwnSecret`) requires a valid session and explicitly rejects `super_admin` (`403 admin_protected`).
  - `POST /api/admin/secret` (`adminResetSecret`) requires an active admin session and explicitly rejects `super_admin` (`403 owner_protected`).
  - `POST /api/admin/task12/import` requires an active `super_admin` session and `TASK12_IMPORT_ENABLED=true`.
  - `POST /api/admin/roles` (`setAdminRole`) requires an active `super_admin` session and cannot grant `super_admin`.
  - `cloudflare/migrations/0014_admin_roles_messages.sql` enforces single-owner triggers (`task18_single_owner_insert`, `task18_single_owner_update`, `task18_owner_role_protected`, `task18_owner_state_protected`, `task18_owner_delete_protected`).
  - There is no TOTP/Passkey/self-reset endpoint in Task 12, Task 18, or Task 20.

## 2. Controlled Recovery Design (No HTTP Backdoor)

- Implemented in operator-only local CLI tooling (`scripts/preview-owner-recovery-lib.mjs` and `scripts/recover_preview_owner.mjs`), with **no changes to `functions/` HTTP routes** and **no Production changes**.
- **Hard invariants**:
  - Environment must be `preview`; remote execution pins database ID `a3e6253b-689f-49f3-998b-7c5828ea255a` and name `wyj-cloud-preview`.
  - Enforces single `super_admin` count (`=== 1`), rejects `wyj`, and pins `task18-preview-owner-10f06c88` by `id` or `username_normalized`.
  - Requires `banned = 0`, `permanent_ban = 0`, `deleted = 0`, `password_scheme = 'reset_required'`, `password_hash = ''`, and `0` active `task12_sessions` / `task20_device_sessions`.
  - Preserves original `id` (UUID), `username`, `role = 'super_admin'`, and all historical business/learning/audit data.
  - Uses existing Task 12 validation (`validateSecret`) and PBKDF2-SHA256-CF-v1 hashing (`hashSecret`, 310,000 iterations + `WYJ_TASK12_PASSWORD_PEPPER`).
  - Atomically sets `password_scheme = 'pbkdf2_sha256'`, `password_iterations = 310000`, increments `session_version = session_version + 1`, revokes any stale `task12_sessions` and `task20_device_sessions`, and inserts audit entries into `task12_account_audit_logs` (`action = 'password_reset'`) and `task18_admin_action_audit` (`action = 'preview_owner_credential_recovery'`).
  - Never prints or stores plaintext secrets, pepper, or password hashes in logs, stdout, or audit JSON.

## 3. Local Verification Evidence

Verified on fresh local Miniflare D1 databases (migrations `0001`–`0034`):

```powershell
node qa/preview-owner-recovery/recover_preview_owner.test.mjs
```

- Pre-recovery `POST /api/login` and `POST /api/app/login` return `403 password_reset_required`; `/api/account/secret` and `/api/admin/secret` fail closed (`401`/`403`).
- Tested both UUID `id` with `username = 'task18-preview-owner-10f06c88'` and matching `id = username = 'task18-preview-owner-10f06c88'`.
- Post-recovery preserves UUID, role, admin roles, and historical Task 11 / Task 16 rows; invalidates stale sessions; records non-secret audits; enables normal `/api/login`, `/api/admin/roles`, `/api/admin/task18/status`, and `/api/app/login`; rejects repeated recovery once `pbkdf2_sha256` is active.
- Mid-batch injected SQL failure rolls back all tables byte-for-byte; `wyj`, non-pinned owners, `production`, wrong D1 ID, active sessions, weak secrets, missing pepper, and missing remote confirmation flags all fail closed.

## 4. Minimum Authorization Required Before Remote Execution

Before running against remote `wyj-cloud-preview`:

1. Coordinate with Codex to pause all concurrent writes to `wyj-cloud-preview` (`a3e6253b-689f-49f3-998b-7c5828ea255a`).
2. Obtain explicit owner approval specifically for recovering `task18-preview-owner-10f06c88`.
3. Capture a fresh D1 Time Travel bookmark and private logical SQL backup before mutation (do **not** execute full-database Time Travel restore automatically).
4. Supply `WYJ_TASK12_PASSWORD_PEPPER` (matching Preview Pages secret) and `PREVIEW_OWNER_RECOVERY_SECRET` via environment variables only (never in shell arguments or committed files):

```powershell
# 1) Read-only inspection (0 writes)
node scripts/recover_preview_owner.mjs --mode inspect --remote

# 2) Dry-run validation (0 writes)
node scripts/recover_preview_owner.mjs --mode dry-run --remote

# 3) Controlled apply (only after write-window + owner approval + backup)
node scripts/recover_preview_owner.mjs --mode apply --remote `
  --database-id a3e6253b-689f-49f3-998b-7c5828ea255a `
  --database-name wyj-cloud-preview `
  --write-window-confirmed `
  --owner-approval-confirmed `
  --backup-confirmed `
  --confirm-phrase PREVIEW-OWNER-RECOVERY-10F06C88
```
