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

I04 #166 changes security-center presentation, password fields and session consumption. The I05 handoff covers module pages including /account and /admin. The shared contract belongs to this canonical account service. Later I-series changes need to retain stable IDs, policy and challenge behavior, profile revision checks, and cross-project revocation. See the DS contract for the handoff. [DS PR #6](https://github.com/WYJ0904/ds.thewyj.uk/pull/6) · [Aeris I04 PR #166](https://github.com/WYJ0904/thewyj.uk/pull/166)

Run `npm run test:ds-sso` for the compiled Pages/D1 provider on the `0037 + 0041 + 0042` compatibility path. Real Preview browser and mail checks are reported separately.
