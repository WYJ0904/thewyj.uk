# P03 same-task finish evidence

This directory continues local baseline `1e04945d1964c0e6a9420b0aff99011001f4ab98`.
The only current final report is `docs/finance-p03/FINANCE_P03_FINAL_REPORT.md`.
No P04/P05/P06, release operation, official private database access or real
payment is authorized by these scripts. Do not run them against another device,
existing QA data, or a non-synthetic account.

## Retained evidence

Raw output: `docs/migration-evidence/finance-p03/finish/`. This path is ignored
and all runners refuse collisions. Do not delete/overwrite a prior run to rerun
it. The offline `delivery-final` snapshot is preserved; `delivery-phone-final`
adds the subsequently connected device. `REVISION.json`, `provenance.json` and
`validation.json` bind the final local Git tree and retained evidence.

The old `qa/finance-p03/device`, P02 matrix and all previous seals are immutable.
`case-analysis-28.json` links original red cases to original inputs and actual
hook traces. No synthetic proof is inserted into C005/C007.

## Source and offline checks

`prepare-runners.py` derives output-isolated invocations from the existing test
drivers. `run-regression.ps1` serializes Gradle/bridge jobs; `run-extra.ps1` and
`run-frozen-node.ps1` preserve nonzero expected-red runs. The exact selected final
commands/exit codes, absolute Gradle init paths and test selectors are in raw
`*-run.json`, `regression-commands.json`, `extra-commands.json`, and
`frozen-node-release-commands.json`. Intermediates remain in their original logs.

New checks are `legacy-controls.mjs` (15), `legacy-browser.mjs` (10 real Chrome
DOM/synthetic transport), `provider-identity.mjs` (8 test-key units), and five JVM
methods in `kotlin/`. Different existing 607/681/63/41/99/79 sets overlap; never
sum them. `collect.py` reproduces the offline selection. `collect-phone.py` adds
physical runs and explicitly retains every failed OS callback and maintenance
observation. Healthy repeat samples do not close the historical lifecycle FAIL.

## Device derivative and controls

`tls.ps1`, `prepare-device.py`, `phone.init.gradle`, `build-device.ps1`,
`verify-apks.py` generate only app-specific localhost Debug QA. Exact built source
ZIPs, manifest, CA and APK hashes remain in raw `artifacts/` and
`qa-generation-final.json`. The last APK uses `uk.thewyj.app.qa.financep03finish`
and `.test`, only user0, no work profile. Formal `uk.thewyj.app` is protected.
Product MainActivity is byte-identical; three privacy overlays gate notification
extras/window access, disable screenshots/MediaStore/SMS, and block external web
requests. These restrictions limit business coverage.

`phone.py` requires one Samsung SM-S9360/API36/user0, a proved owned install and
formal notification listening paused before mutation. Failed builds cannot
install stale artifacts. `repeat-phone.py` repeats the unchanged six-method
matrix 30 times with a bounded watchdog and own-process probes. No assertion or
deadline is relaxed. `screen-phone.py` permits a normal swipe only while public
keyguard booleans report no credential restriction; it never enters credentials.

**Ordinary-mode preparation matters:** after instrumentation, explicitly open
the QA MainActivity and request its normal NLS rebind before external callback
tests. Three controlled sequences reproduce callback loss/recovery while the
Android stopped bit stays false (`instrumentation-nls-boundary.py`); this is not
proof of the underlying framework/system mechanism. The corrected
`notification-matrix.py` preserves all eight original cases and 10-second
deadlines. `notification-recovery.py --prepare-normal --name <fresh-name>` checks
background and explicit relaunch; it does not prove OS LMK or unseen backlog.

The instrumented Settings helper is now read/probe-only at the host guard.
Grant taps must use `settings-shell-ui.py`: it first verifies foreground system
Settings, uses fresh observed node bounds, performs normal UI taps and deletes
its exact temporary XML. An instrumented grant left the service enabled but not
bound; the normal external Settings flow was separately verified connected with
zero screenshots. No secure-settings write or `pm grant` is used.

## Stop and cleanup

The owner authorized removal of this task's QA traces. `export-phone.py` exports
only a fixed own-file allowlist. `cleanup-phone.py` checks exact installed APK
hashes, removes known synthetic notifications and this task's user0 QA packages,
and preserves formal/unrelated package UIDs. The prior P03 test APK is removable
only after its sealed hash matches. No formal private data is opened/cleared.

Stop the local backend via `control.mjs shutdown`, retain filtered synthetic
finance via `export-finance.py`, archive inputs, then use the inventoried and
path-checked `cleanup.ps1`. Canonical APKs, original failures, XML/NDJSON traces,
public CA, necessary synthetic DB fixtures and all source remain. Ephemeral
auth/TLS keys, fresh browser profiles and rebuildable trees are removed. The
server binds only loopback and uses no production binding.

These commands are evidence/reproduction tools, not authorization to reinstall
QA or resume another phase after this delivery.
