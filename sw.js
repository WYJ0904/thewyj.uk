const CACHE = "wyj-shell-20261128-aeris-p7-account-v4-es-modules";
const RELEASE = "20261128-aeris-p7-account-v4";
const OWNED_PREFIX = "wyj-shell-";
const observedShellReleases = new Set();
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
// Do not spend every resource's deadline waiting in the browser connection queue.
const INSTALL_CONCURRENCY = 6;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?release=20261128-aeris-p7-account-v4",
  "/product-ui.css?release=20261128-aeris-p7-account-v4",
  "/design-system.css?release=20261128-aeris-p7-account-v4",
  "/public-experience.css?release=20261128-aeris-p7-account-v4",
  "/workspace-experience.css?release=20261128-aeris-p7-account-v4",
  "/spatial-experience.css?release=20261128-aeris-p7-account-v4",
  "/changelog.js?release=20261128-aeris-p7-account-v4",
  "/learning-sync.js?release=20261128-aeris-p7-account-v4",
  "/app.js?release=20261128-aeris-p7-account-v4",
  "/js/core/api.js?release=20261128-aeris-p7-account-v4",
  "/js/core/changelog.js?release=20261128-aeris-p7-account-v4",
  "/js/core/capabilities.js?release=20261128-aeris-p7-account-v4",
  "/js/core/config.js?release=20261128-aeris-p7-account-v4",
  "/js/core/router.js?release=20261128-aeris-p7-account-v4",
  "/js/core/session.js?release=20261128-aeris-p7-account-v4",
  "/js/core/storage.js?release=20261128-aeris-p7-account-v4",
  "/js/core/ui.js?release=20261128-aeris-p7-account-v4",
  "/js/core/design-system.js?release=20261128-aeris-p7-account-v4",
  "/js/core/public-ui-policy.js?release=20261128-aeris-p7-account-v4",
  "/js/core/download.js?release=20261128-aeris-p7-account-v4",
  "/js/core/perf.js?release=20261128-aeris-p7-account-v4",
  "/js/core/motion.js?release=20261128-aeris-p7-account-v4",
  "/js/core/keyed-list.js?release=20261128-aeris-p7-account-v4",
  "/js/core/public-experience.js?release=20261128-aeris-p7-account-v4",
  "/favicon.ico?release=20261128-aeris-p7-account-v4",
  "/assets/brand/favicon-32.png?release=20261128-aeris-p7-account-v4",
  "/assets/brand/apple-touch-icon.png?release=20261128-aeris-p7-account-v4",
  "/assets/brand/aeris-maskable-512.png?release=20261128-aeris-p7-account-v4",
  "/assets/brand/aeris-lockup.png?release=20261128-aeris-p7-account-v4",
  "/icon-192.png?release=20261128-aeris-p7-account-v4",
  "/icon-512.png?release=20261128-aeris-p7-account-v4",
  "/js/finance/app.js?release=20261128-aeris-p7-account-v4",
  "/js/finance/candidates.js?release=20261128-aeris-p7-account-v4",
  "/js/finance/disclosure.js?release=20261128-aeris-p7-account-v4",
  "/js/finance/notification-ledger.js?release=20261128-aeris-p7-account-v4",
  "/js/transfer/app.js?release=20261128-aeris-p7-account-v4",
  "/js/transfer/updates.js?release=20261128-aeris-p7-account-v4",
  "/js/language/achievements.js?release=20261128-aeris-p7-account-v4",
  "/js/language/history.js?release=20261128-aeris-p7-account-v4",
  "/js/language/pdf.js?release=20261128-aeris-p7-account-v4",
  "/js/language/mastery.js?release=20261128-aeris-p7-account-v4",
  "/js/language/mastery-state.js?release=20261128-aeris-p7-account-v4",
  "/js/language/mastery-journal.js?release=20261128-aeris-p7-account-v4",
  "/js/language/quiz.js?release=20261128-aeris-p7-account-v4",
  "/js/language/speech.js?release=20261128-aeris-p7-account-v4",
  "/js/language/speech-rate.js?release=20261128-aeris-p7-account-v4",
  "/js/language/sync-adapter.js?release=20261128-aeris-p7-account-v4",
  "/js/language/wrong-book.js?release=20261128-aeris-p7-account-v4",
  "/js/membership/account.js?release=20261128-aeris-p7-account-v4",
  "/js/membership/plans.js?release=20261128-aeris-p7-account-v4",
  "/js/membership/recharge.js?release=20261128-aeris-p7-account-v4",
  "/js/admin/formatters.js?release=20261128-aeris-p7-account-v4",
  "/tools.js?release=20261128-aeris-p7-account-v4",
  "/js/tools/catalog.js?release=20261128-aeris-p7-account-v4",
  "/js/tools/file.js?release=20261128-aeris-p7-account-v4",
  "/js/tools/image.js?release=20261128-aeris-p7-account-v4",
  "/js/tools/random.js?release=20261128-aeris-p7-account-v4",
  "/js/tools/runner.js?release=20261128-aeris-p7-account-v4",
  "/js/tools/temporary.js?release=20261128-aeris-p7-account-v4",
  "/js/tools/text.js?release=20261128-aeris-p7-account-v4",
  "/workflows.js?release=20261128-aeris-p7-account-v4",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?release=20261128-aeris-p7-account-v4",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?release=20261128-aeris-p7-account-v4", "/js/core/feature-console.js?release=20261128-aeris-p7-account-v4");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?release=20261128-aeris-p7-account-v4");
CORE_SHELL.push("/js/core/home-widget-layout.js?release=20261128-aeris-p7-account-v4");
CORE_SHELL.push("/js/core/home-widgets.js?release=20261128-aeris-p7-account-v4", "/js/core/home-widget-data.js?release=20261128-aeris-p7-account-v4");
CORE_SHELL.push("/js/transfer/upload-part.js?release=20261128-aeris-p7-account-v4");
CORE_SHELL.push("/js/core/lazy-controller.js?release=20261128-aeris-p7-account-v4", "/js/core/parked-rows.js?release=20261128-aeris-p7-account-v4", "/js/core/dashboard.js?release=20261128-aeris-p7-account-v4", "/js/finance/format.js?release=20261128-aeris-p7-account-v4", "/js/tools/digest-worker.js?release=20261128-aeris-p7-account-v4");

// Keep the independently fingerprinted 81-resource RC5 shell intact. Task26
// extends its required graph; these imports are never best-effort artwork.
const TASK26_SHELL = [
  "/js/language/wrong-review.js?release=20261128-aeris-p7-account-v4",
  "/js/language/wrong-review-sync.js?release=20261128-aeris-p7-account-v4",
];
// Finance formatting statically imports money.js. A fresh installation must
// include it before publishing HTML, while retaining the original RC5 layer.
const FINANCE_SHELL = ["/js/finance/money.js?release=20261128-aeris-p7-account-v4"];
const TASK27_SHELL = ["/js/account/security-center.js?release=20261128-aeris-p7-account-v4", "/js/account/policy-page.js?release=20261128-aeris-p7-account-v4", "/js/account/policy-version.js?release=20261128-aeris-p7-account-v4", "/js/account/password-policy.js?release=20261128-aeris-p7-account-v4", "/js/account/password-fields.js?release=20261128-aeris-p7-account-v4"];
const REQUIRED_SHELL = [...CORE_SHELL, ...TASK26_SHELL, ...FINANCE_SHELL, ...TASK27_SHELL];
const INSTALL_SHELL = REQUIRED_SHELL;
// Canonical UTF-8 hashes bind the current S0 shell plus Task27 additions.
const TASK26_INTEGRITY = Object.freeze({
  "/": "fa9fa44bb7d6f6ec48cd13a9f23845a9186ad0a0bd42ed6bb1d5adc266fa5e43",
  "/index.html": "fa9fa44bb7d6f6ec48cd13a9f23845a9186ad0a0bd42ed6bb1d5adc266fa5e43",
  "/styles.css?release=20261128-aeris-p7-account-v4": "2ff3d395eb27b4f61c1265008e234cea214d9747da637a42454ba7114d9f4910",
  "/product-ui.css?release=20261128-aeris-p7-account-v4": "bb0e2293c3efd9cae84dd2386a2ddd39fd156051110d9f9c1725f0f5df6dc34c",
  "/design-system.css?release=20261128-aeris-p7-account-v4": "f499bc7b7b670f4a46bacf27fec663b91c9495b8ef7fb5a40cc127baa75ca2a6",
  "/public-experience.css?release=20261128-aeris-p7-account-v4": "9875692c2c19f78a43a1fb0991430c3aeb1db90508c31d3a7e10ecbbd3b9002e",
  "/workspace-experience.css?release=20261128-aeris-p7-account-v4": "713896d0d192154aadeee6278fd7fd216dfb1e46a96a4c84c580044f09e422ae",
  "/spatial-experience.css?release=20261128-aeris-p7-account-v4": "947e779d4a164f23a0f14006566d5d81bcc8aeeed47bccd44d9044e6d6314b28",
  "/changelog.js?release=20261128-aeris-p7-account-v4": "e7dfbb4fc6c7c9fbdf2a677b6036bd895003a197d08908ee225aa40cce88eb4e",
  "/learning-sync.js?release=20261128-aeris-p7-account-v4": "74ced24b8dab7c8ad16dc6b4b68ff81a89e968d18a607bbba6b066a8bee7727d",
  "/app.js?release=20261128-aeris-p7-account-v4": "67423d011c04008861bd7b690eaf06ce96fa8d76f0688c159268ec5deb37b7dc",
  "/js/core/api.js?release=20261128-aeris-p7-account-v4": "0db0ef8e3cef0bf19cab97a0b5d1109e6212f29e2d132a14e877636cfe8e69b1",
  "/js/core/changelog.js?release=20261128-aeris-p7-account-v4": "91589a166f211ead5f5f7206b38004e3ea2db7ab6c8883d9e3ff363d6f998822",
  "/js/core/capabilities.js?release=20261128-aeris-p7-account-v4": "01a07b545f76a18aa05b1c98589b093f0c4a30597d4acd5a7efc5c9ec1ef2b56",
  "/js/core/config.js?release=20261128-aeris-p7-account-v4": "10dd1b034d29c911bf98fa25009e712899a7df22022c1111798893ec8d52927a",
  "/js/core/router.js?release=20261128-aeris-p7-account-v4": "959a88f6e8bf8dcf0f40880821ca5e2be2663bf321030bd765f7dc770cdef220",
  "/js/core/session.js?release=20261128-aeris-p7-account-v4": "cb1d8c9f42d4e84858844c82d21d7cbe668b34215768611883a5ae9da9c06962",
  "/js/core/storage.js?release=20261128-aeris-p7-account-v4": "6dc0175f5f17ad2dc4ff7cb73065b8840062b51f80ffaf32151df059e5cb1200",
  "/js/core/ui.js?release=20261128-aeris-p7-account-v4": "65d63a9d104a2b6ad57d839d1435ff074051372acb435a8023cded3a249233a5",
  "/js/core/design-system.js?release=20261128-aeris-p7-account-v4": "0c9ea4a5c218ed40fb19fc5fc717c4bc3885c12df6f5ed9cba4c9e433b9dbd5a",
  "/js/core/public-ui-policy.js?release=20261128-aeris-p7-account-v4": "0ba84e2ad06a282b2805d8eb5886c6fb2779439adb95a2a4d79ea4027898f823",
  "/js/core/download.js?release=20261128-aeris-p7-account-v4": "74f6e124985edae142f0d636f07e25711e74ad2bd738a449ec5f20f82882c0fe",
  "/js/core/perf.js?release=20261128-aeris-p7-account-v4": "add801f4828b3de5510cab3aa278b388ebbfe63ab940afeeb7de0954b4d58779",
  "/js/core/motion.js?release=20261128-aeris-p7-account-v4": "09d80045e9cfdf4813b923ae2dea532a37cf22cf323fea994f035ea05574267f",
  "/js/core/keyed-list.js?release=20261128-aeris-p7-account-v4": "a165a93f66dbcafa65b84cefea056dae7fbdf0ce373a41fcc0196928cdbf7454",
  "/js/core/public-experience.js?release=20261128-aeris-p7-account-v4": "be321670ce48a52fa454cedaf2dab86bf69df70503409b55fd854875d89515a6",
  "/js/finance/app.js?release=20261128-aeris-p7-account-v4": "14ed3243d09c8a415aa71783d06c76e3d069a759520cc71617a4fbd58b7b5b49",
  "/js/finance/candidates.js?release=20261128-aeris-p7-account-v4": "3ca2f7aa51b334cfc7373f23cf60a928a8373a159115bdad479cf48c7ee2b260",
  "/js/finance/disclosure.js?release=20261128-aeris-p7-account-v4": "b4032c25e57ec04b72d4d5141e5a857dd6e96e34e9cb5edc1526f3e5640a2c62",
  "/js/finance/notification-ledger.js?release=20261128-aeris-p7-account-v4": "9c25fec579c578af82b5d996679c5ee6f1ecf83902e5346e9963c995d22aacd5",
  "/js/transfer/app.js?release=20261128-aeris-p7-account-v4": "657ebaeec6de1096ea1c46b1a19fa4dbeaedfdecfc2cbfe177e958a8c97abc07",
  "/js/transfer/updates.js?release=20261128-aeris-p7-account-v4": "cc1dd699f5587366f72fa0e3dbc49d308685a3e44f69f5bd4f9a9bf8b863167a",
  "/js/language/achievements.js?release=20261128-aeris-p7-account-v4": "ad60d359640b2dcd6cd84acf27aba9a42220990c37d651a1af7452e19a9b9d69",
  "/js/language/history.js?release=20261128-aeris-p7-account-v4": "390293180eba23691e76a71d51ae8506c2dfa2fdb2165a62804732b2fe82c72f",
  "/js/language/pdf.js?release=20261128-aeris-p7-account-v4": "59662916aade5334b395563d903780e757d714c36bc6dd0a48a3bb24fb5a17eb",
  "/js/language/mastery.js?release=20261128-aeris-p7-account-v4": "7976f083caa6570a5d71100561e422cdf773313b631bda126ede4336f0facc3b",
  "/js/language/mastery-state.js?release=20261128-aeris-p7-account-v4": "94dc4e4c9253a9d0fa8aed57ec81b3029926dd8642eec7b3edbbc5808edca478",
  "/js/language/mastery-journal.js?release=20261128-aeris-p7-account-v4": "85154feebb66f95797eece1ca1a307e818358663c848d85814fc8b4676b871e5",
  "/js/language/quiz.js?release=20261128-aeris-p7-account-v4": "cd4546dc7e48876bac503c49e259267bde99b79ab0cf5565cb917c1ed031e3b0",
  "/js/language/speech.js?release=20261128-aeris-p7-account-v4": "a6c7ab6b03d7e8499abef932670e18e013f0e65cb1a4cf6192e67fe50541bf6c",
  "/js/language/speech-rate.js?release=20261128-aeris-p7-account-v4": "375d7100787d437854bfae0496783ecabbc65781c351cbe70f1edf272021cf48",
  "/js/language/sync-adapter.js?release=20261128-aeris-p7-account-v4": "69db776c949d8b24a80de35986a6d0955bc9236a44f790d12ff9767108505e33",
  "/js/language/wrong-book.js?release=20261128-aeris-p7-account-v4": "d011747832481addd14f1b1057ae0c81858232378343f156b6cb535d671c532c",
  "/js/membership/account.js?release=20261128-aeris-p7-account-v4": "b262fb48b08381f6e4a6849c5ad83f05748a5e8a2a3f54fc1705d53141b9b493",
  "/js/membership/plans.js?release=20261128-aeris-p7-account-v4": "3636e0bb273f9fb0443c97d0cac48d04d96d1252140cd174cf7661b6e2a5337a",
  "/js/membership/recharge.js?release=20261128-aeris-p7-account-v4": "b2e04cb1a4fdd788f3f5157a5924479389bb93ce4d382c05d525052448508c57",
  "/js/admin/formatters.js?release=20261128-aeris-p7-account-v4": "a9f836b1649a721af2df7d8d9100e10ebfc3cd5563d8de967db8178eca4f5ca9",
  "/tools.js?release=20261128-aeris-p7-account-v4": "2876bb68d20a3fd2b0b98cc2a0a6c8346a615b2831c1efbcc3338fe27e48eabe",
  "/js/tools/catalog.js?release=20261128-aeris-p7-account-v4": "0bd0445f4cf9f8bee49e84c887d484d6a23287eba47ed0d26829ea133b8f65f7",
  "/js/tools/file.js?release=20261128-aeris-p7-account-v4": "dc4f4e74c69172ceae3c1414f83a98d2fe00bbd3799b594c598bc661056bc3e1",
  "/js/tools/image.js?release=20261128-aeris-p7-account-v4": "38ef7caa8ca5411e51362e8a3ab0c00b318d735bc005647653a3a1d83094b7b8",
  "/js/tools/random.js?release=20261128-aeris-p7-account-v4": "5e3ab30d9a0d1bcf84879f8518b40304f960da5a20c7352ebac27a74cb5e1439",
  "/js/tools/runner.js?release=20261128-aeris-p7-account-v4": "b0f0370cbb72b57b082016dc67802688652e08816a8c7a134538db2bdd123220",
  "/js/tools/temporary.js?release=20261128-aeris-p7-account-v4": "00d807346ed025da0618c1da40c1973b613782660d888c6c12286a48ea310fa2",
  "/js/tools/text.js?release=20261128-aeris-p7-account-v4": "58ff1b287b2e694e9a9d6f15e30d3f2c2277e91033a8b8e938970a581ccdb01a",
  "/workflows.js?release=20261128-aeris-p7-account-v4": "db510ca1b9d7ccfae29a08f20c0ff90dfe32d283a895e2e0f71b836330b10ccf",
  "/vendor/qrcode.js?v=2.0.4": "79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c",
  "/vendor/opencc-st-characters.txt": "81c27e6364fd164181276197b9215cf95f7f12a050aa207375248a5badf8d6fc",
  "/vendor/opencc-ts-characters.txt": "737c21c66f55a419dd6956cb3089476cdefc5a36877452631617696df1e5d925",
  "/manifest.webmanifest?release=20261128-aeris-p7-account-v4": "27bf1b56cc0927aa3a62940127a29cefd0a861e01a9810eb7bf8d58c2e73ce5f",
  "/js/core/feature-flags.js?release=20261128-aeris-p7-account-v4": "b4db3061e6a0f6c8c14cc128fd5cb8bb133e7dc6963403c51cc1b0d8e5c43619",
  "/js/core/feature-console.js?release=20261128-aeris-p7-account-v4": "5cffc612302bb90c9b91f7e044ca9b8a76243f9a85a961f4b949923ebd539469",
  "/js/core/startup.js?release=20261128-aeris-p7-account-v4": "3b3fe2af83847cc6eb6357f29e5fa613b27936eca9c68d4630c4fcb99ceceb42",
  "/js/core/home-widget-layout.js?release=20261128-aeris-p7-account-v4": "a8d6f280fb30cbff8e5ef1f2432d799c2f7318facdbb1f6437e5c780b88df052",
  "/js/core/home-widgets.js?release=20261128-aeris-p7-account-v4": "9924bcab87df1e9b242e3d618e2f883d77664493037add87e5d8585d952ff8fb",
  "/js/core/home-widget-data.js?release=20261128-aeris-p7-account-v4": "091b780ae73f8bae9a66387273974307ba5cfcaecf784d59de9b4dc6f1824f0c",
  "/js/transfer/upload-part.js?release=20261128-aeris-p7-account-v4": "82fd99b7b2afa44d2d6f768dae44eb0c445e87583789d49ab12322c4b137b7a4",
  "/js/core/lazy-controller.js?release=20261128-aeris-p7-account-v4": "5baddd29157f65e032a333f4192abd20ccb4512df713d4afe948b281df387637",
  "/js/core/parked-rows.js?release=20261128-aeris-p7-account-v4": "dba6e9fe3ee28d55727cc3bb80edeb6b9ba421021efbc4aaa03995f75d3b2c10",
  "/js/core/dashboard.js?release=20261128-aeris-p7-account-v4": "4c69cf19f33d5d097a92fe8c07f64c155a5aebef2d1a5d338edb66b5167ae618",
  "/js/finance/format.js?release=20261128-aeris-p7-account-v4": "2cfe0ec636a7c164651c5a015ea0d96352cf3f81f23a0e103190dffd06176e9b",
  "/js/tools/digest-worker.js?release=20261128-aeris-p7-account-v4": "963035117a8e4e84e989a3e02e88365dad4626ef00c69ff2ba630911de66abc7",
  "/js/language/wrong-review.js?release=20261128-aeris-p7-account-v4": "d77ec0816756cf4a65a7c4f804ea80d6c17aee4757524bcee7ba2aca558c3a25",
  "/js/language/wrong-review-sync.js?release=20261128-aeris-p7-account-v4": "e7ab0a13f364031b5f1b68abc37af5439fbd545c05d4e258530f37cb92fcc299",
  "/js/finance/money.js?release=20261128-aeris-p7-account-v4": "f1172d6c74835784bd1a6629d48c1884f46c14d9825f9f8308a07d3542214277",
  "/js/account/security-center.js?release=20261128-aeris-p7-account-v4": "ea562abb2e9eb388c1a3498ee5b1928862ec53e6a296d48eea2d36fc0a1053d3",
  "/js/account/policy-page.js?release=20261128-aeris-p7-account-v4": "7d54511a956995afc6065f27ccac275dfb6657b3040f51d51ea4d8b8334562da",
  "/js/account/policy-version.js?release=20261128-aeris-p7-account-v4": "601fb007c886c38a71c45afc216e79a9923c86ccd7883c26316e638767c8323e",
  "/js/account/password-policy.js?release=20261128-aeris-p7-account-v4": "48fd3d494120682e5b8baac8c73fb6ff68714cbc89d567318e9ea39549c80c56",
  "/js/account/password-fields.js?release=20261128-aeris-p7-account-v4": "6c360c95ea68600e8f12e90ab4f6ff38a0210b3d8b57b40c66a6366836f4b6d6"
});
const PUBLICATION_HASH = "1cee35c241634469c41cdf716ae45df972148ea71a6fbead672666a0f91ecfe7";
const PUBLICATION_CACHE = `${CACHE}-task26-${PUBLICATION_HASH.slice(0, 16)}`;
const PUBLICATION_MARKER = "/__aeris/task26-publication";

async function matchesPublicationAsset(asset, response) {
  const expected = TASK26_INTEGRITY[asset];
  if (!expected) return true;
  const text = (await response.clone().text()).replace(/\r\n?/g, "\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("") === expected;
}

async function publicationCache() {
  if (!(await caches.keys()).includes(PUBLICATION_CACHE)) return null;
  const cache = await caches.open(PUBLICATION_CACHE);
  const marker = await cache.match(PUBLICATION_MARKER);
  return marker && await marker.text() === PUBLICATION_HASH ? cache : null;
}

async function publishShell(staging, cache) {
  const requests = await staging.keys();
  // Publish HTML last, after its complete static import graph is stored.
  for (const request of requests.filter(r => !['/', '/index.html'].includes(new URL(r.url).pathname)))
    await cache.put(request, await staging.match(request));
  for (const request of requests.filter(r => ['/', '/index.html'].includes(new URL(r.url).pathname)))
    await cache.put(request, await staging.match(request));
}

async function fetchWithDeadline(input, timeoutMs, options = {}, consume = response => response) {
  if (typeof AbortController === "undefined") return consume(await fetch(input, options));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await consume(await fetch(input, { ...options, signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheAssetSafely(cache, asset) {
  try {
    const response = await fetchWithDeadline(asset, ASSET_TIMEOUT_MS);
    if (response.ok) await cache.put(asset, response);
  } catch (_) {
    // Only optional brand artwork may fail without rejecting the complete core shell.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const workerURL = self.location?.href ? new URL(self.location.href, self.location.origin) : null;
      const workerRelease = workerURL && (workerURL.searchParams.get('release') || workerURL.searchParams.get('v'));
      if (workerRelease && workerRelease !== RELEASE) throw new Error('Release changed during installation');
      // A previous worker can finish asynchronous requests after activation.
      // Its legacy CACHE writes must never reach this immutable publication.
      if (await publicationCache()) { await self.skipWaiting(); return; }
      const stagingName = PUBLICATION_CACHE + '-installing';
      const staging = await caches.open(stagingName);
      let createdPublication = false, createdCompatibility = false;
      try {
        let next = 0;
        const results = await Promise.allSettled(Array.from(
          { length: Math.min(INSTALL_CONCURRENCY, INSTALL_SHELL.length) }, async () => {
            while (next < INSTALL_SHELL.length) {
              const asset = INSTALL_SHELL[next++];
              // Keep the deadline active until the response body is cached too.
              await fetchWithDeadline(asset, ASSET_TIMEOUT_MS, { cache: 'no-store' }, async response => {
                if (!response.ok) throw new Error('Incomplete release asset: ' + asset);
                if (asset === '/index.html' && !await htmlMatchesRelease(response)) throw new Error('Release changed during installation');
                if (!await matchesPublicationAsset(asset, response)) throw new Error('Publication integrity mismatch: ' + asset);
                await staging.put(asset, response);
              });
            }
          }));
        if (results.some(result => result.status === 'rejected')) throw new Error('Release shell is incomplete');
        await Promise.allSettled(OPTIONAL_BRAND_ASSETS.map(asset => cacheAssetSafely(staging, asset)));
        // Never rewrite an existing legacy release. A fresh profile gets a
        // complete compatibility snapshot, including both Task26 imports, so
        // a legacy-worker rollback cannot strand a half-populated graph.
        const previous = self.registration?.active;
        const previousURL = previous?.scriptURL ? new URL(previous.scriptURL, self.location.origin) : null;
        const previousRelease = previousURL && (previousURL.searchParams.get('release') || previousURL.searchParams.get('v'));
        const separateLegacyWriter = /^\d{8}-aeris-[a-z0-9-]+$/.test(previousRelease || '') && previousRelease !== RELEASE;
        if ((!previous || separateLegacyWriter) && !(await caches.keys()).includes(CACHE)) {
          createdCompatibility = true;
          await publishShell(staging, await caches.open(CACHE));
        }
        createdPublication = true;
        const cache = await caches.open(PUBLICATION_CACHE);
        await publishShell(staging, cache);
        await cache.put(PUBLICATION_MARKER, new Response(PUBLICATION_HASH));
        await self.skipWaiting();
      } catch (error) {
        if (createdPublication) await caches.delete(PUBLICATION_CACHE);
        if (createdCompatibility) await caches.delete(CACHE);
        throw error;
      } finally { await caches.delete(stagingName); }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Older open clients may still import their release's lazy modules. Keep
    // exact prior shell bytes; never delete unrelated/user Cache Storage.
    self.clients.claim(),
  );
});

async function htmlMatchesRelease(response) {
  return await shellRelease(response) === RELEASE && await matchesPublicationAsset('/index.html', response);
}

async function shellRelease(response) {
  const text = await response.clone().text();
  const source = text.match(/\bsrc=["'](\/app\.js\?[^"']+)["']/)?.[1];
  if (!source) return null;
  const url = new URL(source.replaceAll('&amp;', '&'), self.location.origin);
  const release = url.searchParams.get('release') || url.searchParams.get('v');
  return /^\d{8}-aeris-[a-z0-9-]+$/.test(release || '') ? release : null;
}

async function matchingAsset(request, url) {
  const version = url.searchParams.get('release') || url.searchParams.get('v');
  const versioned = /^\d{8}-aeris-/.test(version || '');
  // A newly observed document is authoritative for its not-yet-active release,
  // even when a rollback artifact reuses a previously cached release token.
  if (versioned && version !== RELEASE && observedShellReleases.has(version) && /\.(?:m?js|css)$/.test(url.pathname))
    return fetchWithDeadline(request, ASSET_TIMEOUT_MS, { cache: 'no-store' });
  const current = !versioned || version === RELEASE;
  const selected = current ? PUBLICATION_CACHE : `${OWNED_PREFIX}${version}-es-modules`;
  const keys = await caches.keys();
  if (keys.includes(selected)) {
    const cache = current ? await publicationCache() : await caches.open(selected);
    const cached = cache && await cache.match(request);
    if (cached) return cached;
  }
  if (current && INSTALL_SHELL.includes(url.pathname + url.search))
    return new Response('The complete publication is unavailable; reconnect and reload.', { status: 503 });
  if (versioned && version !== RELEASE && /\.(?:m?js|css)$/.test(url.pathname)) {
    // A newer HTML document may be served before its worker activates. Its
    // observed release can use network assets; do not cache an incomplete
    // future shell. Unobserved old cache misses still fail closed.
    return new Response('This release is no longer available; reload the page.', { status: 503 });
  }
  // Runtime requests never mutate a committed static publication. In-flight
  // old/future requests therefore cannot replace its verified source bytes.
  return fetchWithDeadline(request, ASSET_TIMEOUT_MS, { cache: 'no-store' });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetchWithDeadline(request, NAVIGATION_TIMEOUT_MS, { cache: 'no-store' });
          if (!response.ok) throw new Error('Navigation unavailable');
          const release = await shellRelease(response);
          if (release) observedShellReleases.add(release);
          if (release === RELEASE) {
            if (!await htmlMatchesRelease(response)) throw new Error('Stale publication HTML');
          }
          return response;
        } catch (_) {
          const cache = await publicationCache();
          const cached = cache && await cache.match("/index.html");
          // Pages redirects /index.html to /. Navigation cannot consume the
          // cached redirected response; preserve its bytes and headers instead.
          if (cached?.redirected) return new Response(cached.body, {
            status: cached.status, statusText: cached.statusText, headers: cached.headers,
          });
          return cached || new Response("网络暂时不可用，请联网后刷新。", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  event.respondWith(matchingAsset(request, url));
});
