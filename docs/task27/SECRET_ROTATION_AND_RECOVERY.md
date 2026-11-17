# Task27 Production Secrets: Recovery & Rotation SOP

This document describes how `WYJ_TASK27_CHALLENGE_SECRET` and `WYJ_TASK27_TOTP_KEY` are provisioned, backed up safely outside the repository, and rotated without breaking enrolled users. **Never store real secret values in Git, CI logs, or public artifacts.**

## 1. Secret Purposes & Formats

- `WYJ_TASK27_CHALLENGE_SECRET`
  - Used by `functions/_lib/task27-crypto.mjs` (`keyedDigest`) as the HMAC-SHA256 key for short-lived (`5 min`) challenge tokens and OTP codes.
  - Format: >= 32 UTF-8 bytes (recommended: 48 random bytes base64url-encoded).
  - Rotation impact: Only invalidates in-flight 5-minute challenges; users can immediately restart login MFA, email bind, or step-up without losing account state.
- `WYJ_TASK27_TOTP_KEY`
  - Used by `functions/_lib/task27-crypto.mjs` (`encryptTotp` / `decryptTotp`) as the AES-256-GCM key protecting `task27_security.totp_ciphertext` with per-user AAD (`aeris-task27:v1:${userId}`).
  - Format: Exact `32` random bytes base64url-encoded (43 base64url characters without padding).
  - Recovery & Loss Impact: If lost without backup or fallback, existing users enrolled in TOTP cannot verify TOTP codes and must recover via their single-use 10 recovery codes (or owner recovery).

## 2. Offline Recovery Backup Policy

1. Generate Production-only secrets locally with a CSPRNG (`crypto.randomBytes`), completely independent from Preview.
2. Persist the sealed recovery record outside the workspace in an owner-only local profile path (`%USERPROFILE%\.thewyj\task27-production-keys-backup-<timestamp>.json`) with restricted Windows NTFS ACL (`icacls <file> /inheritance:r /grant:r "%USERNAME%:F"`).
3. Write both secrets to Cloudflare Pages Production (`thewyj-uk`) via `npx wrangler pages secret put <NAME> --project-name thewyj-uk` (never `--preview`, never overwriting unrelated secrets).

## 3. Zero-Downtime Rotation Procedure for `WYJ_TASK27_TOTP_KEY`

1. Stage the retiring `WYJ_TASK27_TOTP_KEY` (and any still-active older keys, comma-separated) into `WYJ_TASK27_TOTP_PREVIOUS_KEYS` on Pages Production:
   ```powershell
   npx wrangler pages secret put WYJ_TASK27_TOTP_PREVIOUS_KEYS --project-name thewyj-uk
   ```
2. Generate a new 32-byte base64url key and update `WYJ_TASK27_TOTP_KEY` on Pages Production (also update the owner offline backup file first):
   ```powershell
   npx wrangler pages secret put WYJ_TASK27_TOTP_KEY --project-name thewyj-uk
   ```
3. `encryptTotp()` uses the new `WYJ_TASK27_TOTP_KEY` for all new TOTP enrollments; `decryptTotp()` transparently tries `WYJ_TASK27_TOTP_KEY` first and falls back to `WYJ_TASK27_TOTP_PREVIOUS_KEYS` for previously enrolled accounts.
4. Once all existing TOTP ciphertexts have been re-encrypted offline/via maintenance migration or re-enrollment under the new key, remove or clear `WYJ_TASK27_TOTP_PREVIOUS_KEYS`.
