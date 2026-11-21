# Aeris ownership verification for DS Task 07

Aeris verifies the credentials of one account at a time for the purpose `ds_account_ownership_v1`. On success the signed DS backchannel receives a receipt for the authenticated subject. Aeris creates the receipt without creating a target login session, DS login grant, or account mapping. The password check calls the same Task 12 verifier and uses the same identifier rate limits as login. When enrolled, the target must use its current Task 27 TOTP or Aeris email factor. The prompt stays inside DS. The existing Task 27 unique index for verified security emails remains in effect.

## Backchannel

`POST /api/internal/ds-identity/v1` retains its signed body, nonce, client and issuance window checks. The DS server supplies the current native actor grant, an opaque binding generated for the verification attempt, and the DS-verified, normalized contact address. Aeris does not search by that address. It compares the supplied address to the authenticated target's verified Aeris security email and returns a boolean only after the target completes verification. DS applies its own duplicate-email candidacy rules against the target's stable identity.

| Operation | Signed input | Result |
| --- | --- | --- |
| `ownership_start` | `username`, `secret`, `contact`, plus the actor grant and attempt binding | `mfa_required` and the enrolled method/expiry, or `verified` with a receipt. Absent accounts, incorrect credentials, banned accounts, pending policy or mandatory password changes, and recovery holds share the same denial response. |
| `ownership_verify` | `code`, `contact`, plus the same actor grant and binding | A receipt after one atomic Task 27 challenge consumption. A bad code may be retried within the existing five-attempt and expiry limits. A closed attempt requires a new password check. |
| `ownership_status` | `refs`, up to 16 distinct receipt IDs, plus the same actor grant | Active IDs only. The operation checks actor grant, subject security and session generations, policy versions and expiry against live D1 state. |

Receipts expire no later than 10 minutes after issue and no later than the actor grant. They carry the actor and target stable Aeris subjects, issuer, audience, purpose, attempt binding, enrolled factor result, target generations and expiry. Stored receipts bind the same Aeris policy versions as the native grant. They do not carry a login cookie, password, OTP, recovery code or a canonical MFA challenge. The canonical challenge handle remains sealed in Aeris. DS requires its own active session, records the receipt at most once, and owns user cancellation, revocation and downstream consumption.

## Password recovery

A mailbox password reset can create a new password for the same mailbox holder. `0043_ds_account_ownership.sql` places accounts with retained or future canonical password-recovery events into manual review for Task 07. The existing events do not distinguish the factor used to recover. This conservative rule also holds accounts recovered using a stronger factor. An ordinary password change invalidates prior receipts through the session/security generations and allows fresh verification. Task 12/27 login, recovery and account management continue to behave as before. The review workflow can issue a short, single-use eligibility to reauthenticate. The target password and its current enrolled factor must be verified again before any receipt is issued. [Recovery review runtime contract](DS_OWNERSHIP_REVIEW_POLICY.md)

## Preview and compatibility

The alternate Provider host accepts only the pinned Task 07 DS origin and uses the same canonical issuer and client identity. Native grants issued through the alternate host are scoped to that DS origin. The exact host gate and `AERIS_DS_OWNERSHIP_ENABLED` apply to the Preview only. Local development uses the existing loopback registration with the flag explicitly enabled. Changing the canonical issuer would change stable DS identities.

Use only the authorized isolated Preview database. The scoped Aeris ledger requires `0041` and `0042` before the additive `0043`. Verify the binding UUID, canonical and scoped ledgers, recoverable D1 bookmark, foreign keys and account counts before writing. Confirm the existing canonical ledger and security email constraint after applying `0043`. Treat local, CI and Hosted checks separately. The Provider feature can be closed independently of the existing native identity endpoint. [D1 migration reference](https://developers.cloudflare.com/d1/reference/migrations/) · [Native identity contract](DS_SSO_PROVIDER.md)

I04 and I05 continue to use the existing account profile route, Step-up scope, revision handling and stable account identity. The Task 07 implementation uses server-side code and an additive schema. `npm run test:ds-sso` exercises legacy and Task 07 calls in Core CI, including the local Preview hostname registration simulation. Task 27’s existing Chrome regression suite exercises its current shell, security controls and policy pages. [I05 handoff](https://github.com/WYJ0904/thewyj.uk/blob/b5ebd1dadb523e442166be6dde7518f19ef9e5ef/docs/ui-rebuild/i04/I05_HANDOFF.md)

## Task 08 read-only account projection

The Task 08 Preview registers a separate exact DS backchannel origin through the existing Aeris ownership transport. It keeps the original canonical issuer and stable subject. The signature selects the registration and each Grant remains bound to that origin. The exact Task 07 and primary registrations retain their current behavior. Production does not enable the projection.

The signed operation `merge_preview_accounts` accepts a list of scoped Task 07 proof references and the actor Grant. An empty list permits the actor-only view. The response includes the current Task 12 username and registration timestamp, the authoritative Task 12/18 role, a Task 27 email verification boolean, and authorized Task 13 membership/entitlement data. Members with expired rows are filtered by read-only queries; the normal membership path keeps its existing expiry maintenance. Missing membership capability or unverifiable schema returns `NEEDS_REVIEW`. The Provider rechecks the Grant and each proof after the membership read. The operation accepts no arbitrary account identifiers and returns no private email, finance, wallet or payment data.
