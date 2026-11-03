# Unified FINANCE-P03 local regression

The owner authorized one continuing P03. Historical filenames are retained; they
are not implementation or approval stops. Only the final report under
`docs/finance-p03/FINANCE_P03_FINAL_REPORT.md` is the current delivery.

Use this existing isolated checkout. Never run ADB, access private accounts,
Production, release/signing jobs, push, merge or PR operations. All accounts,
signatures, callbacks and amounts in these tests are synthetic. The read-only
provider adapters are not wired into the public API and cannot authorize a
correction. They do not manufacture operation revisions or source relationships.

Every runner refuses an existing name. Preserve all errors, red frozen rows,
initial fixtures and abandoned probes. Run one Gradle command at a time. Node
programs use independent local D1 runtimes; none contains a remote binding.

```powershell
python qa/finance-p03/final/audit.py baseline
python qa/finance-p03/final/freeze-baseline.py
python qa/finance-p03/final/prepare-compat.py
./qa/finance-p03/final/run-gradle.ps1 -Flavor Standard -Name fresh-full -OutputName fresh-full -Tests @() -Full
./qa/finance-p03/final/run-node.ps1 -OutputName node-fresh
./qa/finance-p03/final/run-one.ps1 -Name fresh-resolution -Script qa/finance-p03/final/resolution.mjs
./qa/finance-p03/final/run-one.ps1 -Name fresh-controls -Script qa/finance-p03/final/controls.mjs
./qa/finance-p03/final/run-one.ps1 -Name fresh-provider -Script qa/finance-p03/final/providers.mjs
./qa/finance-p03/final/run-one.ps1 -Name fresh-migration -Script qa/finance-p03/final/migration.mjs
./qa/finance-p03/final/run-one.ps1 -Name fresh-corrections -Script qa/finance-p03/phase-a/reconciliation.mjs
./qa/finance-p03/final/run-one.ps1 -Name fresh-old-migration -Script qa/finance-p03/final/correction-migration.mjs
./qa/finance-p03/final/run-unified-bridge.ps1 -Name fresh-bridge
```

The initial baseline/compatibility commands are already sealed and must not be
rerun in this evidence directory. The selected run names and full arguments
are in `delivery-final/summary.json`, `*-run.json`, `node-final-2/exits.json` and
`acceptance-final2-commands.json`. `run-acceptance.ps1` runs the frozen matrix, two
process tests and four bridges sequentially; existing names cannot be reused.

Compatibility copies append Room13→14 and D1 migration0030 only; the manifest
records hashes and adaptations. Frozen P02 input/expected values stay intact.
The local binary probe uses this installed Miniflare's documented
`resourcePersistencePath`, closes the owned runtime, copies the whole directory
including any remaining WAL, and reopens an independent copy. It does not prove
Cloudflare Time Travel, a real account backup, or a physical old APK rollback.

The collector counts distinct test identities, keeps repeated executions out of
totals and includes historical red rows. The provenance tool rejects changes to
old migrations, Room schemas, frozen evidence and protected workspaces. It seals
the final local commits, candidate inputs, APK and raw evidence after review.

Owner-requested self-created provider/backup sandbox (no official account or external request):

```powershell
./qa/finance-p03/final/run-one.ps1 -Name fresh-sandbox -Script qa/finance-p03/final/local-sandbox.mjs
```
