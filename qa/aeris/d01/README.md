# D-01 diagnostic inputs

Product source remains at `f6a2ec7`, with the `94f5177` WIP import in its ancestry.
The QA fix keeps ActivityScenario helper Activities in the target QA process.
Samsung Freecess can freeze the instrumentation target when its helper is in
the separate test APK. See the RCA report for executed evidence and limits.

`host/` contains the non-secret phase-3 QA sources and fixtures. Their original
ignored copies, original certificate and local key remain preserved in the
evidence directory. `prepare.py` copies these tracked templates into a new
ignored output directory, generates a fresh seven-day loopback TLS key/CA using
Git's OpenSSL, and refuses to overwrite earlier QA inputs. Both builds share
the same fixture certificate. Private keys and APKs never belong in Git.

Prepare a fresh output with `python qa/aeris/d01/prepare.py --output
docs/migration-evidence/d01-repro`. Build from the intended current/control
checkout with its `android/gradlew.bat`, the generated `qa.init.gradle`, and
explicit `aeris.qa.source` / `aeris.qa.build` system properties. Quote every
`-Daeris.qa.*=...` argument in PowerShell. The QA-only
`debugImplementation('androidx.test:core:1.7.0')` is enabled by default; use
`-Daeris.qa.sameprocess=false` only for the controlled failing comparison.
Always use `-PTHEWYJ_BASE_URL=https://127.0.0.1:18787` and Debug tasks. Do not
use Gradle install/connected tasks or provide formal signing environment values.

The prepared packages are `uk.thewyj.app.qa.d01` and
`uk.thewyj.app.qa.d01control`, each with a separate `.test` package. The former
uses `f6a2ec7`; the latter is built from the managed `aeris-d01-control` checkout
at `94f5177`. The control adapter only omits the observation `accountId` field
and the explicit configuration-time `deactivate()` call that do not exist in
the older API. It excludes the newer T01–T16 class from the older build.
`D01LifecycleTest.kt` itself has identical bytes in both builds.

`device_guard.py` requires the single known Samsung before issuing any
target-device command. It only saves public package, APK, permission and
service metadata; it does not inspect private databases or cookies. Its
presence does not mean that a before/after device baseline was obtained.

`D01LifecycleTest` provides three independent groups: plain Android Activity,
product PaymentVerificationScreen, and product ThewyjWebView. Each defaults
to 30 rounds. A round includes stop → resume → stop, another resume, recreate,
remount, and verified destruction. Native tests also require a fresh canonical
amount and its visible UI after 100 invalidations while stopped. The common
canonical amount avoids using a known old RC-1 behavior as a lifecycle failure.
Web assertions currently verify document activity and remount, not the full
T16 receipt invariant; run the preserved original T16 separately.

The probe writes lifecycle callbacks, per-step durations and main-thread
heartbeat delays. The default comparison disables active Java stack sampling;
an optional individual-thread mode is available. The PC watchdog also reads
only the own debuggable QA process's kernel wait metadata and saves filtered
Freecess logs. It remains usable when the app's own watchdog is frozen.
No ActivityScenario timeout or business assertion is relaxed. Original T12
retains its real 90-second wait and a separate test watchdog budget.

`D01RegressionTest` repeats the unchanged original T11/T15/T16 assertion bodies
and teardown in one process. `D01ExternalTest` leaves the actual QA app using
Home or physical sleep; the PC performs normal return/wake so the test does
not depend on its frozen process waking itself. It never dismisses keyguard.
UI assertions wait for normal unlock before querying QA widgets. The
controller refuses Home/sleep if an own QA window is not foreground.

Timing is at Activity, WebView mounting and lifecycle boundaries; exact internal
WebView native destruction duration is not instrumented by these inputs.

Before any future installation, re-establish the protected device baseline and
check whether these QA identities already exist. Only a package actually
created in this investigation may be updated with `-r`; never clear or uninstall
existing QA data. Keep the custom StateAcceptanceRunner that preserves existing
accessibility services. Keep hardware acceleration and Samsung security enabled.

The loopback fixture reads `AERIS_D01_SOURCE_ROOT` to select the intended
checkout's JS. It must be explicitly set to the matching current/control source.
The original certificates used for the recorded comparison expire on
2026-10-20 at 11:37:36 UTC. New preparation generates a fresh isolated fixture
certificate; retain certificate and hostname verification.

Run separate fresh instrumentation invocations for individual methods, then the
continuous groups and original T01–T16 matrix, preserving every failure. Retain
original T11/T15/T16 as distinct tests. A build or a later single PASS does not
close D-01. See `docs/AERIS_D01_LIFECYCLE_RCA.md` for actual executed coverage.
