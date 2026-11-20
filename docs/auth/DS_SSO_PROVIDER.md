# Aeris DS SSO Provider

Task 05 adds a confidential-client authorization-code provider for the DS Preview branch. Its source identity is the Aeris account ID from the existing Task 12 Web session. The authorization page requires explicit consent and a fresh Task 27 Step-up proof. Aeris supplies its configured password/MFA flow and checks policy reacceptance, password-change requirements, account standing and both security generations.

| Registration | Preview value |
| --- | --- |
| Issuer | `https://codex-aeris-ds-sso-integrati.thewyj-uk.pages.dev` (Cloudflare's reported branch alias) |
| Client ID | `ds-task05-preview` |
| Redirect URI | `https://codex-ds-task05-aeris-sso.ds-thewyj-uk.pages.dev/api/auth/callback` |
| Encrypted credential | `AERIS_DS_SSO_CLIENT_SECRET` (Aeris) and `AERIS_CLIENT_SECRET` (DS) |
| Environment gate | `WYJ_ENVIRONMENT=preview` and exact issuer hostname, with a separate local loopback test mode |

## Protocol

The browser requests `GET /api/sso/ds/authorize` with the registered client, redirect URI, random state and PKCE S256 challenge. The page uses the same-origin Aeris Web session and calls `POST /prepare` under the same prefix. The server issues a five-minute nonce bound to the source session, account, policy gate, security version and the original DS parameters. Through the existing Task 27 endpoints, the user completes Step-up for the exact `ds_sso_authorize:<nonce>` scope. `POST /approve` requires that proof, the same source session, explicit consent and a same-origin custom header. It consumes the proof in the same D1 transaction that issues a code. Cancel returns to the same registered DS callback with `error=access_denied`.

`POST /api/sso/ds/exchange` requires Basic client authentication, the exact redirect URI, the authorization code and its PKCE verifier. The code lasts at most 60 seconds, and a single D1 batch claims it and inserts the grant. The response has `iss/aud/sub/grant_id/iat/exp`. A grant lasts up to eight hours and expires by the source session's original deadline. It contains the stable Aeris ID and never exposes passwords, Web session credentials, email or permissions.

`POST /api/sso/ds/introspect` requires the same authenticated client. It rechecks grant registration and lifetime, Task 12 source session and account, Task 27 security generation and current policy before returning `active:true`. A known inactive grant records its revocation reason and time. The grant cannot become active again. Single logout revokes the source session's grants, while a password/MFA/security generation change or global logout affects all associated grants.

## Safety and operations

- Browser writes require exact same-origin `Origin` and `X-Aeris-SSO: 1`. The envelope allows only known fields and caps JSON at 128/512 bytes and backchannel forms at 1 KiB. All responses are no-store and avoid referrer propagation. The first-party authorization page forbids framing, external connections and form navigation.
- Existing Task 27 rate limiting covers the authorization page at 90/minute per request source, prepare and approve at 12/minute per account, exchange at 120/minute per client and introspection at 600/minute per client. Step-up keeps its own limits, logging and MFA handling. The SSO store keeps time/status evidence for seven days after expiry, with bounded opportunistic cleanup. Unhandled errors log only a fixed event and known route.
- Error responses include `400 invalid_request/invalid_grant` for invalid inputs, `401 invalid_client` for failed client authentication, `401/403/428` for source/session/policy gates, `409` for an authorization changed during approval, `429` for rate limit and `503 sso_unavailable` for a missing schema or service failure. Disabled stages/origins return 404. Inactive, missing and revoked grants return the same `200 {"active":false}` shape.
- `0041_ds_sso_provider.sql` adds two tables and their indexes, depending on Task 12/27. When shared Preview is at `0037`, a scoped `wyj_ds_sso_preview_migrations` ledger can install the single idempotent migration without applying Task 28–30 or reordering `wyj_d1_migrations`. Use a Preview-only configuration with the verified UUID and a migration directory containing only the hash-checked file. The normal migration chain can later record `0041` in order after `0038–0040`.
- Before remote changes, inspect the binding, both ledgers, this component's schema, recent activity and foreign keys, then record the current D1 Time Travel bookmark. Afterward compare the original ledger and selected data counts, verify the new ledger and foreign keys, and retain the result separately from CI. If rollback is needed, disable the branch feature first. An entire database restore needs a separate decision because it can discard other Preview writes.

On 2026-11-20 at 14:45 Hong Kong time, Wrangler applied the scoped `0041` to `wyj-cloud-preview` (`a3e6253b-689f-49f3-998b-7c5828ea255a`). The 38-row canonical ledger through `0037`, existing schema and selected account/security/session counts matched the preflight. The two tables, four indexes and single scoped ledger row were verified and the foreign-key check returned zero. The pre-migration Time Travel bookmark and sanitized checks are retained under the ignored `.wrangler/task05-preview-proof-20261120T064513Z` evidence directory.

`npm run test:ds-sso` builds actual Pages Functions and tests the provider with local workerd and D1 at the 0037 compatibility boundary. Task 12, Task 20 and Task 27 regression checks run separately. See the Draft PR for exact-head CI and Hosted evidence. [DS integration](https://github.com/WYJ0904/ds.thewyj.uk/pull/6)
