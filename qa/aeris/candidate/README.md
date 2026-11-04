# Phase 4 isolated Hotfix acceptance

The candidate inherits `8c0de9c` with the full WIP import and `9ff7a7f` product
repair. No product source is changed by this directory. D-01/D-02 stay closed;
only their fixed positive regressions are selected, without repeating RCA.

Run `audit.py` first. It verifies ancestry, all 26 imported WIP hashes against
the fixed checkout, QA-only D-01/D-02 diffs, and product files against f6a2ec7.
Git's own clean filters distinguish binary assets, CRLF and inherited GBK text.
Its canonical product SHA-256 and physical working-file hashes are both saved.

Commit the complete QA inputs locally before building. Run the audit again,
then `prepare.py` once. It creates only ignored generated host/TLS inputs, pins
the source commit and product manifest SHA in QA BuildConfig and diagnostic
events, retains D-01 same-process helpers and D-02 Standard/clock scheduling.
It compiles only positive D-02 classes. Private keys and APKs stay ignored.

Build the ordinary Debug product and freshly run JVM tests (`testDebugUnitTest
--rerun`), Android Lint and Debug build. Do not install this full-shell APK.
Separately build the generated QA overlay at `qa-host-current`, using its init
script, `aeris.qa.source`, `aeris.qa.build`, `aeris.qa.sameprocess=true`, and the
loopback `THEWYJ_BASE_URL=https://127.0.0.1:18787`. Remove formal signing variables
from these build processes. No Release or Gradle install/connected tasks.

Capture protected source/evidence and public device metadata before installing.
The only install/update targets are the initially absent
`uk.thewyj.app.qa.hf4` and `.test`. `install_qa.ps1` checks ownership, package
and Debug certificate and never clears data. Formal `uk.thewyj.app`, all older
QA identities, Task 26 and the fixed checkout are protected.

`run.py current <mode> <unique-label>` uses the inherited independent PC
watchdog and normal Home/screen driver. Select `full` (T01–T16), `native`,
`web`, `home`, `screen`, `d02minimal`, `d02product`, `d02original`, `room-seed`
and `room-verify`. Repeat native/WebView 30 rounds; the two D-02 tests each
contain 30 iterations. Room seed/verify must be different instrumentation
processes: the ordinary own-package stop between invocations proves persistent
Room booking/candidate/recognition and outbox identities survive process death,
then three recovery replays must not duplicate them. It is synthetic data only.

The inherited function/UI timeout and 90-second ticket remain unchanged.
Normal owner unlock is a separate bounded environment phase. A skipped,
incomplete, failed or watchdog-terminated run never qualifies as PASS. Retain
every failed attempt. Collect only this package's exported synthetic evidence;
the initial D-02 minimal collector's old-session copies must never be counted
as new execution. Here all phase-4 evidence is separate from historical runs.

The loopback fixture uses this checkout's real JS with explicit
`AERIS_D01_SOURCE_ROOT`. Preserve normal TLS/hostname verification, existing
accessibility bindings, Samsung security and hardware acceleration. At end,
stop only the two owned QA packages and owned fixture; retain QA data; remove
only the reverse added by this task. Compare protection snapshots.

Reports identify each source/APK/test input revision separately. The full-shell
Debug APK is built, not installed or certified for a real backend; component
QA does not test real MainActivity, system capture, cloud or real payments.
Real WeChat events require separate owner authorization after regression and
consistency pass. Do not push, merge, release or access Production.
