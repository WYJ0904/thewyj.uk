# Aeris local CI proxy fault isolation

Base: main `63b8c419380a0a4daae06e8bbf97f77d92ce4939`. Its source tree is identical to the qualified PR114 head `6330ee5`; Production public-file and configuration checks passed. The subsequent main push run 40819002809 still failed its cloud-only local browser job while its other nine jobs passed. This is retained as FAIL, not hidden behind the earlier passing PR run.

The same pinned Wrangler fatality was captured in P07 run 40813711904: a `ProxyController / Error inside ProxyWorker` event wraps `Network connection lost.` and terminates the entire development host. Its 738,866-byte local runtime log is preserved in the UI checkout, with archive SHA-256 `c553cffe8325e18405a0b150ef44311cac01670a92ed6db56a1403484a30faec`. This matches [workers-sdk issue 15317](https://github.com/cloudflare/workers-sdk/issues/15317), independently read on 2026-10-29. The upstream issue is now closed; that does not update this project's pinned 4.118.0 installation.

The guarded workaround is applied only inside the disposable cloud-browser CI dependency installation: `CI=true`, exact HTTP loopback port 8894, exact Wrangler 4.118.0, and reviewed CLI method boundaries. It logs the transport failure and preserves that failed request. It does not add retries, restart a running suite, extend a deadline, remove a business assertion, patch a Production Worker, update a dependency lockfile, enable AI, or change bindings/data.

VM controls execute both original and transformed handlers: the original transport event is fatal; the transformed narrow transport event is logged; D1, syntax, configuration, explicit Miniflare user errors, wrong source/reason and malformed causes retain fatal handling. Unknown CLI structure/version or double application stops the workaround. Locally only this read-only VM self-test was run; no local or global SDK files were patched.

The helper source was copied read-only from preserved QA work. The original Hotfix WIP and PR110 remain separate. Exact-head CI remains required before merging this independent fix. Since only workflow/QA/report files change, public application source, database migrations, flags, member rights, official APK and financial behavior remain identical to the current main release.

## Independent review, 2026-10-29

The reviewed remote head is `5fbb24b8b3b3cd14aa93ad7ac5e7e7b807613c9b`, Draft [PR116](https://github.com/WYJ0904/thewyj.uk/pull/116), based on `63b8c419380a0a4daae06e8bbf97f77d92ce4939`. Live GitHub checks and job steps were queried again; the result is not inferred from an old report.

| Run / source | Actual result | Interpretation |
| --- | --- | --- |
| main push 40819002809 | Original cloud-browser FAIL retained | Earlier PR114 success does not erase this failure |
| PR116 `a87a43d`, [40820655409](https://github.com/WYJ0904/thewyj.uk/actions/runs/40820655409) | 7 Actions PASS / 1 FAIL / 2 SKIP | The recipient initialization still exceeded the original 25-second deadline after upload/share creation |
| PR116 `5fbb24b`, [40836191455](https://github.com/WYJ0904/thewyj.uk/actions/runs/40836191455) | 8 Actions PASS / 0 FAIL / 2 SKIP; separate Pages check PASS | One complete exact-head run passed; this is not 10/10 executed Actions or proof of permanent stability |

The two skipped jobs are **Task25 cloud credential discovery** and **Task25 Android runtime contract**. Their pre-existing branch conditions do not include `codex/aeris-ci-proxy-resilience`; this change did not weaken those conditions. They remain SKIP, not PASS. The JavaScript job executed the Task25 flag/migration/Web-native contracts; the cloud-browser job executed Task25 administration and channel acceptance. The skipped runtime job must execute on main under its existing condition. This CI-only correction changes no Android code; it does not claim new physical-device or emulator evidence.

The `5fbb24b` Cloudflare check reports deployment `fba78268-4955-41a5-aab7-829ff06eee17`, [Preview URL](https://fba78268.thewyj-uk.pages.dev). This review only read that metadata; it did not authenticate to that environment or mutate its data/configuration. The parent release process owns any additional exact-byte/Preview and merge checks.

### What the transfer evidence proves

Both artifact ZIPs were read without extracting over historical evidence. The earlier archive is 10,930 bytes, SHA-256 `e0dbe37127f583ae608d0b10b593f8513531412c60ff131532de96f218b96917`; the later archive is 1,709,116 bytes, SHA-256 `f9cef46920b76608a28a1617c82ad607fe918c181e90f9212a26087f15acddb5`. They remain in the UI checkout's ignored `docs/migration-evidence/aeris-p03-p07/ci/remote-artifacts/` as `a87a43d-cloud.zip` and `5fbb24-cloud.zip`.

The earlier runtime contains **one** guarded local-disconnect warning. The host stayed alive, but the recipient failed initialization; its artifact predates the new recipient DOM/screenshot collection, so missing browser/module/body state cannot now be reconstructed. The later runtime contains **zero** such guard warnings. It still logs response-side `Network connection lost.` text; those occurrences are retained, not reclassified as successful network requests or counted as independent failures. A passing run that did not trigger the guarded path cannot independently demonstrate that the original recipient failure is fixed.

The later transfer log does prove real multipart/browser round trips for a 16,903,168-byte EXE and a 17,244,160-byte MP4, including source/download SHA-256 equality, byte lengths/signatures/extensions, one recipient grant reused across both files, superseded upload rejection, cancelled-session quota release, survivor rebuild, share revocation, and final zero synthetic quota. Those assertions, fixture sizes and the original 25-second initialization deadline were not changed.

**Responsibility:** the original process-wide proxy fatality is reproduced and narrowly controlled in the pinned SDK handler; the recipient-startup timeout is still **INCONCLUSIVE / NOT CLOSED**. No missing evidence is attributed to application code, Chromium, Samsung, or a driver by inference.

### Diagnostic-budget correction found during review

The `5fbb24b` failure collector awaited CDP evaluation and screenshot without its own deadline. `CdpClient.send()` has no per-call timeout. If CDP or the renderer is stuck, collection after the original failure could wait until the job timeout, obscuring the failed assertion.

The follow-up confines collection to a **fixed, independent 3-second total budget** in `qa/ci/failure-diagnostics.mjs`. It races collection against one timer, clears that timer on all settled paths, signals abort, and always rethrows the identical original error. The collector checks the abort signal before saving a late CDP reply or screenshot. This is a diagnostic deadline only: no business timeout is extended; no test assertion, request retry, application logic, or Production Worker changes. A reporter exception also cannot replace the original error.

`qa/ci/test-failure-diagnostics.mjs` exercises normal file preservation, a never-resolving CDP stand-in returning within a short controlled budget, a late reply producing no late writes, and collector/reporter exceptions retaining the original error object. It checks the production constant is 3,000 ms. The workflow runs this self-test before the fresh disposable local host is prepared. The short self-test budget is not substituted into the product/browser deadline.

Local checks after this correction: the new diagnostic regression PASS, the existing real-handler VM regression PASS, transfer-driver syntax PASS, and `git diff --check` PASS. Node is the existing pinned 22.23.3 binary; no dependency/compatibility-date upgrade or local SDK patch occurred. Evidence metadata is stored in ignored `docs/migration-evidence/ci116-independent-20261029/`.

**Merge assessment:** the pinned process-fatality correction is independently supported, but this follow-up must first receive its own exact-head CI. Keep PR116 Draft until that run and applicable release checks finish. Even if those gates pass, report the narrow CI change separately from the unresolved intermittent recipient timeout; a later success never replaces either earlier FAIL. No push/merge/deployment or claim about Production recovery is implied by this report. The parent process may push the follow-up to the existing PR for validation; it must use the resulting exact SHA for any later merge decision.
