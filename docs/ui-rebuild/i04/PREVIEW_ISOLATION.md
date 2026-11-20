# I04 Isolated Hosted Preview Report

## 1. Strict Isolation Verification
- **Dedicated Pages Project**: `thewyj-i04-preview` (separate from `thewyj-uk` Production and separate from `thewyj-i03-preview` so I03's accepted preview snapshot `https://i03-public-pages.thewyj-i03-preview.pages.dev` remains untouched).
- **Preview Branch**: `i04-workspace` (`production_branch` remains `release-held`; Production NOT published).
- **Isolated Preview URL**: `https://i04-workspace.thewyj-i04-preview.pages.dev`
- **Dedicated Non-Production D1**: `aeris-i04-preview` (`bd1c84a6-dc4d-4814-836e-2b6ce477a641`, all `0001..0040` migrations applied, completely separate from `wyj-cloud-production` `11c288d8-c584-409f-bb1f-7e7af11793e5`).
- **R2 Buckets**: `0` bound (`r2_buckets: []`).
- **Workers AI & Email**: Disabled (`WORKERS_AI_ENABLED: "false"`, `EMAIL_SENDING_ENABLED: "false"`, `LEGACY_API_FALLBACK_ENABLED: "false"`).
- **Deploy Script**: `qa/i04/stage-preview.mjs --deploy` enforces pre-deploy AND post-deploy Cloudflare API verification confirming `WYJ_DB` ID equals `bd1c84a6-dc4d-4814-836e-2b6ce477a641`, R2 count is `0`, and deployed commit hash matches Git `HEAD`.

## 2. Live Preview Acceptance & P07 Toggle Verification
- Script: `qa/i04/verify-preview.mjs`
- Checks verified against live `https://i04-workspace.thewyj-i04-preview.pages.dev`:
  1. `/api/status`, `/api/health`, `/api/ui/features`, `/api/membership/plans` return `200 OK` (`public_ui.enabled === true`).
  2. Guest `/` hides `#authWorkspaceSection` cleanly.
  3. Ephemeral synthetic Account A registers via `/api/register`, signs in, navigates `/select`, enters Edit Mode, moves `finance`, toggles `compact` density, saves, and verifies persisted order/density across `Page.reload`.
  4. Desktop detail modal (`#workspaceDetailModal`) opens cleanly and passes `axe-core` (`0` serious/critical violations).
  5. Mobile `390×844` layout passes `axe-core` (`0` serious/critical violations).
  6. Logging out A and signing into ephemeral Account B confirms B receives default workspace config with zero leakage from A.
  7. P07 OFF fallback verified in D1 + Chrome acceptance.
- Evidence saved in `docs/ui-rebuild/i04/evidence/i04-preview-stage.json`, `docs/ui-rebuild/i04/evidence/i04-preview-verification.json`, and `docs/ui-rebuild/i04/evidence/preview/*.png`.
