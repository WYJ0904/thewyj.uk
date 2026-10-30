# Aeris V6.2 — P03–P07 quality and release consolidation

**2026-10-29 work, final readback2026-10-30 HKT; NOT COMPLETE.** The corrected Hosted rerun is complete: four runner entries pass; authentication has12 PASS/0 FAIL plus1 NOT_TESTED disabled-service acceptance, spatial audit has55 actual captures with0 FAIL, motion has6 PASS and30 alternating gestures (10 per card), and normal owner login verifies an empty ledger. All earlier FAIL records remain. Device and post-release CI details are finalized separately below; RUNNING is never counted PASS.

Current disposition: **P03/P04/P05/P06 PARTIAL / financial RELEASE_HELD; P07 PARTIAL / isolated Preview sample accepted.** Independently qualified PR114 and PR116 CI/publish-boundary/title slices have been merged and deployed. PR116 changes7 CI/QA/report files, with no product-source difference. No full financial bundle, financial AI/OCR activation, financial Production migration or new signed/Stable Android package is released. Task27/P08 has not started.

## A. Source, worktrees and preserved work

All paths below are relative to `%USERPROFILE%` where applicable. The fixed checkout is not the released main branch: it deliberately retains the old Hotfix WIP. GitHub `main` and Production identities are recorded separately.

| Checkout / branch | Current known full SHA | Remote / release state |
| --- | --- | --- |
| Fixed `Desktop/编程/thewyj.uk`, `codex/android-accessibility-accounting-hotfix` | `e2febc6d9a33997bd9dc4cb042ecff216d31fde4` plus preserved WIP | Original protected checkout; not overwritten or switched to main; PR110 remains separate |
| GitHub `main` | `c4d63fa2fb8181a368826db034017fbdabd6ce6f` | PR114 and PR116 merged; Production release described below |
| Qualified PR114 source | `6330ee52e5ef61e5852f446dd6320e61a06d8d86` | Its Git tree equals released main `63b8c419` |
| `.codex/worktrees/aeris-ci-release-guards/thewyj.uk`, `codex/aeris-ci-proxy-resilience` | `bf7323b68a14ff7617d8f5e77d1e0abb299ad34e` | Exact-head8 Actions PASS/2 conditional SKIP plus Pages PASS; PR116 merged using expected-head compare-and-swap |
| `.codex/worktrees/aeris-finance-quality/thewyj.uk`, `codex/aeris-finance-quality` | `253a776f4bab013b13fdbf7545c932d45c91314b` | Local consolidation; product corrections in ancestor `b6301f8810662c5ced61de4a642ebfc4acacbbe2`; push HELD_SHARED_PREVIEW_SAFETY, not merged/released |
| Remote `codex/finance-release-convergence` | `1af08aa1731377698c6713ab553606a49ff927b8` | Draft [PR112](https://github.com/WYJ0904/thewyj.uk/pull/112); the newer local finance SHA is not falsely presented as its deployed head |
| `.codex/worktrees/aeris-p07-quality-release/thewyj.uk`, parent `codex/aeris-p07-quality-release` | `1571b3d53fb9788370088b5d967e027127a29c8a` | Draft [PR115](https://github.com/WYJ0904/thewyj.uk/pull/115), quality foundation |
| Same UI checkout, active `codex/aeris-spatial-preview` | Runtime implementation base `80139a03b5b655b4f4d7ba4e865778c7654bb91d`; accompanying QA/report commit identified by final Git receipt | Draft [PR117](https://github.com/WYJ0904/thewyj.uk/pull/117), based on PR115; spatial milestone includes ancestor `130bb76246707727a64336a100a7e593245ea5b8`; Hosted source below |
| Remote `codex/task26-wrong-review` | `6247c4148904cafa264204fc1816b2e8e1d4360a` | Draft [PR111](https://github.com/WYJ0904/thewyj.uk/pull/111); original checkout path unavailable; no restore or merge attempted |

These remote refs were read again during consolidation. The accompanying QA/report commit preserves all reviewed drivers, the isolated Android build/input helpers and final reports above the unchanged80139a03 runtime implementation. Its exact hash, changed-file list, final working-tree status and147-input equality proof are recorded in the local final Git receipt. Private credentials, browser profiles, raw evidence and backup ZIPs are excluded from Git/Pages. This distinguishes the deployed runtime SHA from its later evidence packaging; no self-referential commit hash is fabricated in this document.

### WIP protection before continuation

The apparent “30 files” was counted from actual state as **36 UI source candidates plus two finance helpers**, not discarded or recreated. A private non-overwriting snapshot was completed before proceeding:

| Archive under `docs/migration-evidence/aeris-p03-p07/owner-resume-20261029T071227Z/` | Bytes | SHA-256 |
| --- | ---: | --- |
| `source.zip` | 257,562 | `66fa6f944c0dd73b485b7c9bce0b100b9cb4b4d065c4da0c2a0dd6c2748bcbee` |
| `evidence.zip` | 2,458,536,577 | `8538a2f638da4cbb553aa1867d27dfcf33dafbb23f2bc1a4654c883f38d86033` |

The snapshot contains 4,354 evidence files, with CRC verification and no locked-file exclusion. It is private/ignored and may contain QA runtime configuration; it is not a public download or Pages input. Earlier `v62-restore` snapshots, old reports and original failures remain intact.

Before the2026-10-30 continuation, a further16-file source snapshot was saved in `resume-20261030-source`; ZIP SHA-256 `2afda30b52119cee4e46dd354b32845d4f4c53df4e17e6c8ce253319ee4e67c3`. Later new QA files are preserved by the final Git commit/evidence seal, rather than retroactively changing that snapshot.

## B. P0 status and responsibility

| Area | Implemented / verified in this continuation | Remaining gate and current status |
| --- | --- | --- |
| P03 identity and clearing | Existing strict operation/reference, preauthorization/Capture/Release/refund state machine retained; configured independent-JVM/HTTP/D1 seed/recovery and trace controls run | Original 26 identity red targets remain **4 FAIL / 22 EXPECTED_RED**. Missing independent operation/reference facts cannot be inferred from amount, merchant or time. C005/C007 remain EXPECTED_RED. Safe quarantine is not complete support. **PARTIAL / RELEASE_HELD** |
| P04 six currencies and FX | CNY/USD/EUR/HKD/GBP/JPY implementation and exact-money/FX/migration/browser protections inherited and re-evaluated; no new rounding or identity algorithm introduced here | Original-input P04 18 are **12 PASS / 6 EXPECTED_RED**; separately versioned forwarding contract is **18 PASS**, not a replacement for raw results. Real backup/old-client and full financial release gates remain. **PARTIAL / RELEASE_HELD** |
| P05 OCR / source isolation | Monetary glyph repair stops rewriting opaque reference identifiers; six new targeted methods reproduce 1 PASS/5 FAIL before and 6 PASS after. Physical SDK probes use synthetic pixels only | Original synthetic reference image still gives **0/6 whole-reference exact recognition** in six views; physical 8-image corpus is safety8/8 but reference-exact2/8. No fuzzy association or automatic booking fallback. Genuine source/profile/service/business gates remain. **PARTIAL / RELEASE_HELD** |
| P06 financial AI assistance | Candidate-local, direction-compatible amount evidence required; prompt identity `finance-assistance-6`; mock/replay validators and integration protections exercised | Old roles suite **21 PASS / 2 FAIL** retained. Zero new external model calls; prior 12-call evidence remains historical and exhausted. Prompt6 live quality **NOT_TESTED**. Financial AI remains Production OFF/held. **PARTIAL / RELEASE_HELD** |
| Android Hotfix / notification reliability | JVM/Lint/Debug, synthetic persistence and receipt controls; original Hotfix WIP protected. Diagnostic Samsung packages already removed after SDK probes | Separate actual MainActivity Preview login/WebView/touch and bounded recovery pass; original QA failures remain. This does not prove real notification/profile/settlement/Outbox business acceptance. No signed/Stable release. **PARTIAL / RELEASE_HELD** |
| D01 / D02 | Source/evidence unchanged | **CLOSED**, not reopened without new direct evidence |
| P07 | Guest UI policy, accessibility/interaction corrections, three-card spatial sample, finance/form samples; isolated Hosted Preview deployed and exact bytes verified | Full P07-01..15 is incomplete. Both first Hosted driver failures retained; corrected complete rerun passes. No Production spatial rollout. **PARTIAL / PREVIEW_ONLY** |
| Task26 historical release | Existing released history and waivers preserved; current-main browser protection results available | Historical **CLOSED_WITH_OWNER_WAIVER**, waivers stay WAIVED. PR111/current-main integration remains NOT_TESTED/held; original checkout missing. Task27 not started |

The two finance product corrections affect `PaymentScreenshotVerifier.kt` and `functions/_lib/finance-ai.mjs`; the rest of the new finance consolidation is QA/reporting. They do not change original transaction IDs, money arithmetic, the90-second ticket, schema, account rights, signing, formal App data or Production configuration. Full failure assertions and current/old-contract distinctions are in the finance checkout's `docs/release/AERIS_V62_FINANCE_QUALITY.md` at local commit `253a776f4bab013b13fdbf7545c932d45c91314b`; that unpushed report is not incorrectly linked as a file in this UI branch.

Financial push preflight is **HELD_SHARED_PREVIEW_SAFETY**, not a routine approval request. The remote PR112 stays at `1af08aa`; local code is its fast-forward descendant.48 changed blobs were checked and2 product diffs reviewed. Pages currently auto-deploys all branches to a shared Preview D1/R2 with Workers AI binding and `WORKERS_AI_ENABLED=true`. This metadata does not prove the separate financial-AI flag is enabled, but it also does not establish this new financial candidate's safe isolation. No shared config was altered and no push performed. Local final-head remote CI is NOT_TESTED_NOT_PUSHED; the old remote run40451494159 remains5 FAIL/4 SKIP. Evidence: finance `v62-pr112-push-preflight-r1`.

## C. Test matrix and execution boundaries

### Financial collections — keep overlaps and versions separate

Fresh Oct29 evidence resides in the finance checkout under `docs/migration-evidence/aeris-finance-quality/`. These are executed local results, not new remote exact-head financial CI. The native run records base `c815f19` plus working-diff SHA `87ddc36f64b772d8dfcb1b9edb9799390df2e6d05cb01827aaabb59494900a39`; the tested product bytes were subsequently committed in `b6301f88` and rechecked by the read-only reconciliation.

| Collection | Actual result | Traceable evidence / accounting |
| --- | --- | --- |
| Standard JVM/Robolectric | **833 = 827 PASS / 6 FAIL** | `v62-native/command.json`, JUnit XML, `android.log` |
| Original607, disjoint identity mapping | **602 PASS / 5 FAIL** | Original588 JVM identities:585P/3F; original Node13P; original actual Chrome6:4P/2F. These are subsets of other collections and are not added again |
| Frozen608 original input/oracle evaluation | **552 PASS / 5 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED** | `v62-original/frozen-608-reevaluated.json` |
| Versioned input-forwarding evaluation, same608 IDs | **558 PASS / 5 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED** | `v62-original/contract-608-current.json`; raw608 remains unchanged |
| Original P03 63 identities | **58 PASS / 4 FAIL / 1 NOT_TESTED** | Includes original legacy seed FAIL and its restore NOT_TESTED |
| Added38 controls | **38 PASS** | Trace5, projection15, actual legacy browser10, provider controls8; overlaps larger suites |
| New AI semantic and separate direction controls | **78 PASS**, separate **6 PASS** | `v62-original/semantic-anchor.json`, `direction-controls.json`; controlled evidence, not live models |
| AI mock/replay collections | Protocol17P; boundary8P; quality76P; rich51P; roles21P/2F; recovery14P; migration7P; actual Chrome11P | `ai-r3/commands.json` and raw logs. Do not count this as eight live-provider quality runs |
| Deduplicated inherited Node command names | **34 commands:29 exit0 /5 exit1** | Command outcomes are not case counts. Raw failing names: `aeris-dom`, `p02-web`, `p02-dom`, `task21`, `p03-server` |
| Raw task21 current-capability replay | Separate PASS; raw original protocol still FAIL | Only import/output paths and `X-Finance-Money-Version:3` differ; 221 original assertion lines retained; `v62-upgraded-task21/result.json` |
| P03 server startup-only retry | **25 PASS**, separate from retained raw startup FAIL | `v62-p03-server-startup-retry/result/server.ndjson`; original Undici `bad port` stopped before assertions |
| Lint / Debug | Lint **0 errors/fatal,90 warnings,13 hints**; Debug built | Combined Gradle exit1 because six JVM methods fail; artifact SHA `9802bdbf5b55f6e43475dd6550438141a6dde7f38859f361554e4402be577947`, not installed as the formal App |
| Evidence reconciliation | `AUDIT_PASS_PRODUCT_FAILURES_RETAINED` | `v62-evidence-summary-r3/result.json`; verifies608 identities, unchanged top-level input/oracle, unique native identities and721 tested-source file instances. It is an audit, not another passing product suite |

Raw frozen FAIL IDs are **A009,A011,A201,A203,G-REUSED-014**. Original identity reds are24 A-series (4F/20ER) plus C005/C007 (2ER). Different captures cannot be invented where the source supplies no independent operation/reference evidence.

The six JVM failures retain these exact identities: `AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser`, `.incompletePaymentCarriesAuditableReasonCodesWithoutRawText`; `FinanceP03IdentityLifecycleTest.laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking`, `.durableMessageProofSurvivesRegistryCacheReplacement`, `.multipleOrdersOnOneMessageProofForceASeparateReviewSeries`; `LocalPaymentBookingTest.offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive`. They fail at explicit-currency/source expectations or before later receipt assertions; a stopped assertion sequence does not prove the unexecuted recovery steps. No raw FAIL has been relabelled merely for a green total.

For P04's18, raw EXPECTED_RED→versioned PASS is limited to **D004,D008,D016,D020,DW-DOM-MIXED-budget,DW-DOM-MIXED-category**. The fixture's own declared currency/protocol/FX inputs are forwarded through current boundaries; original monetary expectations remain. The other12 pass in both. All1,430 pre-existing artifact content hashes were rechecked unchanged after an early forwarding driver rewrote identical deterministic output at its old path; that metadata write is disclosed. The corrected driver uses a new non-overwriting path. Safe refusal or an adapted protocol is not substituted for a raw original PASS.

### Migration, recovery and compatibility

The financial branch retains Room schema18 with its incremental chain (including the declared14→15 auto-migration/spec), and financial D1 increments0027–0034. None is executed on Production by this continuation. Existing synthesis covers HTTP/D1 FX/migrations, review migration, raw transport, configured independent-process Outbox/receipt/correction bridges and legacy projection/browser recovery; commands and outcomes are individually retained in `node-repair-r3`, `v62-regression`, `v62-regression-configured` and `v62-evidence-summary-r3`.

The original implicit-CNY bridge seed still fails and its restore is NOT_TESTED. Earlier missing-fixture-root invocations stopped before assertions and remain failures. Real user backup compatibility, provider-authentic operation relationships, all old-client upgrade/downgrade cases and a deployable real database recovery guarantee are not promoted from synthetic tests to PASS. A Git revert is not a database rollback; no delete/rebuild/destructive migration is used to make compatibility appear successful.

### CI and browser quality evidence

| Source / collection | Actual result and limit |
| --- | --- |
| PR114 qualified source6330ee5 | Nine executed Actions PASS, readiness job SKIP; separate Pages PASS. Main merge tree equals tested source tree |
| Main push run40819002809 | Original cloud-only browser FAIL retained; other nine jobs passed. Prior PR PASS does not erase this main-run failure |
| PR116 a87a43d / run40820655409 | 7 Actions PASS /1 FAIL /2 SKIP; recipient initialization exceeded unchanged25s deadline |
| PR1165fbb24b / run40836191455 | 8 Actions PASS /0 FAIL /2 SKIP, separate Pages PASS. Actual >16MiB EXE/MP4 multipart/download hashes and cleanup passed; only one complete passing run |
| PR116bf7323b / run40841259381 | **8 executed Actions PASS,2 conditional SKIP, Pages PASS**. New failure-diagnostic3s budget preserves the identical original error and unchanged25s business deadline. Later passing runs do not close the original intermittent recipient timeout |
| Python full discovery after reviewed static-contract v2 | 185/185 local PASS; earlier183P/2F retained. Tooling68 and static31 are overlapping subsets, not additional185 cases |
| Pages staging security | 28 TAP entries PASS, no skipped assertions; containment/link/reparse/private-path protections preserved |
| Public UI policy/DOM, latest local suite | 41 raw TAP entries =40 leaves, including explicit missing-route OFF control; earlier40 entries/39 leaves remains historical |
| Quality browser components / actual local auth | 14 component PASS; local auth12 PASS; actual100/200/400% browser zoom18 role/theme captures within the latter collection |
| Full local toolbox | 104 tools,51 modes,27 workflow flows,12 capabilities,86 downloads; PASS after resolving explicit Python/validator environment. Earlier host/import failures remain |
| Module / storage contracts | 57 modules/92 imports;29 storage-key families pass. Structural counts are not additional functional-case counts |

PR116's SDK process fatality is narrowly identified and VM-controlled; the intermittent **recipient startup timeout remains INCONCLUSIVE / NOT CLOSED**. The a87 runtime warning occurred while the host survived; the later passing runtime had no guarded warning, so it cannot prove that the affected request path was repaired. The latest diagnostic deadline fixes possible indefinite post-failure collection, not the original recipient startup. No retry, assertion deletion, application timeout extension, dependency upgrade or Production Worker patch is introduced. See the [qualified CI report](https://github.com/WYJ0904/thewyj.uk/blob/bf7323b68a14ff7617d8f5e77d1e0abb299ad34e/docs/release/AERIS_CI_PROXY_RESILIENCE.md).

## D. P07 actual coverage and Preview acceptance

### What changed, and what the screenshots represent

The implemented independent milestone is **home/three-card spatial interaction + dense CNY finance workspace + login/account form presentation**, supported by shared accessibility/motion corrections. It preserves all three cards, original positioning/rotation authority, size/layout/content settings, navigation IDs and owner-scoped storage. The inner visual layer handles hover/drag lift/entry motion; functional handles remain on the stable root layer. Existing first-party SVGs/system fonts/CSS/WAAPI are used; no new external runtime library or copied third-party logo is introduced.

`spatial-before-r7` contains54 actual local screenshots of the recovered quality candidate, **not the old Production site**. `spatial-after-r1` contains54 first-prototype local captures before final refinements. Each is three pages × nine widths × two themes. These use clearly synthetic CNY1800.00/68.40/9.20 records and never prove a real payment or P04 six-currency delivery. Final Hosted captures are separate below; they are actual Chromium output, not image-generation mockups.

The initial4px handle-hover displacement was a real prototype layout defect; moving only card content into the visual wrapper makes the handle position-stability test pass. Continuous Capture loss was independently isolated to incomplete CDP input: a plain data-document control with no Aeris code retained0/30 captures when move `button` was omitted and30/30 with `button:'left'`. Product lost-capture cancellation was preserved. Local motion passed six scenario contracts with30 consecutive **learning-card** gestures in `spatial-motion-1793253728591`, without diagnostic style overrides. The pure-control30, product30 and later repeats are not additional unique business-case counts.

### First Hosted run and corrected rerun

`v62-hosted-browser-r1/result.json` is **2 entry points PASS /2 FAIL**, not a full Preview PASS:

- `v62-hosted-auth-r1`: **11 PASS /1 FAIL**. The failure asserted an empty global admin error bar after user-list retry, while the owned environment has Task18 disabled. The corrected driver scopes its recovery assertion to the actual user-list operation. The original failure remains; it is not silently reclassified as a passing product test. Actual guest/ordinary/admin, server policy and100/200/400% zoom checks passed, with18 real role/theme/zoom captures among28 captures.
- `spatial-after-r101`:54 Hosted captures and two completed contracts PASS, then one extra opened-ledger assertion FAIL. Direct inspection shows the QA selector `.finance-transaction-row` does not match product `article[data-finance-transaction]`; three synchronized synthetic records are visible. The corrected driver retains the three-row assertion using the product's data attribute. Validation Cloud bootstrap independently reports transaction_count3, raw_event_count0, server_version3. The first result's copied “local/super-admin” scope label was inaccurate: the actual origin is Hosted and the actor is the separate ordinary validation account with a test entitlement. That label is corrected for the new run, while original raw bytes remain.
- Hosted motion `spatial-motion-1793262206298`: six scenario contracts PASS, including30 learning-card gestures, reduced-motion control and root-position authority. The native preference case here is a component signal, not a physical Android claim.
- Normal independent owner login: HTTP200, **transaction_count0 / raw_event_count0**. Validation rows are not shared into its ledger.

The corrected Hosted runner `v62-hosted-browser-r2` has **4 entries PASS /0 FAIL**. Authentication `v62-hosted-auth-r2` has12 PASS/0 FAIL and1 separate NOT_TESTED disabled-message/role-service acceptance, with actual user-list recovery still asserted. `spatial-after-r102` has55 screenshots/0 FAIL (54 page-width-theme combinations plus an opened ledger). The new `spatial-motion-1793262778065` set has6 scenario PASS/0 FAIL and30 gestures rotating learning/finance/tools, ten each. There is no diagnostic CSS override. These repetitions are not30 distinct business cases and not30 per card. Final HTTP readback `v62-hosted-ledger-final-r1` independently confirms owner0 transactions/0 raw events/version0, validation3 synthetic transactions/0 raw events/version3. Actual screenshot review found no horizontal overflow, missing cards or clipped ledger actions in these samples. Transient sync-in-progress screenshots are actual UI states; they are not substituted for the separate server persistence proof. Field Core Web Vitals, professional screen-reader acceptance and a blanket “60fps on all devices” remain NOT_TESTED.

### P07-01 through P07-15 — no full-site completion claim

| Item | Design / implementation coverage | Screenshot / functional / Preview status | Production status |
| --- | --- | --- | --- |
| P07-01 Public home, brand, three floating cards | Spatial sample implemented; three cards and settings retained | Hosted nine-width/theme captures and6 motion contracts PASS;30 alternating gestures PASS,10 per card | Preview accepted; Spatial milestone NOT_RELEASED |
| P07-02 Login, registration, session recovery | Shared labels/tabs/errors/focus/recovery quality fixes and form sample implemented | Actual registration/login/server policy and real zoom PASS; corrected auth12P/0F plus1 disabled-service NT; first11P/1F retained | Preview sample accepted; full sample NOT_RELEASED |
| P07-03 Authenticated personal space | Shared quality, cards and owner storage retained; complete new information architecture not finished | Local owner isolation and normal Hosted owner login/empty ledger verified; full personal-space redesign PARTIAL | NOT_RELEASED |
| P07-04 Language selection, quiz, answer feedback | Existing quiz/motion path protected; no complete new learning-page spatial redesign | Existing CI/browser behavior evidence; new full-page visual acceptance NOT_TESTED | Existing baseline retained; new redesign NOT_RELEASED |
| P07-05 Wrong book, Mastery, statistics, achievements | Existing Task26 behavior protected; separate PR111 not integrated | Current-main five-width CI protection passes; PR111/current-main combined runtime NOT_TESTED | Historical Task26 waivers retained; PR111 NOT_RELEASED |
| P07-06 Finance, budgets, currencies, candidates, recovery | Dense CNY workspace/form sample implemented; full unmerged P04 backend excluded |55 Hosted sample captures include an opened3-row ledger; exact original amounts and Cloud3-row persistence verified. Full multicurrency/recovery UI Preview acceptance NOT_TESTED | CNY Preview sample accepted; financial/spatial additions NOT_RELEASED |
| P07-07 Notification archive and Android finance relation | Existing UI/contracts retained; no complete new archive redesign | SDK-only evidence is not notification UI acceptance. Actual MainActivity Preview/touch/recovery pass within scope; full archive/service acceptance NOT_TESTED | New archive/recognition NOT_RELEASED |
| P07-08 Toolbox and workspaces | Shared feedback/focus/navigation improvements; full spatial redesign remains PARTIAL | Existing local104-tool/51-mode suite PASS; complete new Hosted visual matrix NOT_TESTED | New spatial toolbox NOT_RELEASED |
| P07-09 Workflow editor | Existing execution/state behaviors retained; full new editor design not completed | Local27 flows/12 capabilities protection; full Hosted editor UX/visual acceptance NOT_TESTED | New redesign NOT_RELEASED |
| P07-10 File transfer/share/chat entrances | Existing progress/share/clipboard protections retained | PR1165fbb and bf732 actual file integrity PASS; prior recipient timeout INCONCLUSIVE. New full spatial sharing UI NOT_TESTED | Independent CI diagnostics released; no transfer redesign |
| P07-11 Membership/plans/recharge/rights | Shared component quality and existing price/authority contracts retained | Existing behavior protected; test rights only in owned QA D1. Full new membership visual/Preview acceptance NOT_TESTED; no payment | Prices/rights unchanged |
| P07-12 Account/security/device/settings | Labels/dialog/menu/zoom quality implemented; no complete new security/device information architecture | Local auth/AX/zoom passes; first Hosted role/zoom evidence and scoped rerun; full device/settings matrix PARTIAL | Full redesign NOT_RELEASED |
| P07-13 Admin and Feature Flags | Minimum public UI policy plus admin/tab/loading/error quality fixes | Hosted OFF/ON/override/Kill/isolation and scoped user-list error recovery PASS; Task18-disabled business services NT; oldFAIL retained | No Production P07 activation |
| P07-14 Changelog/download/trial/other public pages | Existing brand/runtime contracts preserved; no complete page-by-page new spatial design | Exact public-file proof covers delivered bytes; full new page-specific visual acceptance NOT_TESTED | Only qualified PR114 tooling/title slice released |
| P07-15 Global components/states/icons/motion | Shared system implemented in part, with natural native popovers, focus, static reduced motion and layered card transforms |40 leaf policy/DOM cases,14 component checks, role/zoom and six motion scenarios; full all-page visual/performance closure PARTIAL | New spatial system NOT_RELEASED |

“Shared style present” does not mean a page has completed its design and actual interaction acceptance. No row inherits PASS merely because another page shares its CSS.

## E. Deployment, Feature Flags and rollback

| Environment | Source / deployment | Byte/build evidence | Runtime scope |
| --- | --- | --- | --- |
| Production `https://thewyj.uk` | main `c4d63fa2fb8181a368826db034017fbdabd6ce6f`; deployment `55b78a0f-8419-4054-b9c2-3ffc26da3f20` |85 public files equal Git source;5 exclusion probes PASS; released tree equals qualified PR116bf732; public app bytes remain identical to PR114 release | CI/build safety/UTF8/tooling/title plus bounded CI transport diagnostics. Financial flags, D1/R2 bindings, member prices/rights, signed APK and Stable pointer unchanged |
| PR114 qualified Preview | `6330ee52e5ef61e5852f446dd6320e61a06d8d86`; deployment `f4ed8e24-71e1-4f1c-9e66-e5ba08687456` |85 public files byte-equal; exact-head Actions and Pages proof | Release qualification for that narrow slice only |
| Owned P07 UI Preview | `80139a03b5b655b4f4d7ba4e865778c7654bb91d`; deployment `ac8cec2c-24ba-4e75-9e8d-4d6be71f4648`; [actual URL](https://ac8cec2c.thewyj-p07-ui-rc.pages.dev) |147 committed allowlisted build inputs; build-file-list tree SHA-256 `a7d1afcdd001856d4cf08d2953dc786d3d063765d7d35b9cf53c84a668aaac86`;87 public files independently byte-equal, exclusion probes pass | Independent UI QA D1 `ee869f78-b54a-4018-bc99-871089ecb8cd`; no R2/AI binding; `WORKERS_AI_ENABLED=false`; no Production data |

The build-tree SHA identifies the serialized verified file list, not a ZIP digest or a public byte comparison of the compiled Functions bundle. The latter is established separately by committed build inputs and deployment metadata. Whole developer workspaces, test/private folders, source ZIPs and credentials were never used as Pages upload inputs.

| Control | Production observation | Owned UI Preview |
| --- | --- | --- |
| P07 UI flag `p07_accessibility` | Absent/OFF at qualified post-deploy audit; not activated here | ON100% in Stable/Beta/Experimental for isolated UI QA; OFF/override/Kill tests use CAS and restore scope |
| Existing Task26 flags | Preserved: adaptive_learning/mastery_score Stable100%; other recorded optional flags unchanged/OFF as audited | No authority copied from Production; only independent test environment settings |
| Financial P03–P06 activation | Not enabled by this release; financial schema still existing task16=1/task21=2 in Production | This candidate inherits main's CNY finance contract; it does not contain the full unmerged P04 backend or live financial AI |
| Payment-primary / test entitlement | Production prices/rights unchanged | Payment-primary remains false. Its admin membership API returned503; it was not enabled just for UI QA. Only freshly registered independent owner/validation users receive explicit reversible QA entitlement rows in owned D1; normal authentication remains real |
| Accounts/data | No formal login/session/password/ledger copied | Owner has an empty independent ledger; validation account alone holds synthetic CNY rows. No real account identity bridge is claimed |

Choosing Experimental on the existing Production site cannot load an unmerged backend or replace its deployed commit. The P07 Preview URL demonstrates the UI sample, not delivery of the unmerged full P04 six-currency product. Synthetic screenshots and passing validators are not proof that the owner's real account received new financial functionality.

Post-release evidence is under `v62-ci114-postdeploy-r1`, `v62-production-ci114-proof`, `v62-ci114-preview-proof` and `v62-ci114-preflight-r2`. These record unchanged Production D1 `11c288d8-c584-409f-bb1f-7e7af11793e5`, R2 `wyj-cloud-production`, flags and prices. No financial user rows were read or mutated by those qualification checks.

The previous successful Production deployment `9d98888f-a4ce-4bf6-b255-aa2947785e36` / main `f144956a6962f0a43c7b4fc603e7cf18aabdf068` remains an identified same-project rollback candidate. No rollback has been executed in this checkpoint. This narrow release has no database migration to undo. For the owned UI Preview, CAS-disable the UI flag or replace only the owned Preview deployment; do not delete formal data or revert financial schema. A future financial release still requires its own verified backup/recovery plan.

## F. Protection, physical-device scope, remaining blockers and cleanup

The fresh protection audit is **18/19 groups verified unchanged**, not19/19 PASS. It checks13,638 source entries and1,779 original raw-evidence entries; available groups have no file or Git-state drift. All five inherited manifests and6,135 sealed entries match, counts1935/2588/1186/183/243. These inventories overlap and are not combined into a unique-file total. See [AERIS_V62_PROTECTION_RECHECK.md](AERIS_V62_PROTECTION_RECHECK.md) and `v62-final-protection-r2/result.json`.

The original Task26 checkout path is missing; only its parent marker remains. Its826-file baseline cannot be verified at that path, although commit/remote branch6247c41 still exists. Cause is INCONCLUSIVE. No recovery, reinitialization or destructive operation was attempted. Read-only legacy three-way merge preview against main63b8 shows55 conflict blocks/27 files; it is not an actual modern merge verdict or a runtime test. Historical PR111 exact-head CI8 successes and current-main Task26 five-width successes are separate evidence and do not prove a newly integrated PR111.

Actual earlier Samsung SDK diagnosis verified SM-S9360/API36 and used only controlled synthetic images. Cold and warm corpora each passed8 safety assertions but only2 exact references; six original-image views yielded0 exact whole references. Original PNG SHA-256 `46e6442173c53550e68f06bc8bbed7cb88557a751c8f244a9baa75100ff4c68f` is unchanged. A60s direct-SDK readiness probe is not a change to the product10s deadline. The original emulator all-empty cause remains INCONCLUSIVE; the exact-reference limitation reproduces and is not attributed to a Samsung driver.

The formal App remains1.3.37/code50. The separate MainActivity package `uk.thewyj.app.v62spatialqa` and its `.test` package have completed scoped verification and were uninstalled. Native UI authentication4,442ms, normal HTTP-only WebView identity, actual phone rendering and three touch-open/cancel card editors pass; layout storage is unchanged. Corrected bounded lifecycle observations pass background recovery2,551ms and process restart11,955ms within the unchanged20s window. The earlier8s premature restart assertion remains1 FAIL; r2 shows the same `/select`/unresolved state at8,375ms and ready `/` at11,955ms. First IME-input, unnecessary-Back instrumentation and CRLF socket-guard failures are retained. Native Activity startup180ms is not confused with document readiness11,955ms. This collection is not a new W01–W10, private-chat, real-transfer, notification-service or all-profile acceptance. No new payment/claim was performed. Previous owner-authorized real-transfer history is not re-counted as ten independent new successful scenarios. See [the Samsung report](AERIS_V62_SAMSUNG_PREVIEW.md).

Device cleanup readback confirms both new packages absent, formal package version unchanged, and exact before/after SHA-256 equality for enabled accessibility services and notification listeners. These are selected protection readbacks, not a claim that every byte of the live phone stayed static. No formal app data was read or written by QA. No sensitive permission needed to be granted or revoked for this package. The temporary private credential file and hierarchy file were removed; actual APKs/screenshots/raw failures remain private local evidence. No screen-lock setting, Production account or payment app was operated.

| Remaining item | Nature / next condition |
| --- | --- |
| Intermittent transfer recipient initialization timeout | Direct old FAIL; current cause INCONCLUSIVE. Preserve diagnostic budget and original25s assertion; inspect new exact-head evidence rather than assuming one PASS closes it |
| PR116bf732 exact-head gates | Qualified8 Actions PASS/2 conditional SKIP+Pages PASS; independently merged c4d63fa. Post-merge main CI is reported separately; original intermittent timeout is still open |
| First Hosted auth and ledger-driver failures | Confirmed scope/selector defects corrected only in QA; r2 all4 runner entries PASS, oldFAIL retained. This closes these QA defects, not full P07 or real-business acceptance |
| P07 full page redesign / field performance / screen reader | Remaining page-specific work and true performance/assistive-technology acceptance; shared components or lab screenshots cannot substitute |
| P03 original identity reds | Need reliable operation/reference/predecessor/version/provider evidence or explicit owner acceptance of an unresolved business boundary; no fabricated linkage |
| P04 raw18 and original protocol conflict | Preserve raw versus versioned results; remaining old-client/real-backup acceptance and release gates still apply |
| P05 alpha-reference OCR and genuine source/profile chain | Exact recognition not closed; retain review/no automatic booking. Real service/notification/settlement evidence remains distinct from SDK pixels |
| P06 live prompt6 quality | No new paid-call authorization/budget; zero new calls. Keep financial AI OFF until genuinely qualified |
| Real financial DB backup/downgrade/Production migration | No irreversible Production operation without independently verified recovery. Git rollback is insufficient |
| Missing Task26 checkout / PR111 integration | Missing path remains an audit gap. No unsupported attribution, restore or historical waiver relabelling; separate qualified integration required |

Four explicitly owned, closed headless-browser runtime/profile directories were inventoried and removed after testing:2,908 files,492,315,197 logical bytes. Reparse points and running processes were checked before native PowerShell removal. Source/evidence deletion0, unrelated profiles0, prior denied paths0 (`v62-owned-profile-cleanup-r1`). Device QA cleanup/readback is recorded separately below. Necessary snapshots, failures, source, owned Preview build inputs and review login remain preserved. Independent Preview for owner review is intentionally retained. Downloads, desktop games, QQ, old worktrees, denied old AVD/Chrome-temp paths and formal data were not cleanup targets.

## G. Release decision and next authorized work

**Continue current P0; keep unqualified financial/AI/Android release held; complete the current isolated P07 milestone before further page-by-page redesign. Do not start Task27/P08.**

PR114 and PR116 narrow releases are distinguished by their source, qualification and live bytes. PR116's merged main run40842938178 completed10/10 jobs PASS, including Android runtime and credential discovery; older failures remain. The original intermittent recipient timeout stays INCONCLUSIVE. The P07 three-sample milestone is handed over as an accepted isolated Preview with the scoped phone results above. Full P07 page redesign and financial/AI release remain held; this milestone does not enable them.

Final readback2026-10-30: Production remains c4d63fa2 / deployment55b78a0f,85 public files/5 exclusion probes PASS again, and selected variables/flags/schema/prices/D1/R2/build settings match the pre-release snapshot. The fresh protection result `v62-final-protection-r3` again verifies18/19 available groups and all6,135 inherited sealed entries; the missing Task26 checkout remains unverified. Unqualified financial code stays local at253a776f, PR112 stays old-head Draft and unpushed. P07 runtime remains80139a03; subsequent QA/report commits do not change its147 allowlisted inputs. The final evidence seal and Git receipt identify the accompanying source/report commit; no self-referential commit hash is fabricated inside this report.

Owner review URL: [independent P07 Preview login](https://ac8cec2c.thewyj-p07-ui-rc.pages.dev/login). Its local login handoff is `docs/migration-evidence/aeris-p03-p07/private/OWNER_PREVIEW_ACCESS.md`, deliberately ignored and never uploaded or included in public build inputs. Owner ledger0 and validation ledger3 are separate. This Preview supports the existing CNY contract; it does not silently turn on the held full P04 backend. Retained build/backup/evidence files are documented; four current browser runtime profiles and both device test packages have been cleaned. D-01/D-02 remain CLOSED, Task26 historical waivers remain WAIVED, and Task27/P08 was not started. All original failures and raw/versioned608 distinctions remain auditable.
