# Task27 final integration worklog

Baseline before this task: `d06e50eb85a3cb32c93c9f0a6e0a874e7ed11eb2`.
Original product `3b1ff9d7...` and checkpoint `4167af98...` remain reachable.

## Remote receipt — 2026-11-15

- Fresh `origin/main`: `7766b80eb2c9e448dc08a3a4b317bfa62e0dff6e`.
- PR151 is merged; main Core CI [43625189929](https://github.com/WYJ0904/thewyj.uk/actions/runs/43625189929) completed success for that exact SHA.
- PR153 is Draft/open/unmerged at `2a17c2bb05ad180e8463f849f2ea22773986c84d`.
- Only remote-tracking refs were fetched. Neither Hydrogen delivery branch/worktree was changed.

## Main merge decisions

Merge main into Task27, preserving the original Task27 commits. Three conflicts
were resolved individually:

- R5 harness: retain main's bounded Retry-After handling and Task27's real
  Step-up/consent fixture adapter plus compliant synthetic passwords.
- Publication harness: retain the same retry contract and the Task27 adapter.
- Service Worker: retain main's script-URL release mismatch rejection, original
  81 resource fingerprint, Task26/Finance layers and immutable publication
  behavior; append the five Task27 required imports and regenerate all source
  hashes using main's `20261115-aeris-s0-p0-release` asset identity.

SEC-S0-M01/M03 backend and regression files match main. Azure TTS configuration,
0026–0034 and original Android release metadata are not replaced. The initial
SW test's historical total 84 was extended to 84+5 with explicit negative tests
for every added mandatory import; original 81 identity checks remain unchanged.
The original failing log is retained under ignored `.wrangler/`.

## Codex authentication and mail-consumer hardening

- SEC-S0-M02 reuses the existing authentication-window table. A normalized
  username/IP pair reserves at most 8 attempts and the username reserves at most
  24 across Web/Android/IPs in a fixed 300-second window. Denied attempts do not
  extend that window, ban users, revoke sessions or change password policy.
  Correct passwords clear completed reservations; infrastructure errors release
  their own reservations. Invalid verifiers retain their internal audit reason
  but share the public bad-credentials response with unknown users.
- A narrow mail adapter accepts success only when `ok === true`, passes the
  target user, five-minute expiry and challenge-derived idempotency key, and
  never claims inbox placement. Missing full-center tables and conflicting
  verified addresses fail before authentication-mail dispatch.
- Task27 ownership verification atomically synchronizes its authoritative unique
  verified email with the optional 0036 binding row and revokes prior sessions.
  No historical binding is silently trusted or mass-rewritten.
- When the full email-center capability exists, its handler exclusively owns
  `/api/admin/email/*`. Task27 adds current account/session checks and one-use
  scoped reauthentication for sends, retries, replies, template writes and
  inbound status changes. Administrative binding writes are rejected in favor
  of the user ownership-proof flow. The legacy mail UI is hidden/delegated.
- Hydrogen source review and combined probes are kept separate from this
  delivery branch. Producer fixes belong to PR153, including non-atomic binding
  writes, direct verified-binding administration and concurrent idempotency.
  Findings are not represented as a successful mail-platform release gate.

## Draft PR154 and the first actual CI failure

Task27 was pushed at `8a57c3802109f4cb624fe65a7a69158c5563fad8` and
[Draft PR154](https://github.com/WYJ0904/thewyj.uk/pull/154) was created.
Core CI 43680148997 failed the unchanged full-functional coverage gate because
its matrix omitted the new public recovery and three policy routes. Task27's
actual authentication/notification step had passed; Android and Python also
passed. The two dependent browser jobs did not run. Task25 branch-only jobs
remain explicitly SKIPPED.

The fix updates the QA matrix and documentation and adds a real browser check
for `/forgot-password`, its two recovery entry points and three factor choices.
The original gate is preserved and passes with 27 routes. No product or
permission requirement is weakened. The original failed CI receipt is retained.
The temporary combination was archived with the app tool after preserving all
ignored logs, migration state and browser evidence in the Task27 checkout.
