const CACHE = "wyj-shell-20261127-aeris-p6-transfer-v2-es-modules";
const RELEASE = "20261127-aeris-p6-transfer-v2";
const OWNED_PREFIX = "wyj-shell-";
const observedShellReleases = new Set();
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
// Do not spend every resource's deadline waiting in the browser connection queue.
const INSTALL_CONCURRENCY = 6;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?release=20261127-aeris-p6-transfer-v2",
  "/product-ui.css?release=20261127-aeris-p6-transfer-v2",
  "/design-system.css?release=20261127-aeris-p6-transfer-v2",
  "/public-experience.css?release=20261127-aeris-p6-transfer-v2",
  "/workspace-experience.css?release=20261127-aeris-p6-transfer-v2",
  "/spatial-experience.css?release=20261127-aeris-p6-transfer-v2",
  "/changelog.js?release=20261127-aeris-p6-transfer-v2",
  "/learning-sync.js?release=20261127-aeris-p6-transfer-v2",
  "/app.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/api.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/changelog.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/capabilities.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/config.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/router.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/session.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/storage.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/ui.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/design-system.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/public-ui-policy.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/download.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/perf.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/motion.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/keyed-list.js?release=20261127-aeris-p6-transfer-v2",
  "/js/core/public-experience.js?release=20261127-aeris-p6-transfer-v2",
  "/favicon.ico?release=20261127-aeris-p6-transfer-v2",
  "/assets/brand/favicon-32.png?release=20261127-aeris-p6-transfer-v2",
  "/assets/brand/apple-touch-icon.png?release=20261127-aeris-p6-transfer-v2",
  "/assets/brand/aeris-maskable-512.png?release=20261127-aeris-p6-transfer-v2",
  "/assets/brand/aeris-lockup.png?release=20261127-aeris-p6-transfer-v2",
  "/icon-192.png?release=20261127-aeris-p6-transfer-v2",
  "/icon-512.png?release=20261127-aeris-p6-transfer-v2",
  "/js/finance/app.js?release=20261127-aeris-p6-transfer-v2",
  "/js/finance/candidates.js?release=20261127-aeris-p6-transfer-v2",
  "/js/finance/disclosure.js?release=20261127-aeris-p6-transfer-v2",
  "/js/finance/notification-ledger.js?release=20261127-aeris-p6-transfer-v2",
  "/js/transfer/app.js?release=20261127-aeris-p6-transfer-v2",
  "/js/transfer/updates.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/achievements.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/history.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/pdf.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/mastery.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/mastery-state.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/mastery-journal.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/quiz.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/speech.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/speech-rate.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/sync-adapter.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/wrong-book.js?release=20261127-aeris-p6-transfer-v2",
  "/js/membership/account.js?release=20261127-aeris-p6-transfer-v2",
  "/js/membership/plans.js?release=20261127-aeris-p6-transfer-v2",
  "/js/membership/recharge.js?release=20261127-aeris-p6-transfer-v2",
  "/js/admin/formatters.js?release=20261127-aeris-p6-transfer-v2",
  "/tools.js?release=20261127-aeris-p6-transfer-v2",
  "/js/tools/catalog.js?release=20261127-aeris-p6-transfer-v2",
  "/js/tools/file.js?release=20261127-aeris-p6-transfer-v2",
  "/js/tools/image.js?release=20261127-aeris-p6-transfer-v2",
  "/js/tools/random.js?release=20261127-aeris-p6-transfer-v2",
  "/js/tools/runner.js?release=20261127-aeris-p6-transfer-v2",
  "/js/tools/temporary.js?release=20261127-aeris-p6-transfer-v2",
  "/js/tools/text.js?release=20261127-aeris-p6-transfer-v2",
  "/workflows.js?release=20261127-aeris-p6-transfer-v2",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?release=20261127-aeris-p6-transfer-v2",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?release=20261127-aeris-p6-transfer-v2", "/js/core/feature-console.js?release=20261127-aeris-p6-transfer-v2");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?release=20261127-aeris-p6-transfer-v2");
CORE_SHELL.push("/js/core/home-widget-layout.js?release=20261127-aeris-p6-transfer-v2");
CORE_SHELL.push("/js/core/home-widgets.js?release=20261127-aeris-p6-transfer-v2", "/js/core/home-widget-data.js?release=20261127-aeris-p6-transfer-v2");
CORE_SHELL.push("/js/transfer/upload-part.js?release=20261127-aeris-p6-transfer-v2");
CORE_SHELL.push("/js/core/lazy-controller.js?release=20261127-aeris-p6-transfer-v2", "/js/core/parked-rows.js?release=20261127-aeris-p6-transfer-v2", "/js/core/dashboard.js?release=20261127-aeris-p6-transfer-v2", "/js/finance/format.js?release=20261127-aeris-p6-transfer-v2", "/js/tools/digest-worker.js?release=20261127-aeris-p6-transfer-v2");

// Keep the independently fingerprinted 81-resource RC5 shell intact. Task26
// extends its required graph; these imports are never best-effort artwork.
const TASK26_SHELL = [
  "/js/language/wrong-review.js?release=20261127-aeris-p6-transfer-v2",
  "/js/language/wrong-review-sync.js?release=20261127-aeris-p6-transfer-v2",
];
// Finance formatting statically imports money.js. A fresh installation must
// include it before publishing HTML, while retaining the original RC5 layer.
const FINANCE_SHELL = ["/js/finance/money.js?release=20261127-aeris-p6-transfer-v2"];
const TASK27_SHELL = ["/js/account/security-center.js?release=20261127-aeris-p6-transfer-v2", "/js/account/policy-page.js?release=20261127-aeris-p6-transfer-v2", "/js/account/policy-version.js?release=20261127-aeris-p6-transfer-v2", "/js/account/password-policy.js?release=20261127-aeris-p6-transfer-v2", "/js/account/password-fields.js?release=20261127-aeris-p6-transfer-v2"];
const REQUIRED_SHELL = [...CORE_SHELL, ...TASK26_SHELL, ...FINANCE_SHELL, ...TASK27_SHELL];
const INSTALL_SHELL = REQUIRED_SHELL;
// Canonical UTF-8 hashes bind the current S0 shell plus Task27 additions.
const TASK26_INTEGRITY = Object.freeze({
  "/": "5348e3d732026f59b484158e23aff6044ac8935512b5b290d0d5d471d5074d58",
  "/index.html": "5348e3d732026f59b484158e23aff6044ac8935512b5b290d0d5d471d5074d58",
  "/styles.css?release=20261127-aeris-p6-transfer-v2": "fced3f47c7568a08d5fe8bdae7345dd96aacfd545621651f63dee3b961907305",
  "/product-ui.css?release=20261127-aeris-p6-transfer-v2": "bb0e2293c3efd9cae84dd2386a2ddd39fd156051110d9f9c1725f0f5df6dc34c",
  "/design-system.css?release=20261127-aeris-p6-transfer-v2": "f499bc7b7b670f4a46bacf27fec663b91c9495b8ef7fb5a40cc127baa75ca2a6",
  "/public-experience.css?release=20261127-aeris-p6-transfer-v2": "9875692c2c19f78a43a1fb0991430c3aeb1db90508c31d3a7e10ecbbd3b9002e",
  "/workspace-experience.css?release=20261127-aeris-p6-transfer-v2": "713896d0d192154aadeee6278fd7fd216dfb1e46a96a4c84c580044f09e422ae",
  "/spatial-experience.css?release=20261127-aeris-p6-transfer-v2": "8b110f19a14c5ec35c082d6a1d56fe91b0ffcb3611ac207d92d1f30368c29e93",
  "/changelog.js?release=20261127-aeris-p6-transfer-v2": "e7dfbb4fc6c7c9fbdf2a677b6036bd895003a197d08908ee225aa40cce88eb4e",
  "/learning-sync.js?release=20261127-aeris-p6-transfer-v2": "74ced24b8dab7c8ad16dc6b4b68ff81a89e968d18a607bbba6b066a8bee7727d",
  "/app.js?release=20261127-aeris-p6-transfer-v2": "77df2ab0bbd23d9e6b7b093e9cfab2f6196246358803160f409b74e8c8879955",
  "/js/core/api.js?release=20261127-aeris-p6-transfer-v2": "a863c030862bd61c3bef4d58172710132f63b6120db5f97dcf56298f18fc33cf",
  "/js/core/changelog.js?release=20261127-aeris-p6-transfer-v2": "57a117d0ae175886acc9c8cb1ae7744ef5ec13e638641e2a0eab4f3d8f8cfe28",
  "/js/core/capabilities.js?release=20261127-aeris-p6-transfer-v2": "01a07b545f76a18aa05b1c98589b093f0c4a30597d4acd5a7efc5c9ec1ef2b56",
  "/js/core/config.js?release=20261127-aeris-p6-transfer-v2": "80f7ea700ea7c41af76253c725e8c24074dd16dfe01f31355eb4666415918aec",
  "/js/core/router.js?release=20261127-aeris-p6-transfer-v2": "959a88f6e8bf8dcf0f40880821ca5e2be2663bf321030bd765f7dc770cdef220",
  "/js/core/session.js?release=20261127-aeris-p6-transfer-v2": "11c81ebd049154b9b8780b1fbeb2c5a92af711b9e4e377046d949eee2b5a953d",
  "/js/core/storage.js?release=20261127-aeris-p6-transfer-v2": "6dc0175f5f17ad2dc4ff7cb73065b8840062b51f80ffaf32151df059e5cb1200",
  "/js/core/ui.js?release=20261127-aeris-p6-transfer-v2": "d97801637acb60cea1055dbe9fdc385d170282d7bd1792595ba2cd74c5de9eab",
  "/js/core/design-system.js?release=20261127-aeris-p6-transfer-v2": "aaecfdc397883caa6998a6aee20286f46629369bffd4e0273191dbb469581f83",
  "/js/core/public-ui-policy.js?release=20261127-aeris-p6-transfer-v2": "0ba84e2ad06a282b2805d8eb5886c6fb2779439adb95a2a4d79ea4027898f823",
  "/js/core/download.js?release=20261127-aeris-p6-transfer-v2": "74f6e124985edae142f0d636f07e25711e74ad2bd738a449ec5f20f82882c0fe",
  "/js/core/perf.js?release=20261127-aeris-p6-transfer-v2": "add801f4828b3de5510cab3aa278b388ebbfe63ab940afeeb7de0954b4d58779",
  "/js/core/motion.js?release=20261127-aeris-p6-transfer-v2": "09d80045e9cfdf4813b923ae2dea532a37cf22cf323fea994f035ea05574267f",
  "/js/core/keyed-list.js?release=20261127-aeris-p6-transfer-v2": "322bdb91638c955273290c54ccd3325e95d3b441fcd855f68371222a6dcd7b16",
  "/js/core/public-experience.js?release=20261127-aeris-p6-transfer-v2": "b1b27a9a10620a9b3f8d3025d5156bec110787c0b28d4b96dbb187db77584aa5",
  "/js/finance/app.js?release=20261127-aeris-p6-transfer-v2": "66e2e89306aff7e2ba3e0e1c5f9eddd77143f31731b6273fe74f4a037e1a906f",
  "/js/finance/candidates.js?release=20261127-aeris-p6-transfer-v2": "85b9c6aa5865140e9cec2c26c6b1d6e2be63127a1456da37e2d309a4bd00aed0",
  "/js/finance/disclosure.js?release=20261127-aeris-p6-transfer-v2": "b4032c25e57ec04b72d4d5141e5a857dd6e96e34e9cb5edc1526f3e5640a2c62",
  "/js/finance/notification-ledger.js?release=20261127-aeris-p6-transfer-v2": "9c25fec579c578af82b5d996679c5ee6f1ecf83902e5346e9963c995d22aacd5",
  "/js/transfer/app.js?release=20261127-aeris-p6-transfer-v2": "1be6c388ce24130a382efe49e74baac466b7c65615c20aaae34da149fc4164d5",
  "/js/transfer/updates.js?release=20261127-aeris-p6-transfer-v2": "cc1dd699f5587366f72fa0e3dbc49d308685a3e44f69f5bd4f9a9bf8b863167a",
  "/js/language/achievements.js?release=20261127-aeris-p6-transfer-v2": "d42bd96cfe8e533e532b12ae875d102831e7fb30349995fc957bde4e30bbe6be",
  "/js/language/history.js?release=20261127-aeris-p6-transfer-v2": "6cad500bd887fd4d5d12ad98aca2bb993f2e0f887ffc55994016d604653e3da8",
  "/js/language/pdf.js?release=20261127-aeris-p6-transfer-v2": "59662916aade5334b395563d903780e757d714c36bc6dd0a48a3bb24fb5a17eb",
  "/js/language/mastery.js?release=20261127-aeris-p6-transfer-v2": "3461bfac58e89857d062ad2a31df1fa08b2686bf3d6852640ece652852096253",
  "/js/language/mastery-state.js?release=20261127-aeris-p6-transfer-v2": "94dc4e4c9253a9d0fa8aed57ec81b3029926dd8642eec7b3edbbc5808edca478",
  "/js/language/mastery-journal.js?release=20261127-aeris-p6-transfer-v2": "93612f7d9949ea809714d2d975843a3a601f7f5b16564f0a233a5179d57b0eec",
  "/js/language/quiz.js?release=20261127-aeris-p6-transfer-v2": "cd4546dc7e48876bac503c49e259267bde99b79ab0cf5565cb917c1ed031e3b0",
  "/js/language/speech.js?release=20261127-aeris-p6-transfer-v2": "a6c7ab6b03d7e8499abef932670e18e013f0e65cb1a4cf6192e67fe50541bf6c",
  "/js/language/speech-rate.js?release=20261127-aeris-p6-transfer-v2": "375d7100787d437854bfae0496783ecabbc65781c351cbe70f1edf272021cf48",
  "/js/language/sync-adapter.js?release=20261127-aeris-p6-transfer-v2": "6ab8aa36914c4954f018972573ade19aeb2c6b123b785a3329c35e34c8a9bfc2",
  "/js/language/wrong-book.js?release=20261127-aeris-p6-transfer-v2": "6529afa231cc76ad898df19158fdfcd292869d796579bf8a9ceac1b3db7c9617",
  "/js/membership/account.js?release=20261127-aeris-p6-transfer-v2": "b262fb48b08381f6e4a6849c5ad83f05748a5e8a2a3f54fc1705d53141b9b493",
  "/js/membership/plans.js?release=20261127-aeris-p6-transfer-v2": "3636e0bb273f9fb0443c97d0cac48d04d96d1252140cd174cf7661b6e2a5337a",
  "/js/membership/recharge.js?release=20261127-aeris-p6-transfer-v2": "b2e04cb1a4fdd788f3f5157a5924479389bb93ce4d382c05d525052448508c57",
  "/js/admin/formatters.js?release=20261127-aeris-p6-transfer-v2": "a9f836b1649a721af2df7d8d9100e10ebfc3cd5563d8de967db8178eca4f5ca9",
  "/tools.js?release=20261127-aeris-p6-transfer-v2": "485f780e7331927717c70adf16597aee31cb3dcd795acfe8fc96cb501c696e1a",
  "/js/tools/catalog.js?release=20261127-aeris-p6-transfer-v2": "0bd0445f4cf9f8bee49e84c887d484d6a23287eba47ed0d26829ea133b8f65f7",
  "/js/tools/file.js?release=20261127-aeris-p6-transfer-v2": "edb1bdbab256d3e83954268661e7c211f34cf1b7ca4c2f5ac4053d462ad964fc",
  "/js/tools/image.js?release=20261127-aeris-p6-transfer-v2": "897eea7b87e046d08deb544230bde064d983d052c5837219e4e1d736c93a1ed0",
  "/js/tools/random.js?release=20261127-aeris-p6-transfer-v2": "5e3ab30d9a0d1bcf84879f8518b40304f960da5a20c7352ebac27a74cb5e1439",
  "/js/tools/runner.js?release=20261127-aeris-p6-transfer-v2": "b0f0370cbb72b57b082016dc67802688652e08816a8c7a134538db2bdd123220",
  "/js/tools/temporary.js?release=20261127-aeris-p6-transfer-v2": "00d807346ed025da0618c1da40c1973b613782660d888c6c12286a48ea310fa2",
  "/js/tools/text.js?release=20261127-aeris-p6-transfer-v2": "b86e176f8e6df74afa07a3e0d3ea276a5e58abe8b1ac7d4fd94888038b97bcb4",
  "/workflows.js?release=20261127-aeris-p6-transfer-v2": "db510ca1b9d7ccfae29a08f20c0ff90dfe32d283a895e2e0f71b836330b10ccf",
  "/vendor/qrcode.js?v=2.0.4": "79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c",
  "/vendor/opencc-st-characters.txt": "81c27e6364fd164181276197b9215cf95f7f12a050aa207375248a5badf8d6fc",
  "/vendor/opencc-ts-characters.txt": "737c21c66f55a419dd6956cb3089476cdefc5a36877452631617696df1e5d925",
  "/manifest.webmanifest?release=20261127-aeris-p6-transfer-v2": "27bf1b56cc0927aa3a62940127a29cefd0a861e01a9810eb7bf8d58c2e73ce5f",
  "/js/core/feature-flags.js?release=20261127-aeris-p6-transfer-v2": "aca47f8e92b82ef86d40d92650358cb92c3761e2beeb337d3b83597d9e71d824",
  "/js/core/feature-console.js?release=20261127-aeris-p6-transfer-v2": "88d4d65b85b72cbd2101af38ec63a3fccbd13b8c6fe4505e32932bc499c57f14",
  "/js/core/startup.js?release=20261127-aeris-p6-transfer-v2": "3b3fe2af83847cc6eb6357f29e5fa613b27936eca9c68d4630c4fcb99ceceb42",
  "/js/core/home-widget-layout.js?release=20261127-aeris-p6-transfer-v2": "a8d6f280fb30cbff8e5ef1f2432d799c2f7318facdbb1f6437e5c780b88df052",
  "/js/core/home-widgets.js?release=20261127-aeris-p6-transfer-v2": "24a94243a470a8a329b0f2c41f75f9812dab41eea3003ed8c95ba741b68e7950",
  "/js/core/home-widget-data.js?release=20261127-aeris-p6-transfer-v2": "091b780ae73f8bae9a66387273974307ba5cfcaecf784d59de9b4dc6f1824f0c",
  "/js/transfer/upload-part.js?release=20261127-aeris-p6-transfer-v2": "82fd99b7b2afa44d2d6f768dae44eb0c445e87583789d49ab12322c4b137b7a4",
  "/js/core/lazy-controller.js?release=20261127-aeris-p6-transfer-v2": "5baddd29157f65e032a333f4192abd20ccb4512df713d4afe948b281df387637",
  "/js/core/parked-rows.js?release=20261127-aeris-p6-transfer-v2": "dba6e9fe3ee28d55727cc3bb80edeb6b9ba421021efbc4aaa03995f75d3b2c10",
  "/js/core/dashboard.js?release=20261127-aeris-p6-transfer-v2": "410b88e1b63ff1c01c9ac330beb72e37f275a9b170baf932f1f2ecad75271cbb",
  "/js/finance/format.js?release=20261127-aeris-p6-transfer-v2": "d784af2ae7a20013d1ddefb6208721a27f01209122ac74190f4ede53e28e085e",
  "/js/tools/digest-worker.js?release=20261127-aeris-p6-transfer-v2": "20e6ee203b8c2430a63c72f20f5a879df56ca59d227c681d18bc231e19a38ea7",
  "/js/language/wrong-review.js?release=20261127-aeris-p6-transfer-v2": "d77ec0816756cf4a65a7c4f804ea80d6c17aee4757524bcee7ba2aca558c3a25",
  "/js/language/wrong-review-sync.js?release=20261127-aeris-p6-transfer-v2": "804b128bd98fc819e510e8cb810900d1a495a2237a44c8beeb8b506beefe1780",
  "/js/finance/money.js?release=20261127-aeris-p6-transfer-v2": "f1172d6c74835784bd1a6629d48c1884f46c14d9825f9f8308a07d3542214277",
  "/js/account/security-center.js?release=20261127-aeris-p6-transfer-v2": "cf0676cff5b90606da8012a9eb8cf774c64221efeeacbd906d2dd27f3d7be8c8",
  "/js/account/policy-page.js?release=20261127-aeris-p6-transfer-v2": "7d54511a956995afc6065f27ccac275dfb6657b3040f51d51ea4d8b8334562da",
  "/js/account/policy-version.js?release=20261127-aeris-p6-transfer-v2": "601fb007c886c38a71c45afc216e79a9923c86ccd7883c26316e638767c8323e",
  "/js/account/password-policy.js?release=20261127-aeris-p6-transfer-v2": "48fd3d494120682e5b8baac8c73fb6ff68714cbc89d567318e9ea39549c80c56",
  "/js/account/password-fields.js?release=20261127-aeris-p6-transfer-v2": "13aa1dbde633ac18c426cd1e20f1ab166e3c14aa641e9b4af9e02920c5d30fff"
});
const PUBLICATION_HASH = "87d4d47bed6895986b6280f992dcf9b9f868ef92e10cf26d197ea649c3e5a316";
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
