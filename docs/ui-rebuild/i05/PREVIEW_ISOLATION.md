# Isolated Hosted Preview Evidence (`thewyj-i05-preview`)

## 1. Resource Isolation Proof
Provisioned via `node qa/i05/provision-preview.mjs` (`evidence/i05-preview-provision.json`):
- **Pages Project**: `thewyj-i05-preview` (`production_branch: "release-held"`)
- **Preview Branch**: `i05-workspace-density` (never matches `production_branch`)
- **Dedicated Preview D1**: `aeris-i05-preview` (`database_id: 9e76a190-42db-4ff1-b0b7-476e4b312792`)
  - Completely separate from Production D1 (`11c288d8-c584-409f-bb1f-7e7af11793e5`) and I04 Preview D1 (`bd1c84a6-dc4d-4814-836e-2b6ce477a641`).
  - All Cloudflare migrations applied cleanly (`wyj_d1_migrations`), `p07_accessibility=1` seeded.
- **Disabled Non-Target Services**:
  - `r2_buckets`: `[]` (`0` R2 buckets bound; Production R2 never bound)
  - `ai_bindings`: `[]` (`0` AI bindings)
  - `WORKERS_AI_ENABLED`: `"false"`
  - `EMAIL_SENDING_ENABLED`: `"false"`
  - `LEGACY_API_FALLBACK_ENABLED`: `"false"`
- **Ephemeral Preview Secrets**: Fresh random `secret_text` bindings (`WYJ_TASK12_PASSWORD_PEPPER`, `WYJ_TASK14_TEMPORARY_SECRET`, `WYJ_TASK20_DEVICE_SESSION_SECRET`), independent of Production secrets.

## 2. Deployment & Integrity Verification
Staged & deployed via `node qa/i05/stage-preview.mjs --deploy` (`evidence/i05-preview-stage.json`):
- **Staged Source Commit**: `e4e781f2ad5e4cc791f70a2880952d683c041368` *(Note: subsequent documentation and QA-script commits modify only `docs/ui-rebuild/i05/**` and `qa/i05/**`, neither of which enters the allowlisted 208-file runtime output staged by `stage_pages_deploy.mjs`; therefore the deployed Preview binary/asset tree remains bit-for-bit identical.)*
- **File Count**: `208`
- **Artifact Tree SHA-256**: `27b7c4f983f1ad44f2fde7c87fa87b9a4c119b8b791c378ad62df4c3fc98476a`
- **Deployment ID**: `f3304762-c50d-4ead-a52b-fa079838e0ee`
- **Preview URLs**:
  - Alias URL: `https://i05-workspace-density.thewyj-i05-preview.pages.dev`
  - Deployment URL: `https://f3304762.thewyj-i05-preview.pages.dev`
- **Remote Binding Assertion**: `deployedD1Id === 9e76a190-42db-4ff1-b0b7-476e4b312792`, `deployedR2Count === 0`, `deployedAiEnabled === "false"`.

## 3. Live Preview Functional Verification (`node qa/i05/verify-preview.mjs`)
- **Result**: **PASS** (`status: "PASS"`, `axeScans: 6`, `screenshots: 5`, `runtimeErrors: []`, `production_release: "NOT_TOUCHED"`).
- **Endpoint Checks**:
  - `/api/status`: `{ ok: true, environment: "preview" }`
  - `/api/ui/features`: `public_ui.enabled === true`
  - `/__preview/build.json`: confirmed `project_name: "thewyj-i05-preview"`, `targetD1Name: "aeris-i05-preview"`
  - `/api/health`: returned unauthenticated auth-gate JSON (`401 {"ok":false,"code":"authentication_required"}`), reflected accurately as `apiHealthOk: false` in `i05-preview-verify.json` because `/api/health` is routed through the authenticated catch-all worker handler rather than an unauthenticated health probe.
- **Interactive Preview Flow**:
  - All 7 routes checked (`home`, `language`, `tools`, `finance`, `transfer`, `account`, `admin`) with `overflow: -15` and live breadcrumb titles.
  - `/account` `#saveReleaseChannelBtn` saved (`"体验通道已保存"`).
  - `/admin` KPI matched `/api/admin/users` (`"2"` == `2`), created Feature Flag `i05_preview_qgwke8` after Task 27 password step-up, reflected in `#featureFlagAudit`.
  - Non-admin user (`i05user`) confirmed `#v3SidebarAdminLink.hidden === true`, `/api/admin/users` returned `403`, `/admin` redirected cleanly to `/`.
  - Remote D1 `p07_accessibility` disabled -> confirmed chrome hidden (`display: none`) -> restored ON (`restoredOn: true`).
  - `6` `axe-core` scans across desktop (`1440`) & mobile (`390`) passed with `0` serious/critical violations.

## 4. Cleanup Commands (After Acceptance)
```bash
npx wrangler pages project delete thewyj-i05-preview
npx wrangler d1 delete aeris-i05-preview
```
