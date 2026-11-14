# Task27 function and data contract

Baseline: `3f5ea474404df5e513df6198d0244c8a041ad2ff` (Draft #151).
Branch: `codex/task27-security-center`, isolated from the paused Windows Hotfix
and both Hydrogen branches. This task authorizes Task27 development only.
No integration, Production migration/deployment, real email, phone or Stable action.

The owner's current message governs requirements. The supplied policy TXT supplies
the three policy bodies and confirmed page rules; its implementation section is
not itself legal policy. The older Task27 brief supplies the development scope.
Unverified legal identity, jurisdiction, retention and release dates stay explicitly
unverified; planned authentication capabilities retain conditional wording.

## Existing owners and extensions

- Task12 remains the only user/password/Web session authority.
- Task20 remains the Android access/refresh session authority. No full credential
  is issued until all required authentication and temporary-password gates pass.
- Task18 remains the administrator broadcast, recipient and explicit-confirmation
  authority. Its existing rows default to broadcast. Inbox read and explicit
  acknowledgement are separate fields and operations.
- The existing Cloudflare email service remains the only outbound transport.
  Fixed approved sender and support Reply-To are reused. Provider acceptance,
  queueing and delivery reports do not establish arrival in an inbox. No inbound
  mailbox integration or private Gmail access is included.

## Additive schema (0035 only)

`task27_security` owns verified email, encrypted TOTP configuration and replay
counter, MFA method, reliable password-age baseline, forced temporary-password
change and reminder timestamps. Existing accounts start password-age measurement
at migration/first use, never at unrelated `updated_at`.

`task27_challenges` holds hashed high-entropy challenge/grant tokens, purpose,
account/security generations, session and device binding, five-minute expiry,
bounded attempts and one-time consumption. Email codes use a purpose-bound keyed
digest. TOTP uses Web Crypto HMAC and AES-GCM encryption with user-bound associated
data. `task27_recovery_codes` holds only hashes of ten random one-time codes.
Atomic D1 batches assert current generation and grant eligibility before writes;
the assertion scratch table is empty after commit. MFA configuration changes,
password changes and resets revoke both Task12 and Task20 credentials.

`task27_events` records only enumerated security actions and actor identifiers.
`task27_notifications` holds account-owned security notices with event deduplication.
Administrator inbox messages reuse Task18 rows/recipients and a distinct read
timestamp. Batch-read previews bind an exact server watermark and count to the
account/session; confirmation changes read state only.

`task27_policy_consents` records exact versions, affirmative consent, UTC timestamp
and request audit identifier. Future policies may require existing-account
reacceptance; optional processing consent remains separate.

Email drafts and per-recipient jobs preserve preview, revision, actor, thread ID,
bounded attempts and provider status. Recipients must be active accounts with
verified bound email. No arbitrary recipient, sender, CC/BCC or bulk marketing.
Unknown provider outcomes are held to avoid automatic duplicate sending.

## Authentication states

Password -> optional MFA challenge -> optional restricted password change -> full
Task12/Task20 session. Challenge and restricted-change tokens never appear in
session tables and cannot authenticate business APIs. Password recovery preserves
MFA. Loss of MFA uses a distinct password-plus-recovery-code procedure. A feature
flag can stop new enrollment, but cannot bypass previously configured MFA.
Step-up grants are short-lived, one-use and bound to account, current session,
security generation, exact action and (where relevant) target.
Missing/inconsistent schema metadata fails closed if security tables already
exist. Successfully completed step-up clears its failed-password throttle;
uncompleted MFA and failed passwords do not. Per-request limits remain in force.

The public capability response distinguishes a pre-Task27 legacy test server
(404) from current schema readiness. Existing UI handlers remain available for
historical local-server compatibility; current D1 APIs always enforce consent,
MFA, restricted password changes and step-up regardless of a client's claimed
capability or enrollment flag. No second identity store is introduced.

## Message rules

- Password age >=30 days: personal advice, at most once per 30 days; no expiry,
  lock, forced password change or membership changes.
- MFA disabled: one shared Task18 advice broadcast, per-account 30-day display
  throttle; no personal unread increment and no per-account message duplication.
- Version releases: broadcast; material policy changes: personal inbox.
- Delivery channel and single/multiple/all recipient scope are independent.
- Explicit administrator acknowledgement is never satisfied by inbox read-all.

## Validation boundaries

Use isolated synthetic D1, synthetic mail transport and local browser evidence.
Exercise replay/concurrent consumption, stale generation, account ownership,
Android refresh revocation, consent bypass, old broadcast preservation and mail
faults. Real email receipt, Hosted Preview, CI, Samsung, integration and Production
are separately reported; unexecuted gates remain NOT_TESTED/BLOCKED.

## Reviewed concurrent S0 work

Read-only review of PR151 at `2365be0b6f68ddca693bc6da30e3ee42f25f36d8`
identified `0961710996fc5b0eaed41d795ad54313e46326e0` (JSON depth and
transfer queue isolation) and `2365be0...` (release-harness quota handling).
The five-file functional security patch from 0961710 was ported in this isolated
branch, retaining the original baseline asset token and excluding S0 release
metadata/changelog changes. No Hydrogen ref or worktree was changed. Task27's
new JSON contract already bounds size and field types without recursive traversal.
Final-main synchronization remains a separate post-S0 integration gate.

## Incremental owner requirements (2026-11-15)

The prior implementation is preserved at `4167af98b38ae6c11c632e0b58b3902e62e57c3f`.
New registration and voluntarily set passwords now require at least nine Unicode
code points, ASCII upper/lower case and digit, plus a punctuation/symbol. The
maximum stays 128 code points. Existing-password verification never invokes this
new-password validator. Web and server share its pure policy module; Android
has matching input checks. Plaintext is neither normalized for hashing nor sent
to a third-party password checker. The small local weak-password list is not a
comprehensive breach database.

TOTP's displayed QR, OS link and manual key derive from one server URI. The
existing local QR encoder remains in place; an independent decoder and OTPAuth
oracle validate the configuration. Android handles the narrow standard URI only
from a trusted main frame with user activation and provides a missing-handler
fallback. No manifest permissions or native authenticator app are added.

Legacy management routes retain the quota of their existing owning module.
Task27 rate limits its new endpoints (normally 30/min, read/step-up 120/min);
step-up retains its separate five-failed-attempt window and one-use grants.
The loopback CI adapters acquire real grants rather than bypassing this gate.
Hosted smoke tools stop before fixture creation when reviewed Task27 step-up is
unavailable. No remote smoke or release action is performed by this task.
