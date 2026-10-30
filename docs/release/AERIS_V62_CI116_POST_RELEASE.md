# Aeris V6.2 — PR116 independent post-release verification

2026-10-29 release, rechecked 2026-10-30 HKT. **Production source, public bytes, unchanged configuration and main push CI: PASS. Main run40842938178 completed10/10 jobs successfully.** This is the narrowly scoped CI/QA release, not a P03–P06 financial release, P07 spatial rollout, recipient-timeout root-cause closure or signed Android release.

The primary flow merged [PR116](https://github.com/WYJ0904/thewyj.uk/pull/116) under the owner's V6.2 release authorization using expected-head comparison. This independent check only fetched Git refs and read GitHub/Cloudflare/public-site evidence; it did not perform another merge, checkout, deployment, migration, flag change, account/data mutation or device action.

## Exact source and merge proof

| Identity | Verified value |
| --- | --- |
| Qualified PR116 head | `bf7323b68a14ff7617d8f5e77d1e0abb299ad34e` |
| Released main merge | `c4d63fa2fb8181a368826db034017fbdabd6ce6f` |
| Main parents | Previous main `63b8c419380a0a4daae06e8bbf97f77d92ce4939`, qualified head `bf7323b68a14ff7617d8f5e77d1e0abb299ad34e` |
| Both Git trees | **`55d185954f773ded6432c8b58d53f118fee215a6`** — exactly equal |
| Current UI checkout after read-only fetch | Remained on its existing spatial branch/head; no checkout/merge/rebase |

`git fetch origin main` updated only the fetched refs. `git diff bf7323b c4d63fa` is empty. Relative to previous main, exactly seven files changed:

- `.github/workflows/ci.yml`
- `docs/release/AERIS_CI_PROXY_RESILIENCE.md`
- `local-backend/test_transfer_browser_e2e.mjs`
- `qa/ci/failure-diagnostics.mjs`
- `qa/ci/test-failure-diagnostics.mjs`
- `qa/ci/test-wrangler-local-disconnect.mjs`
- `qa/ci/wrangler-local-disconnect.mjs`

There are no product static assets, Functions application modules, Android product files, database migrations, dependency lockfiles or runtime configuration changes in this diff. The pinned SDK workaround affects only disposable CI localhost:8894 with `CI=true` and Wrangler4.118.0. Its diagnostic budget is independent of, and does not extend, the original25-second recipient initialization assertion. See the released [source report](https://github.com/WYJ0904/thewyj.uk/blob/bf7323b68a14ff7617d8f5e77d1e0abb299ad34e/docs/release/AERIS_CI_PROXY_RESILIENCE.md).

Evidence: `docs/migration-evidence/aeris-p03-p07/v62-ci116-main-r1/source-proof.json` and `qualified-pr-proof.json`.

## Qualification versus post-merge CI

The exact qualified-head [run40841259381](https://github.com/WYJ0904/thewyj.uk/actions/runs/40841259381) has **8 executed Actions PASS /2 conditional SKIP**. The skipped jobs were Task25 credential discovery and Android runtime under the existing PR branch conditions; they were never counted PASS. The separate Cloudflare Preview check and85 public-file exact-byte proof passed at `https://ca87709b.thewyj-uk.pages.dev`, as recorded in `v62-ci116-preview-proof-r1`.

The new **main push** [run40842938178](https://github.com/WYJ0904/thewyj.uk/actions/runs/40842938178), attempt1, source `c4d63fa2`, is a separate run. It was discovered with the public read-only Actions endpoint because the commit connector lists PR runs only. No workflow rerun or dispatch was requested by this audit.

| Snapshot UTC / HKT | Actual main-run state |
| --- | --- |
| 08:34 /16:34 initial | In progress; several jobs still executing; no all-green claim |
| 08:36:34 /16:36:34 | Seven completed PASS; JavaScript running; dependent browser jobs not yet created |
| 08:38:37 /16:38:37 | **8 PASS /2 RUNNING /0 FAIL /0 SKIP**; application and cloud-only browser jobs still executing |

The main run actually executed and passed **Task25 Android runtime** and **credential discovery**. This is distinct from their two PR-only SKIPs. Credential-discovery success means that the discovery check ran; it is not evidence that every external credential or environment is available. At that historical snapshot main CI remained **PENDING**, not10/10 PASS, until the two browser jobs completed. Later snapshots, if collected, must be appended without replacing these observations.

Historical failures remain:

- main `63b8c419` push run40819002809 cloud browser FAIL;
- PR116 `a87a43d` run40820655409 recipient initialization timeout after the unchanged25-second deadline;
- later `5fbb24b` and qualified `bf7323b` successes are separate successful executions, not deletion or reclassification of either failure.

The SDK process-wide fatality has a narrow reproduced handler correction. The intermittent recipient-startup timeout is still **INCONCLUSIVE / NOT CLOSED**. A passing execution that does not hit the guarded warning cannot prove that failed request path fixed. No Samsung/Chromium/application blame is inferred from missing historical DOM/module/body evidence.

## Actual Production deployment and public bytes

Cloudflare canonical Production metadata read at08:34:25 UTC reports:

| Field | Actual value |
| --- | --- |
| Project | `thewyj-uk` |
| Source commit | `c4d63fa2fb8181a368826db034017fbdabd6ce6f` |
| Deployment ID | **`55b78a0f-8419-4054-b9c2-3ffc26da3f20`** |
| Canonical deployment URL | `https://55b78a0f.thewyj-uk.pages.dev` |
| Public site checked | `https://thewyj.uk` |
| Deploy stage | SUCCESS,08:33:27–08:33:33 UTC /16:33 HKT |

Command:

```powershell
python qa/aeris-release/verify-static-deployment.py --commit c4d63fa2fb8181a368826db034017fbdabd6ce6f --origin https://thewyj.uk --label v62-ci116-production-proof-r1
```

**85/85 public files match the committed bytes**, with zero mismatches. All five developer/private-file exclusion probes pass; SPA-shell responses are recognized by the exact committed index hash, not mistaken for disclosure of private files. These are repeated source-delivery checks, not85 new financial test identities. The source/deployment metadata separately establishes the Functions build source; the compiled Functions bundle is not publicly served for a byte-level source comparison.

Anonymous health checks returned `/api/status?source=cloud` HTTP200, `ok=true`, `status=ok`, `environment=production`; `/api/app/config` returned HTTP200/ok. Public Android metadata remains **Aeris / `uk.thewyj.app` /1.3.37/code50**, existing APK SHA-256 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`,48,124,983bytes. This reads advertised metadata, not the installed phone package or a fresh APK signing/coverage acceptance.

Evidence: `v62-ci116-postdeploy-r1/result.json`, `health.json`, and `v62-ci116-production-proof-r1/result.json`.

## Configuration/data boundary comparison

The fresh read was compared to immediately preceding `v62-ci116-preflight-r1/result.json` (08:32:22 UTC). Every selected configuration/metadata field matches:

| Boundary | Result |
| --- | --- |
| Complete plaintext variable map digest | Unchanged, SHA-256 `6fe4bb9c2ab8caf937d6ebd6b8b5f7f6fcbdda8d4d24c4a66ec8242121c2bc97` |
| Task25 flag decision fields, channels, percentage, Kill Switch and revision | Unchanged; P07 UI flag still absent/OFF in Production |
| Finance metadata schema | Unchanged task16=`1` |
| Notification metadata schema | Unchanged task21=`2` |
| Four public membership prices | Unchanged CNY800/800/3000/10000 cents for finance/monthly archive/all-monthly/all-lifetime |
| D1 binding | Unchanged `11c288d8-c584-409f-bb1f-7e7af11793e5` |
| R2 binding | Unchanged `wyj-cloud-production` |
| Pages build configuration | Unchanged `npm run build` → `.wrangler/pages-output` |

The audit used `cloud-state.py v62-ci116-postdeploy-r1`. Pages/deployment/configuration reads use GET. Its fixed four D1 SELECT statements use Wrangler's read-only query transport, which can be HTTP POST; they are not described as “all requests were GET.” They select only flag decisions, schema metadata and the four public price rows, and assert `rows_written=0`. The recorded counters are **Production data writes0, financial rows read0, external model calls0**. Credentials remained in memory and were not printed or committed. There was no config mutation or secret acquisition beyond the already-authorized normal Wrangler session.

This is a configuration/binding and selected-public-metadata comparison, not a byte snapshot of all Production data or R2 objects. No account, financial, chat or notification contents were read; no R2 objects were modified or downloaded. It does not activate P03–P06 finance/AI or P07 spatial features. Existing historical owner waivers remain unchanged.

The separate owned UI Preview still has D1 `ee869f78-b54a-4018-bc99-871089ecb8cd`, no R2/AI binding. It is not copied into Production by this CI release.

## Rollback and final boundary

The same-project deployment list still identifies the prior successful release **`e1c33f63-651a-4f1b-b003-7f0a3e71e7ce` / main `63b8c419`**, and the older **`9d98888f-a4ce-4bf6-b255-aa2947785e36` / main `f144956a`**. They are retained rollback candidates; this audit did not invoke rollback. No database migration was part of PR116, so no SQL rollback or data deletion is required for its code-only rollback. Source changes that disable the CI guard must still be reviewed if the pinned SDK issue remains.

Conclusion at this checkpoint: **released CI/QA source, Production health/config/public delivery and main push CI10/10 PASS; recipient-startup timeout INCONCLUSIVE.** This does not promote P03/P04/P05/P06, complete P07, issue a signed APK or start Task27. No phone operation or Production write was performed by this independent post-release audit. The primary flow retains responsibility for the unified report's final observed state and cleanup.


## Completed main CI readback — 2026-10-30 HKT

Run40842938178 / c4d63fa2 completed10 executed jobs PASS,0 FAIL,0 job-level SKIP. This includes Task25 Android runtime and credential discovery, which had been conditional SKIP on PR116. Step-level optional candidate/validator skips remain distinct from job outcomes. The completed job IDs and conclusions are preserved in ci/main-c4-completed-readback.json. Prior main40819002809 FAIL and a87 recipient timeout remain unchanged historical failures. This is a subsequent qualified run, not proof of indefinite stability or original recipient-timeout RCA closure.


Fresh2026-10-30 readback v62-release-current-20261030 again reports c4d63fa2 /55b78a0f and unchanged selected configuration, flags, schema versions, public prices and bindings. v62-production-current-20261030 verifies85 public resources and5 exclusions without mismatch. No paid model call, user-row read or Production data write was involved.
