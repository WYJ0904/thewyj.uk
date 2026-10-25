# P05 non-device verification

This continues the product parser, page/OCR verifier, ticket engine and Room store.
It does not create a second ledger or trust synthetic data as provider proof.

The original 608 input/oracle remains `qa/finance-p02/fixtures/matrix.json`.
Original E004/E007/E008 run before and after unchanged. Legacy policy1 execution
and current policy2 safety results are reported separately. No currency default,
missing decimal point, independent capture reference or provider identity is invented.

Current product regressions are `FinanceP05PageEvidenceTest`,
`PaymentTicketCurrencyRestoreTest` and `FinanceP05MigrationTest` in the normal
Android JVM suite. They exercise product classes, actual Room/SQLite, controlled
coroutine completion and a fake clock, without sleeping or contacting a phone.

Fresh results live under `docs/migration-evidence/finance-p04/continuation-p05/`.
Use `prepare-regression.py` once per new evidence run; it refuses to overwrite.
Existing P03/P04 runners accept the environment paths recorded there. Repeated
and overlapping suites are distinct views, never summed as independent tests.

No P05 code is deployed automatically. The owner Preview stays pinned to its
separately recorded P04 deployment and isolated database. Real Samsung,
provider proof, formal upgrades and Production acceptance remain separate gates.
