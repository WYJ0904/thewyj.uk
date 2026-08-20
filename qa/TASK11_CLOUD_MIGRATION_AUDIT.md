# Task 11 low-risk cloud migration audit

Baseline: `main` at `fe32dae` (Task 10 / PR #16 merged). Audit date: 2026-08-20.

This document is the routing and data-contract baseline for Task 11. It is intentionally limited to changelog, feedback, feature voting, learning sync, low-risk service status, and aggregate telemetry. Accounts, sessions, memberships, payments, QR assets, temporary sharing, PDF, and AI remain on the legacy Python service.

## Existing routes and cloud targets

| Route | Current source | Current permission | Current limit | Task 11 target | Fallback |
| --- | --- | --- | --- | --- | --- |
| `GET /api/changelog` | No API; `changelog.js` is the structured static source | Public | Static asset caching | D1 read-only changelog API | `changelog.js` in the browser |
| `POST /api/feedback` | SQLite `feedback_items` | Valid legacy session | 5 submissions / 10 minutes | D1 `task11_feedback_items` | Legacy API while cloud writes are off or D1 is unavailable |
| `GET /api/feedback/mine` | SQLite `feedback_items` and `feedback_votes` | Valid legacy session; own rows only | 120 / minute | D1 owner-scoped query | Legacy API while cloud reads are off or D1 is unavailable |
| `GET /api/feedback/voting` | SQLite feedback and votes | Valid legacy session | 120 / minute | D1 public-suggestion projection plus current user's vote | Legacy API while cloud reads are off or D1 is unavailable |
| `POST /api/feedback/vote` | SQLite `feedback_votes` | Valid legacy session | 30 / minute | D1 unique `(feedback_id, user_id)` vote | Legacy API while cloud writes are off or D1 is unavailable |
| `GET /api/admin/feedback` | SQLite feedback and votes | Legacy super administrator | 120 / minute | D1 search/filter plus Task 11 audit summary | Legacy API while cloud reads are off or D1 is unavailable |
| `POST /api/admin/feedback/update` | SQLite feedback, votes, and `admin_audit_logs` | Legacy super administrator | 120 / minute | D1 update/merge/delete plus immutable Task 11 audit | Legacy API while cloud writes are off or D1 is unavailable |
| `POST /api/learning/sync` | SQLite sync records, heads, and change log | Valid legacy session | 30 / minute | D1 incremental push/pull with existing schema v1 | Legacy API while cloud writes are off or D1 is unavailable |
| `GET /api/admin/task11/telemetry` | Not currently exposed | Legacy super administrator | 120 / minute | Aggregated D1 counters only | Explicit unavailable response when cloud reads are off |
| `POST /api/telemetry` | No server store | Same-origin; no raw user data | 60 / minute per client | Hourly aggregate D1 counters | Accepted no-op while cloud writes are off |
| `GET /api/status?source=cloud` | Task 10 Pages Function | Public | Foundation D1 limiter | Add Task 11 schema/readiness fields | Existing Task 10 response remains usable |

## Identity boundary

- The browser continues to send `X-Session-Token` exactly as before.
- A removable legacy-auth adapter asks the existing `/api/me` endpoint to validate that token.
- D1 stores only the returned stable user ID and the minimum snapshots already present in Task 11 records. It does not store passwords, session tokens, membership records, payment data, or an account table.
- An unavailable identity dependency returns an explicit retryable authentication-dependency error. It never falls back to anonymous ownership.
- Administrator checks use the existing `is_super_admin` field from `/api/me`.

## Contract invariants

- Feedback types remain `feature_suggestion`, `tool_error`, `page_issue`, `account_issue`, `new_tool`, and `other`.
- Feedback statuses remain `pending`, `viewed`, `accepted`, `completed`, and `rejected`.
- Public voting returns only accepted/completed, unmerged suggestions and never returns submitter or feedback body.
- Learning sync remains schema version 1 with the existing six data types, limits, stable IDs, tombstones, and conflict rules.
- Achievement merges are monotonic; wrong-book payloads merge accepted answers and maximum wrong count; other records use the existing timestamp/client tie-break.
- A stale client cannot revive a tombstoned record.
- Changelog fields remain `version`, `build`, `date`, `title`, `features`, `improvements`, `fixes`, and `security`.

## Rollout stages

1. `TASK11_CLOUD_READS_ENABLED=false`, `TASK11_CLOUD_WRITES_ENABLED=false`: all existing Task 11 routes remain legacy; telemetry is a no-op and changelog remains static.
2. Schema and seed ready: D1 is populated but no production route changes.
3. Cloud reads enabled: read routes use D1 and retain fallback.
4. Cloud writes enabled: Task 11 writes use D1; fallback is allowed only before a cloud write starts, preventing split-brain dual writes.
5. Cloud primary: Task 11 is cloud-first; unrelated APIs still use the legacy proxy.
6. Task 12: replace only the identity adapter, retaining the Task 11 tables and stable user IDs.

Preview enables the Task 11-specific read/write flags for integration validation. Production Task 11 reads/writes and import remain disabled until Preview validation and explicit approval; the global cloud read/write flags remain disabled in every environment.

## Preview migration verification

- On 2026-08-20, `0002_low_risk_cloud_services.sql` was applied only to the `wyj-cloud-preview` D1 database.
- A second remote migration listing reported no pending migrations.
- Read-only verification returned Task 11 schema version `1` and nine `task11_` tables.
- The eight public records from the structured `changelog.js` source were seeded idempotently; no legacy user data was imported.
- The branch Preview returned HTTP 200 with D1, R2, and Workers AI bindings present, Task 11 schema ready, and the Preview-only Task 11 read/write flags enabled.
- Preview integration checks covered the changelog response, one aggregate telemetry write, cross-origin rejection, telemetry field allowlisting, and the unauthenticated feedback boundary. The telemetry probe row was removed after verification.
- Production migration, Production import, Production cloud reads/writes, and fallback removal remain intentionally untouched.
