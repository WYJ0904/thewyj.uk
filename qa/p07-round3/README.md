# P07 Round 3 independent browser acceptance

Run from the independent `codex/p07-round3-independent-qa` checkout. Product
inputs are clean, detached snapshots; neither Flash's active checkout nor the
fixed Hotfix checkout is a test input.

| Input | Pinned revision | Worktree name |
| --- | --- | --- |
| RED | `21b83316cbfdeb366c587b9e818a2c64e2199215` | `p07-round3-red-baseline` |
| Flash candidate | `fb936d109d0900d02d35eb3493212e4c32c39699` | `p07-round3-flash-review` |
| Additional CI-fix candidate found at closeout | `f7949f8253f51ea2621c397743208971c0cec467` | `p07-round3-final-ci-review` |

## Reproduction

The repository's locked Node dependencies and Windows Chrome are required.
Use `npm ci --ignore-scripts --no-audit --no-fund`; do not upgrade Wrangler.
The existing P07-D runtime launcher and compiled-worker adapter were reused
from QA commit `0f2050bc8b76cfe2a6a8f2daf623d2dbafd6dd9e`. Browser transport is
the existing dependency-free `local-backend/browser_harness.mjs`.

```powershell
$env:P07_D_TARGET_ROOT=Join-Path $env:USERPROFILE '.codex/worktrees/p07-round3-red-baseline/thewyj.uk'
$env:P07_D_RUN='new-red-label'
node qa/p07-d/run.mjs --compiled-runtime --round3

$env:P07_D_TARGET_ROOT=Join-Path $env:USERPROFILE '.codex/worktrees/p07-round3-flash-review/thewyj.uk'
$env:P07_D_RUN='new-candidate-label'
node qa/p07-d/run.mjs --compiled-runtime --round3 --p4-workspace --preview-readonly

# Same local fixtures with the server's P07 flag OFF or killed.
$env:P07_D_RUN='new-off-label'
node qa/p07-d/run.mjs --compiled-runtime --round3 --flag-off
$env:P07_D_RUN='new-kill-label'
node qa/p07-d/run.mjs --compiled-runtime --round3 --kill-switch

# Additional fixed CI-fix candidate, keeping the original two results intact.
$env:P07_D_TARGET_ROOT=Join-Path $env:USERPROFILE '.codex/worktrees/p07-round3-final-ci-review/thewyj.uk'
$env:P07_D_RUN='new-final-ci-label'
node qa/p07-d/run.mjs --compiled-runtime --round3 --primary-workspaces --p4-workspace --preview-readonly

# Only the migrated original P4 CI browser case.
$env:P07_D_RUN='new-p4-label'
node qa/p07-d/run.mjs --compiled-runtime --p4-workspace

# Additional real feedback-column measurements and expanded-card screenshots.
$env:P07_D_RUN='new-layout-label'
node qa/p07-d/run.mjs --compiled-runtime --layout-supplement

# Same-origin cached RED -> candidate upgrade. The input must be RED.
$env:P07_D_TARGET_ROOT=Join-Path $env:USERPROFILE '.codex/worktrees/p07-round3-red-baseline/thewyj.uk'
$env:P07_D_RUN='new-cache-upgrade-label'
$env:P07_D_UPGRADE_CANDIDATE_SHA='fb936d109d0900d02d35eb3493212e4c32c39699'
node qa/p07-d/run.mjs --compiled-runtime --cache-upgrade

# Repeat the upgrade gate against the additional CI-fix candidate.
$env:P07_D_UPGRADE_CANDIDATE_SHA='f7949f8253f51ea2621c397743208971c0cec467'
$env:P07_D_RUN='new-final-ci-cache-label'
node qa/p07-d/run.mjs --compiled-runtime --cache-upgrade
```

Evidence labels cannot be reused. Full logs, random local credentials, D1/R2
state and Chrome profiles stay in ignored `docs/migration-evidence/p07-d/`
and `.wrangler/`. Selected synthetic screenshots and sanitized JSON are retained
under `docs/p07/evidence/round3/`.

Default ports are Pages `18949`, Chrome CDP `19349`, and inspector `19359`.
For independent concurrent runs set `AERIS_PHASE1_BASE_URL` and
`AERIS_PHASE1_CDP_URL` to unused loopback ports; the inspector is CDP + 10.
Each run has separate persistence and a separate browser profile. Occupied
ports are rejected. Cleanup stops only processes bearing this run's marker.

## Assertions and evidence

| Contract | Observable acceptance |
| --- | --- |
| Member/account pages | Visible surface inside `#v3MainCanvas`; no modal layer, body lock or inert application shell; actual sidebar hit and resulting visible destination; Tab can reach unobscured navigation. |
| Sole primary surface | `--primary-workspaces` checks direct account, direct membership and finance-upgrade membership. Only the requested primary surface may remain exposed; a second visible finance page cannot pass merely because the membership section and URL exist. This supplement is replayed on all three fixed revisions. |
| Finance upgrade | After actual package loading settles, the finance goal is selected and the three original finance plans are rendered. Manual selection is a separate case and cannot erase a failed shortcut. |
| Original membership/security | Local synthetic order, user-paid signal without rights, administrator approval, rights only after approval; key change revokes the old session and old key. No real payment occurs. |
| Home cards | First open the real `#homeProductDetails` disclosure. For all five cards record title, description and three surface coordinates, `elementFromPoint`, trusted mouse/touch results, internal CTA and Enter/Space activation. Keyboard PASS also requires a trusted native click, so focus-driven expansion alone is insufficient. |
| Learning geometry | Both languages at 1024/1440/1920; compare the card center with the main canvas, tolerance 3 CSS px for subpixel layout; record dimensions and real right-panel content. |
| Learning state | Five independent views; actual submit/feedback/next/skip; refresh of an unfinished round; English/Japanese word lists and wrong answers remain isolated. |
| AI boundary | Known local rubric and rules are reported as local. Unlisted rubric and kana failure handling run with AI disabled. Provider quality is `NOT_TESTED`. |
| Finance | Three real local D1 transactions; exact CNY minor-unit totals; visible totals, SVG points/ticks/bounds, single-line amounts, filter, edit/delete updates and empty state. |
| Refresh | A new document identity must appear before any reload assertion. Capture RAF DOM states, policy mutations, paint entries, resource versions, SW/cache identity and real screenshots for all six required routes. |
| Policy race | A separate deterministic transport case delays a fresh, actual `/api/ui/features` response by 1200 ms and checks for visible legacy frames before ON. It changes no UI code or policy value and does not hide a flash. |
| OFF / Kill Switch | Actual local server decision is OFF; guest and authenticated UI settle to disabled, account controls and membership choices still work, and finance/admin guards remain enforced. |
| Administrator | Legitimate local super-admin fixture; actual user list, membership approval, audit views, 401/403/200 boundary and 1440/390 layout. |

`round3-browser-results.json` retains every case status and failures. Any failed
assertion makes the suite exit nonzero. `driver-manifest.json` fixes driver
hashes; `source-manifest.json` fixes the served product bytes. No assertion is
rewritten between RED and candidate runs. Earlier faulty driver runs remain
archived with the correction reasons in the report.

`--p4-workspace` runs the original P4 browser case with its account-modal Escape
assumption replaced by `account-workspace-contract.mjs`. It retains the eight
account-setting rows and checks actual page structure and trusted navigation
at all three existing widths. The original remote failure remains in
`docs/p07/evidence/round3/ci-failures.json`. The finance-choice CI assertion is
retained because it detects a real candidate regression.

`--preview-readonly` checks only unauthenticated GET behavior and screenshots
on the two owner-supplied immutable Preview URLs. It compares five selected
text assets with each pinned Git revision after LF normalization. Mutating API
requests are blocked before networking. These checks do not establish Hosted
account, administrator, payment, real AI, CI completion or Production acceptance.

Chrome CDP mouse/keyboard events are real browser input. Touch is Chromium
touch emulation, not physical touch or Android evidence. No phone, Production
binding, remote migration, model binding, signing material or Stable pointer is
used by this runner.
