# FINANCE-P03 device evidence

Continue the existing P03 only. Product baseline is commit `976eed4`; this
directory adds QA sources and drivers, never a Production build. MainActivity,
identity, money, Room, receipt and outbox product sources are unchanged.

The raw evidence root is `docs/migration-evidence/finance-p03/device/`. Every
runner refuses an existing run name. Do not rerun historical generators over
old outputs. Preserve failed runs and the frozen 608 inputs and expectations.
The unified report is `docs/finance-p03/FINANCE_P03_FINAL_REPORT.md`.

Only one authorized SM-S9360 / API36 / current user0 is accepted by `phone.py`.
Formal notification access must be normally paused by the owner before posting
synthetic notifications. Never change permissions with adb, use another user,
clear data, uninstall, read private finance rows, send a real payment, or access
Production. This turn owns the Debug package and the unique `.p03acceptance`
test package; the old `.debug.test` package is not used.

The privacy derivative copies 124 product sources and changes three copies:
NLS rejects unowned package/tag metadata before extras and replays known
synthetic keys only; MediaStore observation is removed. Accessibility rejects
private packages before window access and its QA resource disables screenshots.
WebView blocks non-loopback HTTP(S). The QA initializer keeps only its own
foreground MainActivity window awake, records lifecycle metadata, and changes
no system lock policy. Core helper activities use AndroidX's original manifest.
The shell-only receiver requires `android.permission.DUMP`, accepts predefined
synthetic actions and never arbitrary payloads or file paths.

The backend binds 127.0.0.1:19443, uses actual Pages API routing/authentication and
persisted local Miniflare D1, one synthetic account and app-specific TLS. No
system CA, SSL bypass, real provider key or Production binding is used. Public
CA bytes are retained; the newly generated test private key and auth persistence
are removed after shutdown. Regenerate a local CA and rebuild for a future run;
do not attempt to reuse deleted credentials. The source overlay and APK hash
manifests identify this turn's exact public inputs.

Representative commands (all from this isolated worktree; use new run names):

```powershell
python qa/finance-p03/device/audit.py baseline
python qa/finance-p03/device/prepare.py
python qa/finance-p03/device/prepare-regression.py
./qa/finance-p03/device/build.ps1 -Name fresh-build -Full
python qa/finance-p03/device/verify-apks.py --name fresh-apk
python qa/finance-p03/device/phone.py audit --name fresh-phone
python qa/finance-p03/device/phone.py instrument --name fresh-main --class-name uk.thewyj.app.qa.finance.FinanceDeviceMainTest --watchdog 120
python qa/finance-p03/device/notification-matrix.py --name fresh-notifications
```

Initial baseline/preparation has already run; preserve its manifests before
regenerating rebuildable copies. The full original607/681, P03 63/41/99/79,
frozen608, four bridges and native D1 persistence commands are recorded in the
fresh `*-run.json`, `regression-commands.json`, `node-device/exits.json` and
`frozen-node-commands.json`. Compatibility wrappers change output paths only;
the source adaptation manifest records this explicitly.

Device process termination is an owned QA force-stop, not an OS low-memory kill.
It may stop accessibility; perform ordinary owner permission/binding verification
after instrumentation and process-recovery tests, not during them. A screenshot
command timeout, diagnostic method completion, later single PASS or successful
matrix never erases an earlier failure.

Live sender `Notification.when=1000` is a 1970 fixture, not current platform
time. The original failures remain. The same-APK timestamp reversal and current
time matrices are separate evidence; frozen P02 timestamps were never edited.
Android notification identity is not signed payment/capture/refund identity.

Cleanup may remove only this turn's explicitly verified rebuildable directories,
temporary copies, test TLS key and synthetic auth runtime. Retain canonical APKs,
source/fixture hashes, public CA, full failed logs, JUnit and reports. Never clean
the fixed checkout, Task26, Hotfix, old evidence, shared Gradle cache or app data.
