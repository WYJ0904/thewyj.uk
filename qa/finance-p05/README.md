# P05 non-device verification

This continues the product parser, page/OCR verifier, ticket engine and Room store.
It does not create a second ledger or trust synthetic data as provider proof.

The original 608 input/oracle remains `qa/finance-p02/fixtures/matrix.json`.
Original E004/E007/E008 run before and after unchanged. Legacy policy1 execution
and current policy2 safety results are reported separately. No currency default,
missing decimal point, independent capture reference or provider identity is invented.

Current product regressions are `FinanceP05PageEvidenceTest`,
`PaymentTicketCurrencyRestoreTest`, `FinanceP05MigrationTest`,
`FinanceP05ScanBudgetTest` and `FinanceP05OcrTaskLifetimeTest` in the normal
Android JVM suite. They exercise product classes, actual Room/SQLite, controlled
coroutine completion and a fake clock, without sleeping or contacting a phone.

Fresh results live under `docs/migration-evidence/finance-p04/continuation-p05/`.
Use `prepare-regression.py` once per new evidence run; it refuses to overwrite.
Existing P03/P04 runners accept the environment paths recorded there. Repeated
and overlapping suites are distinct views, never summed as independent tests.

No P05 code is deployed automatically. The owner Preview stays pinned to its
separately recorded P04 deployment and isolated database. Real Samsung,
provider proof, formal upgrades and Production acceptance remain separate gates.

The authoritative continuation run is `final-validation.py --label final-r7`.
The final collector uses `FINANCE_P05_FINAL` pointing to that fresh evidence
directory. Node/SQL bytes are bound to this continuation's earlier executions;
their execution HEAD is retained separately from the Android test HEAD.

Optional AVD validation uses the official SDK and a private ADB server on 5039,
with USB excluded and only the owned loopback target selected. `emulator/`
contains actual bundled ML Kit pixel and MainActivity tests, added through
`emulator.init.gradle`, outside product source sets. The first pixel failure,
second-scale regression and corrected run are all retained. Cleanup removes
only the two test packages from that AVD and stops its own server; it cannot
select a physical phone or the default ADB server.

`write-report.py` creates the single continuation report. `seal.py preflight`,
`seal.py seal` and `seal.py verify` bind that report, tested source, frozen
inputs and selected immutable raw evidence to the final local Git commit.
Historical missing compiler-cache exceptions remain disclosed; the old seal
is never changed or repaired with fabricated files.
