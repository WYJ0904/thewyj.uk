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
| New candidate-local AI evidence controls | 78 PASS | `v62-original/semantic-anchor.json` |
| Separate direction-mismatch controls | 6 PASS | `v62-original/direction-controls.json` |
| AI protocol, model boundary, quality, rich output, recovery, migration and actual Chrome with mocked model | Executed; separate command outcomes retained | `ai-r3/commands.json` and each raw output |
| Old AI roles suite | **21 PASS / 2 FAIL** | `ai-r3/roles.log`; original input/oracle unchanged |
| Lint / Debug | Lint and Debug artifacts produced; combined Gradle exit is **1** because six unit methods fail | `v62-native/lint-results-debug.xml`, `app-debug.apk` and artifact hashes |

The old roles failures change only the requested direction while retaining expense-labelled source evidence. They remain raw FAIL. The new direction tests use explicit, separately identified source contracts; they do not replace the old fixtures. The 78, 6, original-607 and 833 collections must not be added into a single total.

The six standard failures retain these identities: `AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser`, `.incompletePaymentCarriesAuditableReasonCodesWithoutRawText`; `FinanceP03IdentityLifecycleTest.laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking`, `.durableMessageProofSurvivesRegistryCacheReplacement`, `.multipleOrdersOnOneMessageProofForceASeparateReviewSeries`; and `LocalPaymentBookingTest.offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive`. Their full assertions and traces remain in the copied XML. No failure is relabelled EXPECTED_RED merely to make CI green.

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
