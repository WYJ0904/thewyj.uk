# Task 15 Production route audit

Audit baseline: `2026-08-26-task15-cloud-only`.

## Invariants

- The only deployed API entry is `functions/api/[[path]].js`; `/api/status` also has its dedicated Pages route.
- Every row below is handled by a Cloudflare Pages Function. `Proxy`, `LOCAL_API_BASE`, Python, SQLite, Ollama, and the legacy identity bridge are **No** for every row.
- Account identity always comes from Task 12 D1 sessions. Only canonical terminal auth codes may clear the browser Session. Business, entitlement, D1/R2 dependency, AI, timeout, quota, and network errors preserve it.
- `legacy` in older Task 11/14 implementation history means “keep the public URL/data contract”; it does not mean a runtime proxy.
- The automated gate `node scripts/check_task15_cloud_only.mjs` builds the deployed module graph, rejects local dependencies, and checks every literal frontend API route against this table's Cloudflare handlers.

Legend: `C` = canonical auth may invalidate Session; `P` = public/manual action, never implicit logout; `N` = business/dependency error, never logout.

## Foundation

| Method | Route | Cloud handler / data | Auth | R2 / AI | Error/logout | Test |
|---|---|---|---|---|---|---|
| GET, HEAD | `/api/status` | `cloudflare-foundation.mjs`; D1 schema/binding health | Public | binding health only | `legacy_status_retired`, dependency degradation / N | foundation + static |

## Task 12 accounts and sessions

All persistent data is in Task 12 D1 tables; passwords use PBKDF2-SHA256 and only Session digests are stored.

| Method | Route | Operation | Auth | Error/logout | Test |
|---|---|---|---|---|---|
| POST | `/api/register` | Create D1 user | Public | validation/rate limit / N | Task 12 |
| POST | `/api/login` | Verify password, create D1 Session | Public | credentials/rate limit / N | Task 12 + Task 15 |
| GET | `/api/me` | Resolve canonical D1 Session | User | canonical terminal codes / C | Task 12 + Task 15 |
| POST | `/api/logout` | Revoke current digest | Optional | user action / P | Task 12 |
| POST | `/api/account/logout-all` | Increment generation/revoke all | User | canonical or user action / C/P | Task 12 |
| POST | `/api/account/secret` | Change PBKDF2 password and revoke sessions | User | canonical or user action / C/P | Task 12 |
| POST | `/api/account/delete` | Soft-delete account and revoke sessions | User | canonical or user action / C/P | Task 12 |
| GET | `/api/admin/users` | D1 account list | Admin | `forbidden` / N | Task 12 |
| GET | `/api/admin/login-logs` | D1 login audit | Admin | `forbidden` / N | Task 12 |
| GET | `/api/admin/audit` | Merged D1 admin audit | Admin | `forbidden` / N | Task 12/13 |
| POST | `/api/admin/secret` | Admin password reset | Admin | `forbidden` / N | Task 12 |
| POST | `/api/admin/ban` | Ban/unban and revoke when required | Admin | canonical for affected account / C | Task 12 |
| POST | `/api/admin/logout-user` | Force logout | Admin | canonical for affected account / C | Task 12 |
| POST | `/api/admin/delete-user` | Admin account deletion | Admin | canonical for affected account / C | Task 12 |
| POST | `/api/admin/task12/import` | Idempotent account import | Migration admin + disabled Production gate | import errors / N | Task 12 migration |
| GET | `/api/admin/task12/import/status` | Import counts | Migration admin + gate | import errors / N | Task 12 migration |

## Task 11 changelog, feedback, voting and learning sync

All data is in Task 11 D1 tables and ownership uses the same Task 12 stable user ID.

| Method | Route | Operation | Auth | Error/logout | Test |
|---|---|---|---|---|---|
| GET, HEAD | `/api/changelog` | Structured D1 changelog | Public | service error / N | Task 11 |
| POST | `/api/feedback` | Create owned feedback | User | canonical only / C; input/rate errors / N | Task 11 |
| GET | `/api/feedback/mine` | Own feedback only | User | canonical only / C | Task 11 |
| GET | `/api/feedback/voting` | Voteable suggestions | User | canonical only / C | Task 11 |
| POST | `/api/feedback/vote` | One reversible vote/user | User | canonical only / C; conflict / N | Task 11 |
| GET | `/api/admin/feedback` | Search/filter feedback | Admin | `forbidden` / N | Task 11 |
| POST | `/api/admin/feedback/update` | Status/note/merge/delete + audit | Admin | `forbidden` / N | Task 11 |
| POST | `/api/learning/sync` | Incremental records/tombstones | User | canonical only / C; validation/conflict / N | Task 11 + sync tests |
| POST | `/api/telemetry` | Sanitized operational metadata | Public | rate/validation / N | Task 11 |
| GET | `/api/admin/task11/telemetry` | Aggregated telemetry | Admin | `forbidden` / N | Task 11 |
| POST | `/api/admin/task11/import` | Idempotent low-risk import | Admin + import gate | import errors / N | Task 11 migration |
| GET | `/api/admin/task11/import/status` | Import counts | Admin + import gate | import errors / N | Task 11 migration |

## Task 13 membership, entitlements and payment

Metadata and state are in D1. Private QR PNG files are in R2 and never expose object keys.

| Method | Route | Operation | Auth/entitlement | R2 | Error/logout | Test |
|---|---|---|---|---|---|---|
| GET | `/api/membership/plans` | Six current plans + compatible history | Public | No | service error / N | Task 13 |
| GET | `/api/recharge/mine` | Own orders | User | No | canonical only / C | Task 13 |
| GET | `/api/recharge/qr` | Private order QR | Owner | Read | ownership/R2 error / N | Task 13 |
| POST | `/api/recharge/request` | Server snapshot order | User | No | business validation / N | Task 13 |
| POST | `/api/recharge/confirm` | Mark user paid, no fulfillment | Owner | No | state conflict / N | Task 13 |
| POST | `/api/recharge/cancel` | Cancel open order | Owner | No | state conflict / N | Task 13 |
| GET | `/api/admin/recharge` | Payment queue | Admin | No | `forbidden` / N | Task 13 |
| POST | `/api/admin/recharge/process` | Atomic approve/reject | Admin | No | idempotency/conflict / N | Task 13 |
| POST | `/api/admin/membership/manage` | Open/renew/cancel membership | Admin | No | validation/conflict / N | Task 13 |
| POST | `/api/admin/membership` | Compatibility admin operation | Admin | No | validation / N | Task 13 |
| POST | `/api/admin/entitlement` | Explicit entitlement override | Admin | No | validation / N | Task 13 |
| POST | `/api/admin/task13/import` | Idempotent D1/R2 import | Admin + Production confirmation | Write | import errors / N | Task 13 migration |
| GET | `/api/admin/task13/import/status` | Import/inventory counts | Admin + gate | Inventory | import errors / N | Task 13 migration |

## Task 14 temporary sharing

Metadata is in D1. Binary files are private R2 streams. Public readers use unpredictable IDs/passwords or HMAC connection codes and rate limits.

| Method | Route | Operation | Auth/entitlement | R2 | Error/logout | Test |
|---|---|---|---|---|---|---|
| GET | `/api/temporary/capabilities` | Cloud limits/capabilities | Public | Binding state | dependency / N | Task 14 |
| POST | `/api/temporary/text` | Create text share | User + temporary | No | validation/quota / N | Task 14 |
| POST | `/api/temporary/qr` | Create QR/text-kind share | User + temporary | No | validation/quota / N | Task 14 |
| POST | `/api/temporary/clipboard` | Create HMAC code | User + temporary | No | validation/quota / N | Task 14 |
| POST | `/api/temporary/room` | Create room | User + temporary | No | validation/quota / N | Task 14 |
| POST | `/api/temporary/room/clear` | Owner clear | Owner | No | ownership / N | Task 14 |
| POST | `/api/temporary/file/init` | Reserve validated upload | User + temporary | Pending key server-only | validation/quota / N | Task 14 |
| PUT | `/api/temporary/file/upload` | Stream bytes and commit metadata | Owner reservation | Write stream | MIME/signature/R2 / N | Task 14 |
| POST | `/api/temporary/file/cancel` | Cancel reservation | Owner | Delete pending | ownership/R2 / N | Task 14 |
| POST | `/api/share/text/read` | Password/view/destroy read | Public guarded | No | generic not-found/auth/rate / N | Task 14 |
| POST | `/api/share/file/authorize` | Atomically consume download grant | Public guarded | Metadata only | password/limit / N | Task 14 |
| GET | `/api/share/file/download` | Range/retry stream by grant | Public grant | Read stream | grant/R2/range / N | Task 14 |
| POST | `/api/share/clipboard/read` | HMAC-code read/destroy | Public guarded | No | generic not-found/rate / N | Task 14 |
| POST | `/api/share/room/read` | Room read | Public guarded | No | password/expiry / N | Task 14 |
| POST | `/api/share/room/post` | Room message | Public guarded | No | password/quota/rate / N | Task 14 |
| POST | `/api/admin/task14/cleanup` | Expiry/orphan compensation | Admin + import gate | Delete/reconcile | cleanup errors / N | Task 14 cleanup |
| POST | `/api/admin/task14/import` | Idempotent SQLite/R2 import | Admin + Production confirmation | Write/checksum | import errors / N | Task 14 migration |
| POST | `/api/admin/task14/import/rollback` | Remove one import source | Admin + confirmation | Delete imported | rollback errors / N | Task 14 migration |
| GET | `/api/admin/task14/import/status` | D1/R2 migration status | Admin + gate | Inventory | dependency / N | Task 14 migration |

## Task 15 learning, Workers AI and remaining tool data

Quiz authorization, AI cache/usage/leases, favorites, recent usage, and saved configs are in D1. Workers AI is reached only after local dictionary/rules/cache fail.

| Method | Route | Operation | Auth/entitlement | AI | Error/logout | Test |
|---|---|---|---|---|---|---|
| GET, POST | `/api/health` | Cloud learning/AI status | User | Binding state | canonical only / C; AI unavailable / N | Task 15 |
| POST | `/api/quiz/start` | Authorize bounded word set | User + language entitlement rules | No | validation/entitlement / N | Task 15 |
| POST | `/api/vocabulary/suggest` | Local index, then cache/AI fallback | User | Conditional | quota/unavailable / N | Task 15 |
| POST | `/api/japanese/readings` | Local forms, then cache/AI fallback | User + quiz token | Conditional | AI/schema / N | Task 15 |
| POST | `/api/rubric` | Local rubric, then cache/AI fallback | User + quiz token | Conditional | AI/schema / N | Task 15 |
| POST | `/api/judge` | Rule judgement, then AI fallback | User + quiz token | Conditional | AI/schema / N | Task 15 |
| GET | `/api/tools/access` | Entitlement and preference counts | User + tools | No | `membership_required` / N | Task 15 |
| GET | `/api/tools/preferences` | Favorites/recent/configs | User + tools | No | canonical/membership / C/N | Task 15 |
| POST | `/api/tools/favorite` | Upsert/remove favorite | User + tools | No | validation / N | Task 15 |
| POST | `/api/tools/recent` | Bounded usage metadata only | User + tools | No | validation/rate / N | Task 15 |
| POST | `/api/tools/history/clear` | Clear own usage metadata | User + tools | No | canonical only / C | Task 15 |
| POST | `/api/tools/config/save` | Strict config/workflow save | User + save config | No | schema/limit / N | Task 15 |
| POST | `/api/tools/config/delete` | Delete own config | User + save config | No | ownership / N | Task 15 |
| GET | `/api/admin/tool-stats` | Aggregate usage metadata | Admin | No | `forbidden` / N | Task 15 |
| POST | `/api/admin/task15/import` | Stable-ID idempotent tool import | Admin + import confirmation | No | import conflict / N | Task 15 migration |
| POST | `/api/admin/task15/import/rollback` | Remove import source only | Admin + confirmation | No | rollback error / N | Task 15 migration |
| GET | `/api/admin/task15/import/status` | Import counts | Admin + gate | No | dependency / N | Task 15 migration |

## Browser-local former server features

| User feature | Current handler | Server/API dependency | Validation |
|---|---|---|---|
| Wrong-book PDF | `js/language/pdf.js` canvas pages + local PDF writer | None | PDF signature, page count, browser download tests |
| Multiple images to PDF | `tools.js` local image decode + PDF writer | None | independent artifact parser in toolbox tests |
| Image to PDF | `tools.js` local image decode + PDF writer | None | independent artifact parser in toolbox tests |
| Text/file/image/random tools | browser modules under `js/tools/` | None except optional cloud metadata | functional audit and browser toolbox matrix |

## Retired Production paths

- `/api/export-pdf`: retired; equivalent output is generated in the browser.
- `/api/temporary/file`: retired Base64 upload; only `/init` then binary `/upload` is allowed.
- `/api/share/file/read`: retired Base64 download; only `/authorize` then streamed `/download` is allowed.
- `LOCAL_API_BASE`, `api.thewyj.uk`, Python `8765`, Ollama `11434`, `legacy-api.mjs`, and `task12-bridge.mjs`: absent from the deployed module graph.
- Historical Python implementations remain only for local regression fixtures and manual rollback analysis. They are not a Production source of truth or request fallback.
