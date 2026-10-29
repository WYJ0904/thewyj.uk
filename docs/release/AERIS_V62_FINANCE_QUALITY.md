# Aeris V6.2 financial quality convergence

Status: **P03 PARTIAL; P04 PARTIAL; P05 PARTIAL; P06 PARTIAL / RELEASE_HELD.** These results do not authorize a financial Production migration, automatic booking, model activation or signed Android release.

Recovered base: `c815f19f6a293efe0236a1441ffcac91707d8c1c`, retaining the complete P03–P06 history and original failures. The two product corrections below are isolated from main and the original Hotfix worktree.

## Product corrections

1. `PaymentScreenshotVerifier.kt`: monetary glyph repair no longer rewrites opaque provider-reference lines or ASCII identifiers. Monetary-context and standalone decimal repairs remain. The six new regression methods were 1 PASS / 5 FAIL before the correction and 6 PASS after; they are also included in the fresh 833-method run. No fuzzy reference matching, expected-token injection or change to the 90-second ticket was introduced.
2. `finance-ai.mjs`: an AI-selected amount needs its own direction-compatible movement phrase. A phrase attached to another amount, or bare “本次/本笔/实际/总计”, cannot prove the selected movement. Prompt identity advances to `finance-assistance-6`. This is assistance for review, not permission to book a transaction.

The remaining changes are independent QA drivers, synthetic fixtures and reports. No money arithmetic, transaction identity, Room/D1 schema, account privilege, Production flag, formal APK signing or installed formal application was changed by these corrections.

## Fresh 2026-10-29 evidence

| Collection | Actual result | Evidence under `docs/migration-evidence/aeris-finance-quality/` |
| --- | --- | --- |
| Standard JVM/Robolectric | **833: 827 PASS / 6 FAIL** | `v62-native/command.json`, copied JUnit XML and `android.log` |
| Original JVM method identities within that run | 588: 585 PASS / 3 FAIL | Current methods selected using the sealed original-607 identities |
| Original Node state-consistency suite | 13 PASS | `v62-original/aeris-node.log` |
| Original six actual Chromium component cases | 4 PASS / 2 FAIL | `node-repair-r3/regression/aeris-dom/original-six.ndjson` |
| Original 607, without overlap | **602 PASS / 5 FAIL** | The preceding three disjoint collections |
| Frozen 608, original inputs/oracles | **552 PASS / 5 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED** | `v62-original/frozen-608-reevaluated.json` |
| Separately versioned input-forwarding contract, same 608 identities | **558 PASS / 5 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED** | `v62-original/contract-608-current.json`; separate raw results above remain unchanged |
| Original P03 63 identities | **58 PASS / 4 FAIL / 1 NOT_TESTED** | 26 current JVM methods, 25 server cases, 8 legacy cases, 2 migration cases, original bridge seed FAIL / restore NOT_TESTED |
| Added 38 control identities | **38 PASS** | Five configured trace methods, 15 legacy projection cases, 10 actual legacy browser cases, 8 provider identity controls; overlaps larger collections |
| New candidate-local AI evidence controls | 78 PASS | `v62-original/semantic-anchor.json` |
| Separate direction-mismatch controls | 6 PASS | `v62-original/direction-controls.json` |
| AI protocol, model boundary, quality, rich output, recovery, migration and actual Chrome with mocked model | Executed; separate command outcomes retained | `ai-r3/commands.json` and each raw output |
| Old AI roles suite | **21 PASS / 2 FAIL** | `ai-r3/roles.log`; original input/oracle unchanged |
| Lint / Debug | **0 errors/fatal, 90 warnings, 13 hints**; Debug built. Combined Gradle exit is **1** because six unit methods fail | `v62-native/lint-results-debug.xml`, `app-debug.apk` and artifact hashes |

The old roles failures change only the requested direction while retaining expense-labelled source evidence. They remain raw FAIL. The new direction tests use explicit, separately identified source contracts; they do not replace the old fixtures. The 78, 6, original-607 and 833 collections must not be added into a single total.

The six standard failures retain these identities: `AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser`, `.incompletePaymentCarriesAuditableReasonCodesWithoutRawText`; `FinanceP03IdentityLifecycleTest.laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking`, `.durableMessageProofSurvivesRegistryCacheReplacement`, `.multipleOrdersOnOneMessageProofForceASeparateReviewSeries`; and `LocalPaymentBookingTest.offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive`. Their full assertions and traces remain in the copied XML. No failure is relabelled EXPECTED_RED merely to make CI green.

### Audited failure and command accounting

`python qa/aeris-finance-quality/v62-evidence-summary.py --label v62-evidence-summary-r3` is a read-only evidence reconciliation, **not another product test run**. It verifies all 608 identities, unchanged fixtures/top-level expectations, unique method identities, artifact hashes and the 721 file instances in the current native/Node tested-source manifests. These all match the tested bytes at the audit. Its `AUDIT_PASS_PRODUCT_FAILURES_RETAINED` means the evidence reconciles; it does not mean the financial release gates pass. Inputs and full native assertion stacks are in `v62-evidence-summary-r3/result.json`; all raw non-PASS cases are copied, without status changes, to its two ledgers.

The native execution metadata records base HEAD `c815f19f6a293efe0236a1441ffcac91707d8c1c` plus working diff SHA-256 `87ddc36f64b772d8dfcb1b9edb9799390df2e6d05cb01827aaabb59494900a39`, and before/after source manifests, rather than a clean `b6301f88` checkout. Those tested product bytes were subsequently committed in `b6301f8810662c5ced61de4a642ebfc4acacbbe2`; this audit rechecks the relevant bytes against that current checkout. It does not misstate the original command as a later exact-head CI run. The final consolidation changes only these reports and QA helpers; no new product fix, model call, phone action, migration or deployment is included.

| Current JVM failure | Actual assertion / boundary |
| --- | --- |
| `messagingStyleLinesReachThePaymentParser` | Expected 10000, actual 0 for the original `已支付¥100` input. The old auto-ingest expectation conflicts with the current explicit currency/source gate; the original FAIL remains. |
| `incompletePaymentCarriesAuditableReasonCodesWithoutRawText` | Expected missing `{amount,direction}`, actual `{amount,direction,currency}`. Currency uncertainty is now explicitly retained. |
| `laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking` | Empty booking list at `.single()` on line110. The original first capture has an unqualified `¥` and no explicit currency; a late reference is not permission to invent it. |
| `durableMessageProofSurvivesRegistryCacheReplacement` | Empty booking list at `.single()` on line78, under the same original implicit-currency auto-booking contract. |
| `multipleOrdersOnOneMessageProofForceASeparateReviewSeries` | Expected two bookings, actual zero on line92. Preserving raw events/review does not satisfy the original booking expectation. |
| `offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive` | Empty booking list at `.single()` on line292 before receipt-recovery assertions; the original `支付成功 ¥34.00` input lacks explicit currency. Therefore this raw run does not prove the subsequent recovery assertions. |

These explanations identify the changed safety contract and the point of failure; they do not silently approve dropping the old contracts. Current-capability tests are separate. The raw frozen matrix FAIL IDs are **A009, A011, A201, A203, G-REUSED-014**. The A-cases expect two independent records where the observable evidence still yields one. Original identity reds remain 24 A-series (4 FAIL,20 EXPECTED_RED) plus C005/C007 (2 EXPECTED_RED); none is converted to PASS by safe quarantine.

There are **34 distinct inherited Node command names**, not 34 all-green suites: `node-repair-r3` is 9 exit0 / 3 exit1, `v62-remaining-node-r3` is 19 exit0 / 2 exit1, and the separate original `aeris-node` is exit0. Deduplicated command outcomes are therefore **29 exit0 / 5 exit1**. The retained failing names are `aeris-dom`, `p02-web`, `p02-dom`, `task21`, and `p03-server`. A command exit count is not a count of test cases. Earlier environment-repair attempts remain outside this selected latest-per-name set and remain on disk.

- The raw `task21` command returns HTTP409 `currency_client_upgrade_required` where the original protocol expects200. The derived replay changes only import/output paths and the `X-Finance-Money-Version:3` capability header; all221 original assertion lines remain. It passes separately in `v62-upgraded-task21/result.json`, and does **not** overwrite the original protocol FAIL.
- The raw `p03-server` command stops before business assertions at an Undici `bad port` startup error. The isolated startup-only retry records **25 PASS** in `v62-p03-server-startup-retry/result/server.ndjson`; its first startup failure remains preserved. No business input, expectation or deadline changed.
- The six original actual-Chrome component cases are four PASS/two FAIL; the failed omitted-currency assertions are retained in `original-six.ndjson`. P02 web/DOM commands also retain their original mixed-currency/input-forwarding reds. They are not reclassified by a later versioned fixture adapter.

The eight AI mock/replay collections are individually **protocol17 PASS; model boundary8 PASS; quality76 PASS; rich51 PASS; roles21 PASS/2 FAIL; recovery14 PASS; migration7 PASS; actual Chrome11 PASS**. They exercise actual local validators, service/D1/HTTP/browser paths where applicable, with controlled model responses. They are not eight live-model quality runs. The two roles FAIL IDs are `refund-role-only-copies-original-source-money` and `income-role-is-not-an-expense`: each changes the requested direction while leaving the selected candidate's original expense phrases (`本次`,`扣除`) in place. Current candidate-local movement validation refuses the inconsistent input at `finance-ai.mjs:116`. Their original source inputs and errors remain untouched; six separate explicit direction controls test the current safety boundary.

### Raw and versioned P04 evidence

All18 original P04 identities remain traceable. Raw original-input/oracle evaluation is **12 PASS / 6 EXPECTED_RED**. The separate approved current-protocol input-forwarding evaluation is **18 PASS**. Only these six statuses differ:

| Case ID | Raw | Versioned | Preserved contract and actual forwarding |
| --- | --- | --- | --- |
| D004 | EXPECTED_RED | PASS | Forward the fixture's own declared default currency to the current parser policy; original amount/currency/expected oracle unchanged. |
| D008 | EXPECTED_RED | PASS | Same input-forwarding boundary. |
| D016 | EXPECTED_RED | PASS | Same input-forwarding boundary. |
| D020 | EXPECTED_RED | PASS | Same input-forwarding boundary. |
| DW-DOM-MIXED-budget | EXPECTED_RED | PASS | Forward original protocol2 and declared nonmarket FX7/date through actual local FX/D1 and its immutable rate reference; original `/800/` budget assertion remains. |
| DW-DOM-MIXED-category | EXPECTED_RED | PASS | The same original FX inputs and category oracle, through the actual controller. |

The other12 are D012,D024,DW-FMT-JPY-10000,DW-FMT-JPY-12345,DW-MIX-USD,DW-MIX-EUR,DW-MIX-HKD,DW-MIX-GBP,DW-MIX-JPY,DW-HISTORY-2026-10-18,DW-HISTORY-2026-10-19,DW-FX-MISSING-OFFLINE, all PASS in both evaluations. The 18 are part of608; neither18 nor the versioned608 is added to raw608 or the standard JVM total.

The forwarded native currency collection has24 PASS in `v62-forwarded/native/kotlin-D.ndjson`; four actual DOM cases pass in `v62-forwarded-dom-safe/web-dom.ndjson`. The first forwarding invocation still used the old driver's fixed output path and rewrote deterministic identical bytes. All1,430 pre-existing artifact content hashes were rechecked unchanged; this is disclosed rather than claimed as zero writes. A fresh unique-output replay and its provenance are retained in `v62-forwarded-dom-safe`. The committed helper now clones the driver and changes only its output path, with an exact single-match guard and a non-overwriting destination. Historical inputs, expectations and result contents remain preserved.

## Samsung SDK diagnosis, with synthetic images only

The owner-authorized SM-S9360 / API 36 was verified as a physical device before installing the unique diagnostic packages. The archived APK/source hashes were checked before installation. Tests call ML Kit directly on generated/archived synthetic pixels; no WeChat, Alipay, chat, payment, screen capture or sensitive permission was opened or granted.

- Cold product-engine corpus: 8/8 safety assertions, **2/8 exact references**, zero ledger writes.
- Direct SDK readiness followed by the unchanged corpus: 8/8 safety assertions, **2/8 exact references**, zero ledger writes.
- The unchanged original image, six derived views: **0/6 whole-reference exact recognition**. Source PNG SHA-256 remains `46e6442173c53550e68f06bc8bbed7cb88557a751c8f244a9baa75100ff4c68f`.
- The product's 10-second OCR deadline is unchanged. The separate 60-second direct-SDK diagnostic is readiness evidence, not a longer production timeout or a business PASS.
- The two packages, proved absent before this run, were uninstalled after pulling their QA-only evidence. Formal `uk.thewyj.app` remains 1.3.37/50, and before/after hashes of accessibility/notification-listener configuration match. No formal data clear, force-stop, permission adjustment or APK replacement occurred.

Evidence: `v62-samsung-sdk/result.json` and its raw cold/readiness instrumentation outputs. Diagnostic APK SHA-256: `a8ac85d8d2e445e86b804363a6cc7d3f6d80e47b9ede346c8ac87a673aa5297f`. The separate fresh standard Debug artifact is `9802bdbf5b55f6e43475dd6550438141a6dde7f38859f361554e4402be577947` and was not installed.

The original all-empty emulator result remains archived. It did not recur as an empty result in this controlled Samsung run; its original cause is not promoted to CONFIRMED. The alphanumeric reference failure does reproduce on both emulator and Samsung. There is no evidence for blaming the Samsung driver. Independent Chinese/Latin diagnostic agreement can also be wrong; the diagnostic consensus is not enabled as a product fallback. Latin substring presence (4/6) is distinct from whole-token exact recognition (3/6).

## Identity, migration, compatibility and release limits

C005/C007 and the A-series still lack sufficient independent operation/reference evidence in their original inputs. The original 26 red targets remain 4 FAIL / 22 EXPECTED_RED. Safe review preserves their raw events; it is not complete business support or proof of two independent captures. No invented provider credential or revised sample truth was introduced.

Fresh configured separate-process tests are retained in `v62-regression-configured`: the five explicit trace controls pass; process seed/restore pass; clearing, correction and unified bridge seed/restore pass with independent JVMs and actual isolated HTTP/D1. The original implicit-currency legacy seed still fails, and its restore is NOT_TESTED. An earlier standalone invocation lacked the preserved fixture-root environment; four bridge commands stopped before assertions. Those failures remain in `v62-regression` and are not counted as product passes.

Six-currency HTTP/D1, incremental migration/recovery, real Chromium, raw transport and reviewed currency-policy runs are separately logged under `node-repair-r3`; their counts and any exceptions are retained individually. Raw frozen expectations and owner-approved input-forwarding v2 results are separate. A Git revert is not a database rollback. Synthetic recovery does not prove recovery of a real user backup or authorize a Production migration.

This round makes **zero new external model calls**. The prior 12-call live-model evidence remains historical, including its failures. Prompt-6 live model quality is NOT_TESTED; the incompatible model stays disabled and financial AI stays Production OFF/release-held. Existing D-01/D-02 closure and Task26 owner waivers are not relabelled.

The protected old worktrees, P01/P02 fixtures, failure records and seals remain separate. Final closure requires the outstanding identity/provider evidence, relevant genuine source/profile and business acceptance, verified real backup/old-client recovery, applicable exact-source CI/Preview gates and a separately qualified release. The SDK probes are not W01–W10 or real-transaction acceptance.
