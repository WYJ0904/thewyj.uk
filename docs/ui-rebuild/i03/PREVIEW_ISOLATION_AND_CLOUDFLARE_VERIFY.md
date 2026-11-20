# Isolated Hosted Preview & Cloudflare Verification Report (I03 + I07)

## 1. Isolation Guarantee (A3 Remediation)

- **Dedicated Pages Project**: `thewyj-i03-preview` (created specifically for I03 + I07 closeout so existing shared preview bindings on `thewyj-p07-ui-rc` and production bindings remain 100% untouched).
- **Preview Alias URL**: `https://i03-public-pages.thewyj-i03-preview.pages.dev`
- **Production Pointer Protection**: `production_branch` = `release-held` (untouched); preview deploys target branch `i03-public-pages`.
- **Isolated D1 Database**: `WYJ_DB` -> `ee869f78-b54a-4018-bc99-871089ecb8cd` (`p07-ui-rc-isolated`), migrated to `0040` (`145` tables including `task25_feature_flags`, `task27_security`, `task30_metadata`). Never Production D1 (`11c288d8-c584-409f-bb1f-7e7af11793e5`).
- **R2 Buckets & Workers AI**: `deployedR2: null` (`{}` / 0 buckets), `deployedAi: null` (`{}` / 0 bindings).
- **Safe Var Overrides**: `WORKERS_AI_ENABLED = "false"`, `LEGACY_API_FALLBACK_ENABLED = "false"`.

## 2. Verified Cloudflare Deployment Metadata

From `node qa/i03/stage-preview.mjs --deploy` (`source_commit`: `ec7646707e2c2ffbff0f063a2f64788a2373ac09`):

| Field | Observed Value |
|---|---|
| Deployment ID | `dd52dfbe-c998-45d7-9561-2669e1b18f1e` |
| Deployment URL | `https://dd52dfbe.thewyj-i03-preview.pages.dev` |
| Branch Alias URL | `https://i03-public-pages.thewyj-i03-preview.pages.dev` |
| Artifact File Count | `208` |
| Artifact Tree SHA-256 | `4c73c10bf47259c77273ae37976064ab7684df06cd1ab04262bfc7e4589702cc` |
| Bound D1 (`WYJ_DB`) | `ee869f78-b54a-4018-bc99-871089ecb8cd` (`p07-ui-rc-isolated`) |
| Bound R2 | `null` (`0` buckets) |
| Bound Workers AI | `null` (`0` bindings) |
| Functions Worker | Compiled and uploaded alongside `./pages-output` static bundle |
| Fixture Path | `/__preview/i07-fixture.html` (headers: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`) |

## 3. Live Hosted Checks (`verify-preview.mjs` + P07 ON/OFF Toggle)

1. **`GET /api/ui/features` (P07 ON)**: `200 OK`, `public_ui.flag_key = "p07_accessibility"`, `enabled = true`, `reason = "public_stable"`.
2. **`GET /api/membership/plans`**: `200 OK`, `8` plans returned from isolated D1.
3. **`GET /api/app/config`**: `200 OK`, Android latest version `"1.3.41"` returned.
4. **All 6 Public Routes in Headless Chrome (`1440x900`)**:
   - `/`, `/trial`, `/download`, `/changelog`, `/login`, `/register`: `overflowX = 0` on all 6 routes, `axe-core` `0` violations across all 6 hosted scans (`42`–`47` passes per route).
5. **Interactive Hosted Home Checks**:
   - Tab switch `#publicToolsTab` (140ms skeleton settle), `#publicTextInput` JSON format via `#publicJsonFormatQuickBtn` succeeded cleanly.
   - Multi-stage Scroll 3D verified: `--ds-scroll-rx` progressed into exit tilt (`-8deg`).
   - Scroll to footer `#publicDownloadBtn` -> click -> landed on `/download` at `scrollY <= 2`.
6. **Hosted `/__preview/i07-fixture.html` Check**:
   - `data-aeris-motion-ready === "true"`, Switch thumb containment verified (`switchOverflowCount = 0`).
7. **Hosted Mobile `375x844` Check**:
   - Zero horizontal overflow (`overflowX = 0`), `0` runtime errors.
8. **Hosted `P07 OFF` Fallback Verification (isolated DB `ee869f78` only)**:
   - Temporarily set `enabled = 0` on `task25_feature_flags` (`p07_accessibility`), verified `/api/ui/features` returned `enabled: false, reason: "global_off"`, confirmed `/` rendered cleanly (`data-p07-ui="disabled"`, `data-interface-policy="disabled"`, `overflowX: 0`, `bentoCount: 5`, zero runtime errors), then immediately restored `enabled = 1` and verified `reason: "public_stable"`.
   - Captured evidence screenshots in `docs/ui-rebuild/i03/evidence/preview/`.

## 4. Residual Environment Scope

- Hosted preview does not connect to Production D1/R2 (`NOT_TESTED` by design for strict isolation).
- Live email delivery, live payment gateway settlement, and Android physical device APK installation remain `NOT_TESTED` in this UI preview scope.
