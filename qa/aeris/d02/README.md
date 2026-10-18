# D-02 WebView thread investigation

This QA-only overlay inherits `57b622e` and leaves the product and D-01 sources
unchanged. It uses only `uk.thewyj.app.qa.d02` and its `.test` package. It keeps
D-01's target-process ActivityScenario helpers and the Runner that does not
suppress existing accessibility services. It never grants QA notification or
accessibility access, opens the formal app, or clears any application data.

Read `docs/AERIS_D02_WEBVIEW_THREAD_RCA.md` and
`docs/ANDROID_HOTFIX_REMAINING_ACCEPTANCE_MATRIX.md` for executed results and
the unexecuted real business gates.

## Inputs and controls

- `legacy/StateDeviceAcceptanceTest.compose-attempt.kt.txt` is the exact preserved
  early Compose source, SHA-256
  `1aee83a27b55964326ac0c9223a1dcde6612e4b0f333d3a26e646426910e37be`.
  A directory-local Git attribute preserves these bytes across Windows checkouts.
  Preparation renames the class/package for isolation. Its Standard variant adds
  only the explicit `StandardTestDispatcher` rule argument and required opt-in.
  The final StandardPumped variant additionally waits with `compose.waitUntil`
  so the UI test clock progresses during real IO/Chromium work. The original
  business assertions and wait budgets are retained. The rule-only variant's
  actual JavaScript wait timeout remains a separate failed control.
- `D02MinimalActivity` runs the same three real IO suspensions followed by
  `getUrl`, JavaScript evaluation, pause and resume under ordinary Android
  composition, default Compose test effects, and scheduled Compose test effects.
  It records actual thread/tid/Looper, interceptor, complete exceptions, operation
  boundaries and final destruction. Only inline synthetic HTML is loaded.
- `D02ThreadTests` includes deliberate failing controls and a real product
  WebView regression requiring 30 fresh publication callbacks, with account
  equality and URL assertions. `waitUntil` drives the Compose test clock while
  actual IO/Chromium work completes; assertion budgets remain bounded.
- `StandardTestDispatcher` itself is not a UI dispatcher. This version's Compose
  test clock runs scheduler work on the Android UI thread. Do not invoke its
  scheduler directly from an instrumentation or background thread.
- `protection.py` hashes protected source trees and original raw evidence while
  excluding rebuildable Gradle trees. It never opens the excluded root secret.
- `run.py` records discrete formal-service checks, saves complete JUnit output
  and pulls only the own package's synthetic diagnostics. Its whole-run watchdog
  can stop only the two packages recorded in the own installation ledger.
  The full original matrix has a separate suite budget because T12 actually
  waits 90 seconds; no functional or ticket timeout is increased.

## Reproduction

Re-establish ownership, the single authorized Samsung serial/model/API, public
formal package/permission/service baselines, and protected file snapshots before
installation. The checked-in D-01 read-only `device_guard.py` can capture this
after adding the two D-02 identities to its public metadata list. Their absence
at the initial baseline and each successful installation establish ownership.
An existing unrelated package must never be adopted, updated, cleared or removed.

Run `python qa/aeris/d02/prepare.py` once in a fresh ignored evidence directory.
The inherited preparation generates a new seven-day loopback TLS certificate;
private keys stay ignored. Only `inputs/qa-host-current` is built or installed.
The generated unused control folder is not an installed D-02 control app.
`--refresh-code` updates only own generated diagnostic classes after the prior
source/APK revision has been archived; it does not modify protected host inputs.

Build Debug only, with the existing JDK/SDK and formal signing environment
variables removed from the process. Quote every `-D` argument in PowerShell:

```powershell
$qaSource=(Resolve-Path 'docs/migration-evidence/d02/inputs/qa-host-current').Path
$qaBuild=Join-Path (Get-Location).Path 'docs/migration-evidence/d02/build-qa'
./android/gradlew.bat -p android -I "$qaSource/qa.init.gradle" `
  "-Daeris.qa.source=$qaSource" "-Daeris.qa.build=$qaBuild" `
  '-Daeris.qa.sameprocess=true' '-PTHEWYJ_BASE_URL=https://127.0.0.1:18787' `
  :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug `
  --no-daemon --console=plain
```

`install_qa.ps1` checks the two exact package names, Debug certificate, original
absence and installation ownership before `-r`. It does not uninstall or clear.
Keep each installed APK revision and its hash outside generated Gradle output.
The loopback fixture is the inherited `server.cjs`, with
`AERIS_D01_SOURCE_ROOT` explicitly set to this checkout. Only the task-owned
`tcp:18787` reverse may be added and later removed. Never replace another mapping.

Run each group in a separate instrumentation invocation using a new label:

```text
python qa/aeris/d02/run.py ordinary unique-ordinary-label
python qa/aeris/d02/run.py default-minimal unique-negative-label
python qa/aeris/d02/run.py standard-minimal unique-standard-label
python qa/aeris/d02/run.py legacy-default-t01 unique-original-negative-label
python qa/aeris/d02/run.py legacy-pumped-t01 unique-original-fixed-label
python qa/aeris/d02/run.py standard-product unique-product-publication-label
python qa/aeris/d02/run.py original-full unique-original-matrix-label
```

Default controls must retain a real failed JUnit assertion when the defect is
reproduced. They return a nonzero exit code, remain FAIL in evidence, and are
not counted as passing regressions. Do not remove assertions or infer success
from a checkpoint, skipped case, process crash or forced termination.

The earliest collector pulled historical own-session directories too. Those raw
copies remain preserved; their `current-session-summary.json` selects the new
timestamped session. Later collection records pre-run entries and pulls only new
sessions. Never count cumulative historical rows as fresh rounds.

At the end stop only the task's two QA packages, retain their data, stop only
the task-owned local fixture, remove only its own reverse if still present, and
compare protected source/evidence and public device baselines. Real WeChat,
formal app data, Production, Task 26, merge/push/release and system security
changes require separate authorization and are outside this procedure.
