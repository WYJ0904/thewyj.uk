# P07 Release 完整提交和文件分类

main `3eb268b748a6e7a1aaa7369059db474810bb59d4` → RC5 `482580b0855e14a61b3f6b51e9d91ae7855296cb`。共 129 提交，484 个净变更文件。

同一个提交可有多个类别；合并提交以第一父提交比较，保留全部父 SHA 和文件名于 JSON。类别描述涉及路径，不把 QA/文档变更算作运行时代码。

| # | 完整 SHA | 分类 | 提交 |
| --- | --- | --- | --- |
| 1 | `fa1fbcd26b626420ca9430c952bf6b1b8b6a96bf` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, BUILD_CI_TOOLING, EVIDENCE, FINANCE_PRESENTATION, FUNCTIONS_API, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | feat(p07-phase1): establish V3 design system tokens and Task25 preview policy |
| 2 | `29dc85453c2fbe5a81b7246bdba314996f541d88` | P07_UI | feat(p07-phase1): implement V3 home layout and layered spatial 3-card interactions |
| 3 | `e37a0263cdc2e0f7e6299b1e63004aaf94fc5366` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, LEARNING_UI, P07_UI | feat(p07-phase1): unify shared navigation and V3 login sample |
| 4 | `e377abff42b35b08b68b8885f33bc1f5af454583` | EVIDENCE, P07_UI, QA | test(p07-phase1): add spatial, accessibility, multi-viewport, and build audit evidence |
| 5 | `ed4940b5893f68776f245784883d5850679012a3` | EVIDENCE | docs(p07-phase1): publish Argon Phase 1 implementation report and live preview proof |
| 6 | `ec1776eef96e416868bf7e02f4a1d1e445d51b8c` | EVIDENCE | docs(p07-phase1): replace host-specific user paths with %USERPROFILE% in report |
| 7 | `01fa730bf587a54863f83f99ab5b005716e10e15` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | feat(p07): rework Phase 1 home workspace, V3 spatial cards, and unified shell |
| 8 | `7814a567ebd304a55e3bacb4dc9e393cd482d4a0` | EVIDENCE, P07_UI, QA | fix(p07): keep keyboard-focused cards visible in overlapping layouts and integrate gap validations |
| 9 | `18b3314a6839473b47d0916f205c3e2847eb1332` | QA | qa(p07): retry transient preview verification socket drops |
| 10 | `e817bb121185fd1cb72e751a29c4ffbae5a91258` | QA | qa(p07): interpolate uiApi check in login wait condition |
| 11 | `d18bda245a7fde3c9cd5538726528f244e17d06b` | EVIDENCE | docs(p07): publish visual rework handover report and live preview proof |
| 12 | `337bb32f1ce349f9c5d58bd6120932fa5e61a745` | EVIDENCE | docs(p07): link Draft PR #121 in handover report |
| 13 | `7295b95e455668372fe0ca5cef9fbc7e35fcd61c` | EVIDENCE, P07_UI, QA | feat(p07): unify business workspaces visual design across language, mastery, tools and finance |
| 14 | `ef48bc0369112949fab4acc1d852564ef2364f1c` | QA | qa(p07): add exists helper and adjust asset threshold for preview deploy |
| 15 | `d2f78e0008d79eff35467424f3748d5d443ef0bc` | EVIDENCE | docs(p07): add P07-D business workspaces delivery report and hosted preview evidence |
| 16 | `d26bbb8112e7d10a5dfede40af0fe19c4c447866` | EVIDENCE | docs(p07): link PR #122 and green Core CI run 41806374287 in P07-D report |
| 17 | `d28d21a5a8b952b6440f3558500d1c43e3e208e5` | ACCOUNT_MEMBERSHIP_ADMIN_UI, ADMIN_AUDIT_READ, BOOT_AUTH_POLICY, EVIDENCE, FINANCE_PRESENTATION, FUNCTIONS_API, LEARNING_UI, P07_UI, QA | feat(p07): address manual acceptance defects and restore V3 business workspaces |
| 18 | `f15019ba16aa4e5c0d4e47a4b9bd17f431616039` | EVIDENCE | docs(p07): publish visual and functional rework delivery report |
| 19 | `287d3708b4ec9f0ce0f166395d651a8477623639` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, LEARNING_UI, P07_UI | fix(p07): preserve active round progress and quiz state across project restore |
| 20 | `8a6834c7239e71ecee30108087b0e3c9da7d4879` | EVIDENCE | docs(p07): update rework report with latest preview deployment and regression fix |
| 21 | `94181ca9575782e1610078fd41e84c07aac9c213` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, LEARNING_UI, P07_UI | fix(p07): align Japanese AI unavailable alert with Task 15 browser test contract |
| 22 | `21b83316cbfdeb366c587b9e818a2c64e2199215` | EVIDENCE | docs(p07): record green Core CI 41837691268 and final preview verification proof |
| 23 | `addcb9e36b6fa9b24fad6f60c52e7ac73039ff0f` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, FINANCE_PRESENTATION, LEARNING_UI, P07_UI | fix(p07): resolve round 3 structural workspace defects, quiz layout and finance chart quality |
| 24 | `fb936d109d0900d02d35eb3493212e4c32c39699` | EVIDENCE | docs(p07): add P07 Round 3 structural fix report and preview verification evidence |
| 25 | `5798b61b26512d756793256111514297fcdb95bb` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, LEARNING_UI, P07_UI | fix(p07): resolve CI membership choices timeout, account modal hidden assertion and revert static flag on html root |
| 26 | `9a4c74997a47cfb1e92c5783d7f0885b42e21765` | EVIDENCE | docs(p07): add P07 Round 3 CI red fix report and verified preview proof |
| 27 | `d71e0fb67cbf9f82d7e6fc527398f5d3a8732a40` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, LEARNING_UI, P07_UI | fix(p07): align Japanese AI unavailable dialog with Task 15 contract |
| 28 | `993d6b141256a2b331c6764d76d999e5074f6970` | EVIDENCE | docs(p07): update preview proof for live deployment 59875f28 |
| 29 | `f62c8415a9d10744df4b7fc345f33eebd3f71a87` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, LEARNING_UI, P07_UI, QA | fix(p07): dismiss account and membership workspaces via Android back navigation, adapt task15 modal assertion |
| 30 | `00d5d0a135cad15d4f6e35aba85e32d0d48ca678` | EVIDENCE | docs(p07): update preview deployment proof for commit f62c841 |
| 31 | `f7949f8253f51ea2621c397743208971c0cec467` | EVIDENCE | docs(p07): finalize round 3 CI red fix report with green CI run 41964942578 |
| 32 | `ab86e35bf36c235a47499bdc3454dc1799465b9f` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, BUILD_CI_TOOLING, EVIDENCE, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07): stabilize workspace policy and release cache lifecycle |
| 33 | `fe7e7b33b4b5cac12739e0496b7d3ed7db36586d` | QA | test(p07): exercise supported workspace return and native entry points |
| 34 | `96db5c4f3672c3290a513fc7bfb61fcc6f9a0236` | QA | test(p07): await compiled fixture seed verification before browser users |
| 35 | `779398d6f49021ca6a731c9ec1a2857c6ad3a316` | QA | test(p07): reenter native browser opt-in after ordinary refresh |
| 36 | `5a246978a9e8acd25602dca02cf235f5ab80e85c` | QA | test(p07): verify upgraded module bytes, offline shell and preserved user storage |
| 37 | `252cb86a3c2fb5b81a2a9b525f854b633a32635a` | QA | chore(p07): isolate runtime Preview branch using existing allowlist publisher |
| 38 | `4855025c45f8b96696c45ff161bd4454e3138116` | QA | test(p07): resolve empty image sources safely in offline Logo verification |
| 39 | `5ee2e830dcf4357879616c05e587e4fde9c9f3f4` | QA | test(p07): assert guarded tools enter the independent membership route |
| 40 | `518d5bb98e30f92fb6e792bc0b9c5350f44e7f26` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, FINANCE_PRESENTATION, LEARNING_UI, P07_UI, QA | feat(p07): V3 workspace refactor for account and membership, collapsible trend chart, diagnostic amount validation |
| 41 | `295de9488277925a08be02aab0978309548ca6f0` | EVIDENCE | docs(p07): update preview deployment proof and live preview screenshots for commit 518d5bb |
| 42 | `5abf19a10790e51e99d433c8ea46bf5bd7549618` | EVIDENCE | docs(p07): publish P07-R4-B workspaces refactor delivery report |
| 43 | `9b02e1336b86dd6544ae25164eed6993fe1254a1` | EVIDENCE, P07_UI, QA | fix(p07): resolve mobile modal-panel element query in browser application flow test |
| 44 | `1f54ab69b265ab330ab6eb78a6146bd1d80d325f` | EVIDENCE | docs(p07): update preview deployment proof for commit 9b02e13 |
| 45 | `558efd4041f5466bab9ae6663425deef8f40911d` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, LEARNING_UI, P07_UI | fix(p07): preserve language workspace context during API membership required handling |
| 46 | `15fdd2b71b2f6a49957720a5aaed0135464f63fc` | EVIDENCE | docs(p07): update preview deployment proof for commit 558efd4 |
| 47 | `54b6603dc3cd2f83ca280dfe5597c7093a38226e` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, FINANCE_PRESENTATION, LEARNING_UI, P07_UI, QA | merge(p07): integrate fixed R4-B HEAD while preserving runtime ownership |
| 48 | `5b29f97c9056dea16c13abfc884f77931f4f3adf` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | chore(p07): version the combined runtime release independently |
| 49 | `9c22bf1dd9118178700e4780ccc27c8958de1e81` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07): keep policy retry hidden until explicit failure |
| 50 | `1e64d59d667193143248e36afbb03806d3b68b2b` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07): settle unavailable policy capability on supported legacy backends |
| 51 | `0f2677aaa01f3f1f20e8ba1e76be9fb2dcf204f4` | EVIDENCE, QA | test(p07): retain runtime evidence and cover supported backend fallback |
| 52 | `2ceb1f4eb9ba7a59dd2b3483e799e6e1a857c119` | QA | test(p07): isolate committed Pages staging for parallel browser runs |
| 53 | `3e0a5f364aece42f07603aa5108eaf8e9353fe34` | EVIDENCE | docs(p07): record strict hosted Preview policy and asset verification |
| 54 | `370dc902cb55db5f19f1ec65d6ceb43fbbd21d6f` | QA | test(p07): reject reused evidence labels before writing provenance |
| 55 | `7bc04954a7dd813d3e84575db61830a121354128` | QA | test(p07): retain adapter failure history and hash complete curated evidence |
| 56 | `6417005f70c34a5fc9bc35493587bd016aae8575` | QA | test(p07): measure mobile login after policy and form readiness |
| 57 | `52a07758ebeaf8633184a7d994505cdf32a84583` | QA | test(p07): capture real boot and timer state across warm reloads |
| 58 | `fb6ef9a48c72c71fb5fafdd733ec2c9ce44a8492` | EVIDENCE, QA | test(p07): enforce retained-cache and completed release PWA contracts |
| 59 | `0c87169aa4b75db4d00fe76a66bd32a62ead9e4a` | EVIDENCE, QA | docs(p07): deliver runtime repair evidence with unresolved acceptance gate held |
| 60 | `667dddd49aba07004863e98ff30f1cd041999300` | QA | test(p07-r4c): capture policy and background bootstrap failure mechanisms |
| 61 | `22d71bd428f6d6bee71ea7140bc5e65650c9c547` | EVIDENCE, P07_UI, QA | feat(p07-e): complete V3 visual refinement for transfer, workflows, admin, and notifications |
| 62 | `a09f991124c6a15ee2267c42012e866c38c5d614` | EVIDENCE, P07_UI, QA | merge(p07-r4c): integrate P07-E delta over the shared R4-B ancestor |
| 63 | `7a4e4c8b1ef2042d22f97498cae9390b04ec79a1` | QA | test(p07-r4c): freeze background cleanup contract and exact R4-A replay |
| 64 | `ac59872f6ed2c459e9731d365641d1cd1f0f2870` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07-r4c): detach boot cleanup from frames and await reconnect policy in tools QA |
| 65 | `7cb99e5c6e54ff463a968aa6483aa377bbd81149` | QA | test(p07-r4c): check integrated E workspaces with actual controllers and permissions |
| 66 | `5bcb8ce1f793d21f3f8b74075b78be39517078c2` | BUILD_CI_TOOLING, EVIDENCE, QA | chore(p07-r4c): register runtime contracts and integration evidence |
| 67 | `2f1f38d9f27ab257757340599edf177781cc06cf` | QA | chore(p07-r4c): isolate integration Preview provenance and publisher output |
| 68 | `74d166a48f5101932d8b72cdbb2b54781ee5812e` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, BUILD_CI_TOOLING, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07-r4c): bridge deployed workers and allow observed future release assets |
| 69 | `5a89f078e6f6a81590a66be74e75296089fb74d4` | QA | test(p07-r4c): supply future navigation fixtures to worker tests |
| 70 | `cef7db9bc4ffd3e2641df4e190ba5938a1b4ff34` | EVIDENCE, QA | docs(p07-r4c): preserve warm-upgrade red and release bridge evidence |
| 71 | `c8ff0aa55b36e96561dd083bbaf032e4a24b6cd0` | QA | test(p07-r4c): inspect canonical release cache keys in application flow |
| 72 | `c566ca4779d1490c7b7f767023fb44b4813329ba` | EVIDENCE | docs(p07-r4c): separate runtime gates from Flash Preview environment handoff |
| 73 | `bf07d4007599f67f3ac23038115ec7e7f299c9a9` | EVIDENCE, QA | feat(p07-f): prepare performance, responsive, accessibility, and visual preflight gates |
| 74 | `470c57fd0ce7f761b3b06497706bca1483f2b5aa` | EVIDENCE, QA | merge(p07-r4c): import P07-F tooling delta after verifying P07-E ancestry |
| 75 | `175369e75d50312cb1049dc98a44ac53dadc04bd` | QA | test(p07-r4c): run F gates on the unified isolated runtime with truthful finding status |
| 76 | `ca203c95ca3f022a1f14c0a56b00d29292adbf0e` | QA | test(p07-r4c): load F audit probes in shared-runtime mode |
| 77 | `c13c5bc5b097785e5dc2af713eeae819c0dd57fe` | QA | test(p07-r4c): share canonical module instances with the application |
| 78 | `36cbf46325540aa7d2e5577ac26286e2e0fa92c9` | QA | test(p07-r4c): verify Flash's isolated Hosted snapshot through owned QA browser |
| 79 | `362bf4a1732b93fbdf2e44955cbd7ca4dd85fb4f` | QA | test(p07-r4c): use validated Pages metadata pagination without credential logging |
| 80 | `34844f58dd953f7f947ad934ecf5d63e7e5b6fe3` | EVIDENCE, QA | docs(p07-r4c): deliver independent gates and separate Hosted, CI and F findings |
| 81 | `5f83167d9b6a8433565775b372631c8764eb052e` | EVIDENCE, QA | docs(p07-r4c): make retained failure evidence available in a fresh checkout |
| 82 | `77ebe7e6242be9d158c4fb8678706461edc840f3` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, FINANCE_PRESENTATION, LEARNING_UI, P07_UI | integrate(p07-r5): apply reviewed product delta over exact R4-C base |
| 83 | `de4d027e3f45d5e1804c586a4965ab9726d69bca` | QA | test(p07-r5): freeze identity, TTL, Kill and retry browser boundaries |
| 84 | `3f4e3fad1084aeb5e3868d6966c6e8192c64d08f` | QA | test(p07-r5): observe policy application before background lease expiry |
| 85 | `40842d138087de15a8c17f1ec9b310dd137e6412` | QA | test(p07-r5): isolate response rules and require a new document per navigation |
| 86 | `7646cf8968a98749dae4265f54ade0e4bd905236` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07-r5): preserve policy authority and isolate responses by session owner |
| 87 | `89ad35fd6a8b6282fb99fc1f8881aabe7c96f2a4` | QA | test(p07-r5): exercise real background, first workflow frame and ledger restoration |
| 88 | `8630d7cc3e1150651e0abfb8a678746906ecefeb` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07-r5): revalidate BFCache identity before restoring private workspaces |
| 89 | `fde53c735108c27ac8b3efeda2050ced4adbe83f` | QA | test(p07-r5): retain rendering-frame BFCache evidence and semantic component readiness |
| 90 | `96e2975d432dd0402bd8b1e63379dd16e1b2854c` | QA | test(p07-r5): correct bounded geometry wait syntax |
| 91 | `6e983e6e774e566754ed19a6d65b1655fc73e640` | QA | test(p07-r5): require finite offline recovery for a real BFCache restore |
| 92 | `a3529996fc8f4a198f8626b97ffe18196ba40ce2` | QA | test(p07-r5): keep fixture sessions current after genuine UI logout |
| 93 | `7a078017ba56d60196acd0ddee0dfe10b8667ac7` | BUILD_CI_TOOLING, QA | test(p07-r5): verify visible ledger geometry and include owner guards in Core CI |
| 94 | `5eac9d880b547dd6ebea7f6f054651e0fe5e29b7` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07-r5): keep long workflow libraries reachable at all viewport sizes |
| 95 | `635e915cb2a37c104911a84b4cc72f5e2b9f3d13` | QA | test(p07-r5): assert the first rendered direct workflow document |
| 96 | `abb79a75d83a2cba9d5036fa6e098e2dd0cb2bcf` | QA | test(p07-r5): share one isolated runtime for E, PWA and F verification |
| 97 | `de25585efb86fae4a7198de94650306d7593a689` | QA | test(p07-r5): freeze combined runtime gates and diagnose offline review without weakening assertions |
| 98 | `9387340df75b8703a2fed39a7458fc2ddf8acbf7` | EVIDENCE | docs(p07-r5): preserve independent red-green evidence and exact-SHA deployment handoff |
| 99 | `6ce937bdfa6e3eac6462dfc264170f762d83f89e` | QA | test(p07-r5): capture actual compact admin overflow without relaxing geometry |
| 100 | `1c20797f8ff41c53b786c8dc8efb5fc5ad3cb0af` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07-r5): contain the admin tab indicator inside its compact scrollport |
| 101 | `72940bede5cff2aacd3bc3c66af5b16be40b243e` | EVIDENCE | docs(p07-r5): record compact admin red-green and retain unresolved quality gates |
| 102 | `303935eab4bfbe376478ad3280acfa0bb2fd99d3` | EVIDENCE, QA | test(p07-f): preserve eight findings and extend full-document axe and usability checks |
| 103 | `69bb12404758e4af32d4d6fc481d30ff7153bd8e` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07-f): correct landmarks, heading hierarchy, live roles and form names |
| 104 | `13fd8af9352978da3198e542f2840e691bcca95f` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07-f): preserve heading metrics and correct dark notice contrast |
| 105 | `3760e53712a9dafbbed2290a3da56addf151b506` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07-f): preserve visual heading metrics across enhanced and base modes |
| 106 | `27058a4dfdd58017e24898cb1fa74b0af8fd20d2` | QA | test(p07-f): bind complete R5 gates and retain performance attribution boundaries |
| 107 | `1f6f37c9b01621a9e33c504b7f9dd9660cedae2f` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07-f): expose observed named container groups with supported semantics |
| 108 | `0d0341f352db46a82e27c13997eb663624d37376` | QA | test(p07-f): verify the actual expanded account menu reference |
| 109 | `7e938bdbda734d319053f1e23fe4a96703486ae6` | EVIDENCE, QA | docs(p07-f): preserve rule counts, browser evidence and scoped acceptance boundaries |
| 110 | `7d115fb340fd9d336a39f548ae10b8ff8aa02be8` | BUILD_CI_TOOLING, EVIDENCE, QA | test(task25): capture concurrent D1 failures without weakening the original contract |
| 111 | `d67b7fe719579e7c28230ca6f6303df7762d1109` | EVIDENCE | docs(task25): redact CI workspace paths and retain remaining gate failures |
| 112 | `91f0d466361ee80fbd6475facea0b9620f950661` | QA | test(task25): keep the original pre-cohort I/O schedule unchanged |
| 113 | `c19f2907f43eb636891cfadc3c9716e9573c8ef8` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, LEARNING_UI, P07_UI, QA | fix(p07): eliminate visual blank/policy flickers on startup, login and tab recovery |
| 114 | `80b54be6eebce13d3205a281823118d68e4afbde` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, EVIDENCE, LEARNING_UI, P07_UI, QA | merge(p07): integrate Flash transition delta over fixed Task25 diagnostic base |
| 115 | `e5a5d4bd64b71e06658d1c84517a6676217ed4e4` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, BUILD_CI_TOOLING, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(p07): gate presentation on verified identity and decided policy |
| 116 | `1c10584652ad43b5052520b448c6baf8b421e00b` | BUILD_CI_TOOLING, QA | test(p07): isolate failed captures and verify hidden lease boundaries |
| 117 | `08912e4f5e92f6e02d41e78e95ba58eb08207c39` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, LEARNING_UI, P07_UI, QA | fix(auth): discard login response after external identity change |
| 118 | `d992b4dfd69866eae7e89befa78e4ba6b28df943` | QA | test(p07): enforce verified navigation and cold hidden recovery contracts |
| 119 | `a8a67afc45f3ddefa2ac7748c2ec1620e1dfd5da` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(a11y): prevent inherited shell opacity on first revealed frame |
| 120 | `aef7902bea49d5b507cdab704c02e7110296462b` | QA | test(p07): compose final runtime and continuous-frame gates |
| 121 | `6b8116267458a6fb57ded0a6db8f20f21e4bab0a` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(a11y): keep login text opaque and preserve protected assets |
| 122 | `25406b3414b227bc277f6436286c77fed10b48a4` | EVIDENCE, QA | docs(p07): freeze integration evidence and same-SHA deployment handoff |
| 123 | `811edf17cc4588996778f754ac8f344efdcca0db` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(startup): preserve asynchronous workspace mounts across recovery deadline |
| 124 | `bb6fe72faeb1df28075b39db71539dfd274a92dc` | EVIDENCE, QA | docs(p07): retain first freeze failures and targeted recovery regression evidence |
| 125 | `15e310ed5ff87ff4e643a2d85032578d711e9258` | ACCOUNT_MEMBERSHIP_ADMIN_UI, BOOT_AUTH_POLICY, FINANCE_PRESENTATION, LEARNING_UI, MODULE_PRESENTATION_OR_VERSION, P07_UI, QA, SW_ASSET_RELEASE, TRANSFER_PRESENTATION | fix(startup): retain recovery across late mounting and bind completion to identity |
| 126 | `deaa3b6261db59e4d0df9300fa675ed6c64f9ae3` | BUILD_CI_TOOLING, EVIDENCE, QA | test(p07): preserve offline outbox contract and record both deadline order regressions |
| 127 | `79faf5334d6160ed4fba172d717df9b33da156b6` | EVIDENCE, QA | test(transfer): measure visible mounted workspaces and retain strict scroll guards |
| 128 | `22f83b783c53058edd6beac0273ebdfdfefbc782` | QA | test(transfer): wait for real initial data before measuring scroll limits |
| 129 | `482580b0855e14a61b3f6b51e9d91ae7855296cb` | EVIDENCE, QA | docs(qa): retain transfer hydration race evidence and strict loaded-layout contract |

## 全部净变更文件

| 路径 | 分类 | 仅资源版本变化 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | BUILD_CI_TOOLING | NO |
| `app.js` | P07_UI, BOOT_AUTH_POLICY, ACCOUNT_MEMBERSHIP_ADMIN_UI, LEARNING_UI | NO |
| `design-system.css` | P07_UI | NO |
| `docs/p07/P07_D_BUSINESS_WORKSPACES_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_FINAL_FLASH_HANDOFF.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_FINAL_INTEGRATION_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_F_A11Y_CLOSEOUT_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_F_A11Y_FLASH_HANDOFF.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_F_PREFLIGHT_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_IMPLEMENTATION_READINESS.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_PHASE1_ARGON_IMPLEMENTATION_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_PHASE1_V3_VISUAL_DIFF_AND_PLAN.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_PHASE1_VISUAL_REWORK_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_R4A_RUNTIME_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_R4B_WORKSPACES_DELIVERY_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_R4C_FLASH_HANDOFF.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_R4C_INTEGRATION_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_R5_FLASH_HANDOFF.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_R5_INDEPENDENT_INTEGRATION_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_ROUND3_CI_RED_FIX_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_ROUND3_STRUCTURAL_FIX_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_SPLASH_TRANSITION_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_TASK25_D1_CONCURRENCY_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/P07_VISUAL_AND_FUNCTIONAL_REWORK_REPORT.md` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/BASELINE-72940be.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/BASELINE-GEOMETRY.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/BASELINE-full-axe.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/F-Account-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/F-Account-375-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/F-Login-375-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/F-Membership-375-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/F-Workflows-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/GREEN-extended-cases.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/GREEN-fixed-tool.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/INTERMEDIATE-FAILURES-v1.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/INTERMEDIATE-MENU-REVIEW.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/LAB-preflight-raw.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/PROTECTION.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/RULE-COMPARISON.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/workflow-file-input-keyboard-focus.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/f-a11y/workflow-import-executed.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/EVIDENCE-MANIFEST.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/FINANCE-OFFLINE-FIXTURE-GREEN.txt` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/FINANCE-OFFLINE-FIXTURE-RED.txt` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-F-EXTENDED-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-FINANCE-MOUNT-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-FIXED-F-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-FULL-AXE-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-LOGIN-FIRST-FRAME.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-ORIGINAL-FEEDBACK-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-R5-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-RC5-TRANSITIONS-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-RECOVERY-AXE-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-RUNTIME-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-TRANSFER-DATA-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-TRANSITIONS-EARLIER-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-last-screencast-before-home.jpg` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/GREEN-recovery.jpg` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/INTEGRATION-INPUTS.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/INTERMEDIATE-LOGIN-OPACITY.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/INTERMEDIATE-R5-FAILURE.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/INTERMEDIATE-RUNTIME-FAILURE.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/LAB-PRECHECK.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR132-FIXED-LOGIN-RED.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR132-LOGIN-FIRST-FRAME.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR133-BROWSER-RED.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR133-CI-RED.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR133-SLOW-IDENTITY-DOM.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR133-SLOW-LOGIN-DOM.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR133-SLOW-PUBLIC-DOM.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-254-FINANCE-DOM-RED.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-254-FINANCE-RECOVERY-RED.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-254-LAB-PARTIAL.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-254-SUITES.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-254-TRANSITIONS.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-79-CI-RED.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-79-CI-TRANSFER-SNAPSHOT.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-BB-CI-RED.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-BB-COMBINED-DELAY-DOM.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-BB-COMBINED-DELAY-RED.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-BB-LAB-VALID.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-BB-SUITES.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-DEAA-CI-RED.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-DEAA-LAB-VALID.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-DEAA-SUITES.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-DEAA-TRANSITIONS.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-FINANCE-MOUNT-RED.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PR135-FIRST-CI-RED.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/PROTECTION.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/RED-blank.jpg` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/TRANSFER-DIAGNOSTIC-ENV-FAIL.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-cwv-home-initial.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-preflight-report.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-reduced-motion-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-theme-dark-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-theme-light-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-viewport-1024.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-viewport-1366.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-viewport-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-viewport-1920.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-viewport-768.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-workspace-account.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-workspace-admin.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-workspace-finance.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-workspace-language-picker.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-workspace-language-quiz.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-workspace-login.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-workspace-membership.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-workspace-tools.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/final-integration/flash133/p07-f/p07-f-workspace-transfer.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/flicker-investigation/after-flicker-investigation.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/flicker-investigation/baseline-flicker-investigation.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-03-personal-space-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-03-personal-space-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-03-personal-space-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-04-language-picker-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-04-quiz-immersive-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-04-quiz-immersive-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-04-quiz-immersive-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-05-achievements-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-05-study-stats-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-05-wrong-questions-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-05-wrong-questions-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-06-finance-ledger-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-06-finance-ledger-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-06-finance-ledger-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-06-membership-workspace-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-06-membership-workspace-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-06-membership-workspace-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-07-account-workspace-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-07-account-workspace-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-07-account-workspace-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-07-candidates-verification-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-07-candidates-verification-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-07-candidates-verification-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-08-tool-workbench-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-08-tool-workbench-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-08-tool-workbench-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-08-toolbox-dashboard-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-08-toolbox-dashboard-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/p07-08-toolbox-dashboard-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/preview/preview-deployment-proof.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/preview/preview-live-home-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/preview/preview-live-home-390.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/preview/preview-live-language-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/preview/preview-live-tools-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/viewport-finance-1024.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/viewport-finance-1920.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/viewport-finance-375.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/viewport-finance-412.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/viewport-finance-768.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-d/workspaces-audit.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-01-transfer-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-01-transfer-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-01-transfer-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-02-workflows-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-02-workflows-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-02-workflows-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-03-admin-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-03-admin-flags-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-03-admin-flags-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-03-admin-users-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-04-candidates-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-04-candidates-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-04-candidates-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-viewport-transfer-1024.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-viewport-transfer-1920.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-viewport-transfer-375.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/p07-e-viewport-transfer-768.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-e/workspaces-p07-e-audit.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-cwv-home-initial.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-preflight-report.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-reduced-motion-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-theme-dark-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-theme-light-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-viewport-1024.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-viewport-1366.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-viewport-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-viewport-1920.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-viewport-375.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-viewport-390.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-viewport-768.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-workspace-account.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-workspace-admin.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-workspace-finance.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-workspace-language-picker.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-workspace-language-quiz.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-workspace-login.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-workspace-membership.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-workspace-tools.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-f/p07-f-workspace-transfer.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/admin-compact-geometry.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/browser-results.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/finance-real-ledger.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-accountModal-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-accountModal-1920.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-accountModal-375.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-financePage-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-financePage-1920.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-financePage-375.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-membershipModal-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-membershipModal-1920.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-membershipModal-375.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-toolsPanel-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-toolsPanel-1920.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/layout-toolsPanel-375.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/offline-wrong-fixture.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/policy-results.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/p07-r5/workflow-fixture.txt` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after-home-widgets.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-1024-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-1366-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-1920-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-375-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-420-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-768-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-authenticated-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-custom-layout-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-desktop-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-desktop-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-dragging-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-flag-off-fallback-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-mobile-390-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-mobile-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-home-reduced-motion-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-login-375-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-login-768-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-login-desktop-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-login-desktop-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-login-mobile-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/after/after-register-desktop-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/baseline/baseline-summary.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/baseline/before-home-desktop-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/baseline/before-home-desktop-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/baseline/before-home-mobile-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/baseline/before-home-widgets.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/baseline/before-login-desktop-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/baseline/before-login-desktop-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/baseline/before-login-mobile-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/browser-zoom-400.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/pages-build-audit.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/preview/preview-deployment-proof.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/preview/preview-live-home-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/preview/preview-live-home-390.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/preview/preview-live-login-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-argon/verification-summary.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after-home-widgets.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-error-login-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-error-session-recovery-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-1024-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-1366-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-1920-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-375-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-420-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-768-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-authenticated-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-custom-layout-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-desktop-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-desktop-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-dragging-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-editing-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-flag-off-fallback-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-mobile-390-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-mobile-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-mobile-412-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-home-reduced-motion-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-loading-session-recovery-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-loading-splash-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-login-375-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-login-768-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-login-desktop-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-login-desktop-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-login-mobile-390-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-login-mobile-412-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/after/after-register-desktop-1440-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/browser-zoom-400.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/independent-browser-gaps.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/keyboard-overlap-finance.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/keyboard-overlap-learning.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/keyboard-overlap-tools.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/keyboard-overlap.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/preview/preview-deployment-proof.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/preview/preview-live-home-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/preview/preview-live-home-390.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/preview/preview-live-login-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/real-account-a-desktop.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/real-account-b-desktop.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/real-touch-mobile-restored.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/phase1-rework/verification-summary.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/FAIL-refresh-continuity-all-required-pages.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/account-main-workspace.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/brand-preservation.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/browser-comparison.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/browser-facts.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/cache-upgrade-red.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/cache-upgrade.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/ci-evidence.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/driver-provenance.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/evidence-label-guard.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/evidence-manifest.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/finance-membership-exclusive.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/flag-off.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/intermediate-admin-failure.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/intermediate-admin-not-visible.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/kill-switch.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/offline-upgraded-shell.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/p4-workspace-behavior.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/p5-pwa.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/preview/preview-deployment-proof.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/preview/preview-live-home-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/preview/preview-live-home-390.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/preview/preview-live-language-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/preview/preview-live-tools-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/primary-workspaces.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/release-equivalence.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/reload-diagnostics.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/runtime-results.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/tested-source-manifest.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/unresolved-browser-gates.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/upgrade-safety.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4a/verification-history.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/E-admin-1440-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/E-candidates-390-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/E-transfer-375-light.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/E-workflow-390-dark.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/G01-after.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/G01-before.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/G02-policy-pending.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/G02-policy-settled.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/acceptance-boundaries.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/account-main.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/baseline-red.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/brand-preservation.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/ci-history.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/driver-provenance.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/e-workspaces.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/evidence-manifest.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/f-quality-boundaries.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/f-unified-preflight.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/frozen-browser.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/hosted-joint-c8.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/joint-account.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/joint-guest-home.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/joint-recharge.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/kill-policy.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/membership-exclusive.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/module-identity-regression.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/off-policy.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/offline-upgraded-shell.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/p4-results.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/primary-workspaces.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/pwa-contract.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/release-equivalence.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/runtime-green.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/runtime-results.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/tested-source-manifest.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/upgrade-safety.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/verification-history.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/warm-upgrade-original-failure.txt` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r4c/independent/warm-upgrade.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/brand-preservation.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/f-review-before-attribution.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/f-review-with-lcp-attribution.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/admin-compact.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/admin-compact.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/browser-rc3.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/finance-real-ledger.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/layout-accountModal-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/layout-accountModal-375.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/layout-financePage-375.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/layout-membershipModal-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/layout-membershipModal-375.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/layout-toolsPanel-1440.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/runtime-938-browser.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/green/runtime-938-suites.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/hosted-readonly.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/import-manifest.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/red/admin-overflow.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/red/admin-overflow.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/red/bfcache-frames.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/red/diagnostic-browser-v5.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/red/policy-results.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/red/warm-upgrade.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/red/workflow-long-library.png` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/r5-independent/scope-manifest.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/task25-d1/LOCAL-COUNTS-AND-AUDIT.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/task25-d1/LOCAL-OBSERVATIONS.json` | EVIDENCE | EVIDENCE |
| `docs/p07/evidence/task25-d1/ORIGINAL-CI-FAILURE.json` | EVIDENCE | EVIDENCE |
| `functions/_lib/p07-ui-api.mjs` | BOOT_AUTH_POLICY, FUNCTIONS_API | NO |
| `functions/_lib/task11-service.mjs` | ADMIN_AUDIT_READ, FUNCTIONS_API | NO |
| `functions/_lib/task12-api.mjs` | ADMIN_AUDIT_READ, FUNCTIONS_API | NO |
| `functions/api/[[path]].js` | FUNCTIONS_API | NO |
| `index.html` | P07_UI | NO |
| `js/core/api.js` | BOOT_AUTH_POLICY | NO |
| `js/core/changelog.js` | SW_ASSET_RELEASE | YES |
| `js/core/config.js` | SW_ASSET_RELEASE | YES |
| `js/core/dashboard.js` | P07_UI | NO |
| `js/core/design-system.js` | P07_UI | NO |
| `js/core/feature-flags.js` | BOOT_AUTH_POLICY | NO |
| `js/core/home-widgets.js` | P07_UI | NO |
| `js/core/keyed-list.js` | MODULE_PRESENTATION_OR_VERSION | YES |
| `js/core/motion.js` | P07_UI | NO |
| `js/core/public-experience.js` | P07_UI | NO |
| `js/core/public-ui-policy.js` | BOOT_AUTH_POLICY | NO |
| `js/core/router.js` | BOOT_AUTH_POLICY | NO |
| `js/core/session.js` | BOOT_AUTH_POLICY | YES |
| `js/core/startup.js` | BOOT_AUTH_POLICY | NO |
| `js/core/ui.js` | MODULE_PRESENTATION_OR_VERSION | YES |
| `js/finance/app.js` | FINANCE_PRESENTATION | NO |
| `js/finance/candidates.js` | FINANCE_PRESENTATION | YES |
| `js/language/achievements.js` | LEARNING_UI | YES |
| `js/language/history.js` | LEARNING_UI | YES |
| `js/language/mastery-journal.js` | LEARNING_UI | YES |
| `js/language/mastery.js` | LEARNING_UI | YES |
| `js/language/sync-adapter.js` | LEARNING_UI | YES |
| `js/language/wrong-book.js` | LEARNING_UI | YES |
| `js/tools/digest-worker.js` | P07_UI | YES |
| `js/tools/file.js` | P07_UI | YES |
| `js/tools/image.js` | P07_UI | YES |
| `js/tools/text.js` | P07_UI | YES |
| `js/transfer/app.js` | TRANSFER_PRESENTATION | YES |
| `local-backend/test_app_browser.mjs` | QA | NO |
| `local-backend/test_static.py` | QA | NO |
| `local-backend/test_task12_d1_js.mjs` | QA | NO |
| `local-backend/test_task15_cloud_browser.mjs` | QA | NO |
| `local-backend/test_tools_browser.mjs` | QA | NO |
| `local-backend/test_transfer_responsive.mjs` | QA | NO |
| `product-ui.css` | P07_UI | NO |
| `public-experience.css` | P07_UI | NO |
| `qa/aeris-release/ci-pages-build.mjs` | QA | NO |
| `qa/aeris/home-widgets-browser.mjs` | QA | NO |
| `qa/aeris/p5-hash-browser.mjs` | QA | NO |
| `qa/aeris/p5-pwa-browser.mjs` | QA | NO |
| `qa/aeris/p6-parked-rows-browser.mjs` | QA | NO |
| `qa/p07-d/deploy-and-verify-preview.mjs` | QA | NO |
| `qa/p07-d/verify-p07-d-workspaces.mjs` | QA | NO |
| `qa/p07-e/verify-p07-e-workspaces.mjs` | QA | NO |
| `qa/p07-f/a11y-closeout.mjs` | QA | NO |
| `qa/p07-f/preflight-probe.js` | QA | NO |
| `qa/p07-f/vendor/axe.min.js` | QA | NO |
| `qa/p07-f/verify-p07-f-preflight.mjs` | QA | NO |
| `qa/p07-f/workspace-lab.mjs` | QA | NO |
| `qa/p07-final/README.md` | QA | NO |
| `qa/p07-final/background-policy.test.mjs` | QA | NO |
| `qa/p07-final/finance-offline-fixture.test.mjs` | QA | NO |
| `qa/p07-final/protection.mjs` | QA | NO |
| `qa/p07-final/startup.test.mjs` | QA | NO |
| `qa/p07-final/transitions.mjs` | QA | NO |
| `qa/p07-phase1/deploy-and-verify-preview.mjs` | QA | NO |
| `qa/p07-phase1/independent-browser-gaps.mjs` | QA | NO |
| `qa/p07-phase1/phase1-browser-verify.mjs` | QA | NO |
| `qa/p07-phase1/public-ui-policy.test.mjs` | QA | NO |
| `qa/p07-phase1/run-phase1-qa.mjs` | QA | NO |
| `qa/p07-r4a/brand-guard.mjs` | QA | NO |
| `qa/p07-r4a/collect-evidence.mjs` | QA | NO |
| `qa/p07-r4a/deploy-preview.mjs` | QA | NO |
| `qa/p07-r4a/policy-state.test.mjs` | QA | NO |
| `qa/p07-r4a/reload-diagnostics.mjs` | QA | NO |
| `qa/p07-r4a/run-gates.mjs` | QA | NO |
| `qa/p07-r4a/runtime-browser.mjs` | QA | NO |
| `qa/p07-r4a/upgrade-safety.mjs` | QA | NO |
| `qa/p07-r4c/collect-evidence.mjs` | QA | NO |
| `qa/p07-r4c/e-workspaces.mjs` | QA | NO |
| `qa/p07-r4c/runtime-probe.mjs` | QA | NO |
| `qa/p07-r4c/startup.test.mjs` | QA | NO |
| `qa/p07-r4c/sw-release.test.mjs` | QA | NO |
| `qa/p07-r4c/verify-hosted.mjs` | QA | NO |
| `qa/p07-r5/flicker-investigation.mjs` | QA | NO |
| `qa/p07-r5/harness.mjs` | QA | NO |
| `qa/p07-r5/independent-browser.mjs` | QA | NO |
| `qa/p07-r5/independent-policy.mjs` | QA | NO |
| `qa/p07-r5/run-r5-suites.mjs` | QA | NO |
| `qa/p07-r5/session-response.test.mjs` | QA | NO |
| `qa/task25/diagnostic-loader.mjs` | QA | NO |
| `qa/task25/diagnostic-register.mjs` | QA | NO |
| `qa/task25/diagnostic-rpc.mjs` | QA | NO |
| `qa/task25/diagnostic-trace.mjs` | QA | NO |
| `scripts/stage_pages_deploy.mjs` | BUILD_CI_TOOLING | NO |
| `scripts/update_asset_release.mjs` | SW_ASSET_RELEASE, BUILD_CI_TOOLING | NO |
| `spatial-experience.css` | P07_UI | NO |
| `styles.css` | P07_UI | NO |
| `sw.js` | SW_ASSET_RELEASE | NO |
| `tools.js` | P07_UI | YES |
| `workspace-experience.css` | P07_UI | NO |

## D1 迁移逐文件校验

| 迁移 | SHA-256（两端相同） | 相同 |
| --- | --- | --- |
| `cloudflare/migrations/0001_foundation.sql` | `e299d915e566579a7243e879f1d42bcb0e9c5d631d839551c17de45ac311818a` | True |
| `cloudflare/migrations/0002_low_risk_cloud_services.sql` | `eba58130c2c3b143e8c1c0a16000437176ca4ff17653febf583885ddc29fbb00` | True |
| `cloudflare/migrations/0003_accounts_sessions.sql` | `22b6848babdfd34c357f4fa4f41fe6f8f460774d4d99189c2a0367c2b3f23fe1` | True |
| `cloudflare/migrations/0004_session_limit_trigger.sql` | `b7d728c04f85ebcb7d642da2c053bf3f26de4a741ec7246cf89097a09e583920` | True |
| `cloudflare/migrations/0005_session_limit_ordering.sql` | `458714e9746745d07cf32a45f0fd31b4e5ab859bcfa39a9fe4f46b176ae2a72a` | True |
| `cloudflare/migrations/0006_memberships_payments.sql` | `a0b70ad186fe6c279ccd5dbded1c1ca88fdfb37cd97f71bc1c850090be035def` | True |
| `cloudflare/migrations/0007_temporary_sharing.sql` | `aad623ebe0b92b204db1ffed6689ed373df25e45188be3c1e1befcec29348e08` | True |
| `cloudflare/migrations/0008_task14_user_storage_trigger.sql` | `ecad1754406d347c87ea76412077c093b5d1d7284fca4f7b824aab83f5a517d4` | True |
| `cloudflare/migrations/0009_task14_global_storage_trigger.sql` | `be277047c5ff5a4a70d0c04ea72044e2da400fd7b10ce16d41b30de6cba34584` | True |
| `cloudflare/migrations/0010_task15_cloud_only.sql` | `da2b835b53a3d8905aa197a9dc674d9c546b02f762c8d144c838fe76d39aacb0` | True |
| `cloudflare/migrations/0011_task15_import_trigger_order.sql` | `08f15281e289af2aef4d0288353bafd3accad8ed05df6d7dab86b7170043d2cd` | True |
| `cloudflare/migrations/0012_finance_core.sql` | `1cb7a9a3abd5d269509f1d3e92fa5ae86420a1f0697a240dac146fd2ce33c917` | True |
| `cloudflare/migrations/0013_finance_web_membership.sql` | `587ed0d30e53cdc0c585b7ccb1401f61db43571df0ff6709b79460f8dbeae2dc` | True |
| `cloudflare/migrations/0014_admin_roles_messages.sql` | `e939d296418a71094ea23b675f04df60d0c6090e249c195b694e61d8bca36ee5` | True |
| `cloudflare/migrations/0015_android_device_sessions.sql` | `83ab3aaf768b8109eac41962e17cff2c6bf14271e56faff8bbef79f7cf045dfc` | True |
| `cloudflare/migrations/0016_notification_archive_payment.sql` | `ad8cf753a2b78dfbc7ba92c314f3fd251862feccdf3973cce715232068e8248a` | True |
| `cloudflare/migrations/0017_notification_archive.sql` | `0c66d247243d8fa1c4ce9f3e8fdb63e56de6f68c8742ed8756d14f878761678b` | True |
| `cloudflare/migrations/0018_file_transfer_2.sql` | `a550b4bf2cae1d524ed30beb7ecd6deb7ff8408228f3512e8d971983ad6bc991` | True |
| `cloudflare/migrations/0019_transfer_single_object.sql` | `029d3ef2a49adf18cf77e409ab7ded2a8981f85850cfd42f48910fd07111bf47` | True |
| `cloudflare/migrations/0020_notification_event_identity.sql` | `c2a04c1f9056fd0ab18b6b5182aebd829deb9fd076d4e308e32113db2c248ac8` | True |
| `cloudflare/migrations/0021_notification_pending_hints.sql` | `d544606763a7ccb5879cea510432d55a185a932c3589595f6673e9567b0bc45d` | True |
| `cloudflare/migrations/0022_notification_review_aliases.sql` | `d18b7b756450cf8830531f3f57b12c9ebae84ee0b0edc6b28e2ce471663afe1c` | True |
| `cloudflare/migrations/0023_transfer_session_cleanup.sql` | `ac4100262dd58545e5372283481be97d9f3815e8586ceace924075ac0adfa0a7` | True |
| `cloudflare/migrations/0024_feature_flags_release_channels.sql` | `67712cbe6da1f35fdd59d2b4806c164869e06d840b1ae652a3e8f6f082018173` | True |
| `cloudflare/migrations/0025_adaptive_learning_mastery.sql` | `4664bbc91a8d1b6158ee58532186b38c870cb677c17c289e072e1cb4afd4adef` | True |
