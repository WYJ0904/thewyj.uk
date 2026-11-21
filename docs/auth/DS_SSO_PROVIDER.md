# Aeris account authority for DS

Task 05 is a native DS experience. The browser stays on DS, and Aeris validates the credentials through its existing Task 12 login and Task 27 account security. The historical `/api/sso/ds/*` routes return 404. There is no authorization code or redirect in the active contract.

## Preview registration and lifecycle

| Setting | Value |
| --- | --- |
| Registered Aeris issuer | `https://codex-aeris-ds-sso-integrati.thewyj-uk.pages.dev` |
| Registered DS origin | `https://codex-ds-task05-aeris-sso.ds-thewyj-uk.pages.dev` |
| DS client | `ds-task05-preview` |
| Client authentication | Signed HTTPS request at `POST /api/internal/ds-identity/v1` |
| Secret bindings | Existing paired `AERIS_DS_SSO_CLIENT_SECRET` / `AERIS_CLIENT_SECRET`. `AERIS_DS_NATIVE_SEAL_KEY` exists only in Aeris Preview |

Both deployed applications are Pages projects. The current environment has no standalone identity Worker Service Binding target. The HTTPS path validates exact stage, TLS/host, client, signature, time, nonce and full bounded request body. It rate-limits account operations and reuses normal Task 12/27 limits with the signed client IP. Errors log fixed operation names; password and OTP values stay in transient request processing. [Pages Service Bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings)

The explicit operation map covers registration, password login, login MFA, password reset and force change, policy reacceptance, profile read/save, password, security email, MFA, recovery codes, devices and introspection/revoke. Browser-safe transfer contains only required fields. Canonical Aeris session and step-up/challenge credentials remain encrypted in Aeris. A successful login issues a separate native Grant for the DS client with pollable status and an eight-hour maximum. Device logout, account-wide revocation, current policy or security generation changes invalidate the Grant. DS revokes only the source belonging to the current grant when logging out.

Aeris and DS share the same account name and optimistic revision from `/api/account/profile`. The Aeris security center reads and updates this route directly. DS calls the narrow backchannel, using the same Task 27 `profile_change` proof. Username changes preserve the immutable account ID and future DS mapping. Stale `expected_revision` fails with 409. Most security writes invalidate earlier sessions using Aeris policy.

## Deployment and I-series compatibility

The `0042` SQL adds the nonce ledger and encrypted envelopes to the `0041` Grant schema. It can be installed on the scoped Preview migration ledger once `0041` is present; no need to advance shared `wyj_d1_migrations` through unrelated work. Preserve the original `0037` ledger, confirm the database identity and current recovery point, and compare the existing schema/selected account counts. Scope and evidence for actual deployment are recorded in the Draft PR.

At 15:28 Hong Kong time on 2026-11-20, the verified Aeris Preview UUID `a3e6253b-689f-49f3-998b-7c5828ea255a` advanced its scoped ledger to `0042`. `0041` was skipped as applied. The canonical ledger through `0037`, existing schema and selected counts were unchanged. Foreign key violations were zero. Preflight, Time Travel and post-migration results are stored in `.wrangler/task05-native-preview-20261120T072837Z`.

### I04 and I05

I04 `b5ebd1dadb523e442166be6dde7518f19ef9e5ef` was combined with Task 05 `925c32cb422e3d72cdd71195fe86f494433b10e8` in an isolated checkout. The sole conflict was `sw.js`. The compatibility build used I04’s release label and 81-entry shell, then regenerated the integrity manifest from the combined source. The staging build, eight Provider groups, 24 PWA checks, 11 Task 27 browser checks, and 11 I04 browser scenarios passed. Existing password, MFA and device controls initialize before the optional profile request. The I04 branch stays independent. [Aeris I04 PR #166](https://github.com/WYJ0904/thewyj.uk/pull/166)

I05 may update the account and admin presentation. Keep the shell and modal mounting contracts, field authority, stable user ID and issuer, `/api/internal/ds-identity/v1`, and the shared profile read/write boundary. Profile edits retain Step-up and `expected_revision` with a 409 on stale writes. Password, MFA, policy, session expiration and device revocation retain their version checks. If the protocol changes, keep a compatible version during migration and verify profile updates, stale writes, old session invalidation, and existing DS identity mappings in both repositories. Aeris owns canonical account fields, credentials and security state. DS owns its independent business eligibility and session. [I05 handoff](https://github.com/WYJ0904/thewyj.uk/blob/b5ebd1dadb523e442166be6dde7518f19ef9e5ef/docs/ui-rebuild/i04/I05_HANDOFF.md) · [DS PR #6](https://github.com/WYJ0904/ds.thewyj.uk/pull/6)

### Hosted acceptance

Aeris Preview `59ac4198` and DS Preview `2e8e96c1` verified native browser registration, password login, TOTP enrollment and sign-in, and DS logout in the protected DS preview. Additional HTTPS checks verified recovery-code sign-in and reset, forced password change, profile edits through both sites, stale revisions, per-device and account-wide revocation, and DS suspension while Aeris login remained available. A request without a client signature returned 401. Valid-signature timing and nonce replay tests ran on an isolated local runtime. On 2026-11-21 DS Preview `3dab8cf9` and Aeris Preview `f0660daa` verified real delivery through Cloudflare Email Routing into the authorized Gmail inbox. The test used a disposable ordinary account and the DS HTTPS routes for email binding and password recovery. Invalid, expired and spent email codes were refused. The fourth request in the account's recovery window returned 429. A new password restored the same stable DS identity and both prior device sessions and Grants failed. The verified Aeris email left DS eligibility pending. Aeris kept redacted delivery receipts and two password recovery audit events. The temporary recipient was removed from the Preview allowlist and standard configuration was redeployed as `69ed8f49`. The test identity and sessions were deactivated and its verified email binding was released. [Hosted results](https://github.com/WYJ0904/ds.thewyj.uk/pull/6) · [Candidate Core CI](https://github.com/WYJ0904/thewyj.uk/actions/runs/44707608073)

Run `npm run test:ds-sso` for the compiled Pages/D1 provider on the `0037 + 0041 + 0042` compatibility path. Real Preview browser and mail checks are reported separately.
