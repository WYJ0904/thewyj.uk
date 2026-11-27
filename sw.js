const CACHE = "wyj-shell-20261127-aeris-p5-ux-final-es-modules";
const RELEASE = "20261127-aeris-p5-ux-final";
const OWNED_PREFIX = "wyj-shell-";
const observedShellReleases = new Set();
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
// Do not spend every resource's deadline waiting in the browser connection queue.
const INSTALL_CONCURRENCY = 6;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?release=20261127-aeris-p5-ux-final",
  "/product-ui.css?release=20261127-aeris-p5-ux-final",
  "/design-system.css?release=20261127-aeris-p5-ux-final",
  "/public-experience.css?release=20261127-aeris-p5-ux-final",
  "/workspace-experience.css?release=20261127-aeris-p5-ux-final",
  "/spatial-experience.css?release=20261127-aeris-p5-ux-final",
  "/changelog.js?release=20261127-aeris-p5-ux-final",
  "/learning-sync.js?release=20261127-aeris-p5-ux-final",
  "/app.js?release=20261127-aeris-p5-ux-final",
  "/js/core/api.js?release=20261127-aeris-p5-ux-final",
  "/js/core/changelog.js?release=20261127-aeris-p5-ux-final",
  "/js/core/capabilities.js?release=20261127-aeris-p5-ux-final",
  "/js/core/config.js?release=20261127-aeris-p5-ux-final",
  "/js/core/router.js?release=20261127-aeris-p5-ux-final",
  "/js/core/session.js?release=20261127-aeris-p5-ux-final",
  "/js/core/storage.js?release=20261127-aeris-p5-ux-final",
  "/js/core/ui.js?release=20261127-aeris-p5-ux-final",
  "/js/core/design-system.js?release=20261127-aeris-p5-ux-final",
  "/js/core/public-ui-policy.js?release=20261127-aeris-p5-ux-final",
  "/js/core/download.js?release=20261127-aeris-p5-ux-final",
  "/js/core/perf.js?release=20261127-aeris-p5-ux-final",
  "/js/core/motion.js?release=20261127-aeris-p5-ux-final",
  "/js/core/keyed-list.js?release=20261127-aeris-p5-ux-final",
  "/js/core/public-experience.js?release=20261127-aeris-p5-ux-final",
  "/favicon.ico?release=20261127-aeris-p5-ux-final",
  "/assets/brand/favicon-32.png?release=20261127-aeris-p5-ux-final",
  "/assets/brand/apple-touch-icon.png?release=20261127-aeris-p5-ux-final",
  "/assets/brand/aeris-maskable-512.png?release=20261127-aeris-p5-ux-final",
  "/assets/brand/aeris-lockup.png?release=20261127-aeris-p5-ux-final",
  "/icon-192.png?release=20261127-aeris-p5-ux-final",
  "/icon-512.png?release=20261127-aeris-p5-ux-final",
  "/js/finance/app.js?release=20261127-aeris-p5-ux-final",
  "/js/finance/candidates.js?release=20261127-aeris-p5-ux-final",
  "/js/finance/disclosure.js?release=20261127-aeris-p5-ux-final",
  "/js/finance/notification-ledger.js?release=20261127-aeris-p5-ux-final",
  "/js/transfer/app.js?release=20261127-aeris-p5-ux-final",
  "/js/transfer/updates.js?release=20261127-aeris-p5-ux-final",
  "/js/language/achievements.js?release=20261127-aeris-p5-ux-final",
  "/js/language/history.js?release=20261127-aeris-p5-ux-final",
  "/js/language/pdf.js?release=20261127-aeris-p5-ux-final",
  "/js/language/mastery.js?release=20261127-aeris-p5-ux-final",
  "/js/language/mastery-state.js?release=20261127-aeris-p5-ux-final",
  "/js/language/mastery-journal.js?release=20261127-aeris-p5-ux-final",
  "/js/language/quiz.js?release=20261127-aeris-p5-ux-final",
  "/js/language/speech.js?release=20261127-aeris-p5-ux-final",
  "/js/language/speech-rate.js?release=20261127-aeris-p5-ux-final",
  "/js/language/sync-adapter.js?release=20261127-aeris-p5-ux-final",
  "/js/language/wrong-book.js?release=20261127-aeris-p5-ux-final",
  "/js/membership/account.js?release=20261127-aeris-p5-ux-final",
  "/js/membership/plans.js?release=20261127-aeris-p5-ux-final",
  "/js/membership/recharge.js?release=20261127-aeris-p5-ux-final",
  "/js/admin/formatters.js?release=20261127-aeris-p5-ux-final",
  "/tools.js?release=20261127-aeris-p5-ux-final",
  "/js/tools/catalog.js?release=20261127-aeris-p5-ux-final",
  "/js/tools/file.js?release=20261127-aeris-p5-ux-final",
  "/js/tools/image.js?release=20261127-aeris-p5-ux-final",
  "/js/tools/random.js?release=20261127-aeris-p5-ux-final",
  "/js/tools/runner.js?release=20261127-aeris-p5-ux-final",
  "/js/tools/temporary.js?release=20261127-aeris-p5-ux-final",
  "/js/tools/text.js?release=20261127-aeris-p5-ux-final",
  "/workflows.js?release=20261127-aeris-p5-ux-final",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?release=20261127-aeris-p5-ux-final",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?release=20261127-aeris-p5-ux-final", "/js/core/feature-console.js?release=20261127-aeris-p5-ux-final");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?release=20261127-aeris-p5-ux-final");
CORE_SHELL.push("/js/core/home-widget-layout.js?release=20261127-aeris-p5-ux-final");
CORE_SHELL.push("/js/core/home-widgets.js?release=20261127-aeris-p5-ux-final", "/js/core/home-widget-data.js?release=20261127-aeris-p5-ux-final");
CORE_SHELL.push("/js/transfer/upload-part.js?release=20261127-aeris-p5-ux-final");
CORE_SHELL.push("/js/core/lazy-controller.js?release=20261127-aeris-p5-ux-final", "/js/core/parked-rows.js?release=20261127-aeris-p5-ux-final", "/js/core/dashboard.js?release=20261127-aeris-p5-ux-final", "/js/finance/format.js?release=20261127-aeris-p5-ux-final", "/js/tools/digest-worker.js?release=20261127-aeris-p5-ux-final");

// Keep the independently fingerprinted 81-resource RC5 shell intact. Task26
// extends its required graph; these imports are never best-effort artwork.
const TASK26_SHELL = [
  "/js/language/wrong-review.js?release=20261127-aeris-p5-ux-final",
  "/js/language/wrong-review-sync.js?release=20261127-aeris-p5-ux-final",
];
// Finance formatting statically imports money.js. A fresh installation must
// include it before publishing HTML, while retaining the original RC5 layer.
const FINANCE_SHELL = ["/js/finance/money.js?release=20261127-aeris-p5-ux-final"];
const TASK27_SHELL = ["/js/account/security-center.js?release=20261127-aeris-p5-ux-final", "/js/account/policy-page.js?release=20261127-aeris-p5-ux-final", "/js/account/policy-version.js?release=20261127-aeris-p5-ux-final", "/js/account/password-policy.js?release=20261127-aeris-p5-ux-final", "/js/account/password-fields.js?release=20261127-aeris-p5-ux-final"];
const REQUIRED_SHELL = [...CORE_SHELL, ...TASK26_SHELL, ...FINANCE_SHELL, ...TASK27_SHELL];
const INSTALL_SHELL = REQUIRED_SHELL;
// Canonical UTF-8 hashes bind the current S0 shell plus Task27 additions.
const TASK26_INTEGRITY = Object.freeze({
  "/": "c20a7068de718d207c9e5faf3efa7267a421c583ace80d73a3214912267d132d",
  "/index.html": "c20a7068de718d207c9e5faf3efa7267a421c583ace80d73a3214912267d132d",
  "/styles.css?release=20261127-aeris-p5-ux-final": "fced3f47c7568a08d5fe8bdae7345dd96aacfd545621651f63dee3b961907305",
  "/product-ui.css?release=20261127-aeris-p5-ux-final": "bb0e2293c3efd9cae84dd2386a2ddd39fd156051110d9f9c1725f0f5df6dc34c",
  "/design-system.css?release=20261127-aeris-p5-ux-final": "3d5c6860126463cb0c6f8770fecd87cbe57ca84255f19807635eb8a0adfcdac0",
  "/public-experience.css?release=20261127-aeris-p5-ux-final": "9875692c2c19f78a43a1fb0991430c3aeb1db90508c31d3a7e10ecbbd3b9002e",
  "/workspace-experience.css?release=20261127-aeris-p5-ux-final": "713896d0d192154aadeee6278fd7fd216dfb1e46a96a4c84c580044f09e422ae",
  "/spatial-experience.css?release=20261127-aeris-p5-ux-final": "a467aa0cb996bb3653766e527fd86b6f9ac4cc13a68b530575d2202c5ee57764",
  "/changelog.js?release=20261127-aeris-p5-ux-final": "e7dfbb4fc6c7c9fbdf2a677b6036bd895003a197d08908ee225aa40cce88eb4e",
  "/learning-sync.js?release=20261127-aeris-p5-ux-final": "74ced24b8dab7c8ad16dc6b4b68ff81a89e968d18a607bbba6b066a8bee7727d",
  "/app.js?release=20261127-aeris-p5-ux-final": "f80ef422659c1f054622f49c49ea77291b31fe1157312564a14bf676ebf9cc3c",
  "/js/core/api.js?release=20261127-aeris-p5-ux-final": "80e63965af452b1004112da6dd5eb6aadadd4ea48a7bb3173622ff7f7ded7c7d",
  "/js/core/changelog.js?release=20261127-aeris-p5-ux-final": "1d51f2594c3fd9597b3ddfa6de21e5f7762e83db6e5d589ff638f3ba1f925ade",
  "/js/core/capabilities.js?release=20261127-aeris-p5-ux-final": "01a07b545f76a18aa05b1c98589b093f0c4a30597d4acd5a7efc5c9ec1ef2b56",
  "/js/core/config.js?release=20261127-aeris-p5-ux-final": "3a97b4392355092396f3f7a69cf7a620592616861c75d951e31d9e631bd9d61f",
  "/js/core/router.js?release=20261127-aeris-p5-ux-final": "959a88f6e8bf8dcf0f40880821ca5e2be2663bf321030bd765f7dc770cdef220",
  "/js/core/session.js?release=20261127-aeris-p5-ux-final": "68be42c8f775b487c934803efb2faeca5d00d19dc726daccac4781d0350d7338",
  "/js/core/storage.js?release=20261127-aeris-p5-ux-final": "6dc0175f5f17ad2dc4ff7cb73065b8840062b51f80ffaf32151df059e5cb1200",
  "/js/core/ui.js?release=20261127-aeris-p5-ux-final": "6c4505221eb9030df05cbdafb4d2e5888f2d18b62a32cdd3a6e5ef491d10b3f1",
  "/js/core/design-system.js?release=20261127-aeris-p5-ux-final": "aaecfdc397883caa6998a6aee20286f46629369bffd4e0273191dbb469581f83",
  "/js/core/public-ui-policy.js?release=20261127-aeris-p5-ux-final": "0ba84e2ad06a282b2805d8eb5886c6fb2779439adb95a2a4d79ea4027898f823",
  "/js/core/download.js?release=20261127-aeris-p5-ux-final": "74f6e124985edae142f0d636f07e25711e74ad2bd738a449ec5f20f82882c0fe",
  "/js/core/perf.js?release=20261127-aeris-p5-ux-final": "add801f4828b3de5510cab3aa278b388ebbfe63ab940afeeb7de0954b4d58779",
  "/js/core/motion.js?release=20261127-aeris-p5-ux-final": "09d80045e9cfdf4813b923ae2dea532a37cf22cf323fea994f035ea05574267f",
  "/js/core/keyed-list.js?release=20261127-aeris-p5-ux-final": "fa3fd3fc8c7d411bf679256c67f8a564dbdeb3606e0817a323877042cbf10cdd",
  "/js/core/public-experience.js?release=20261127-aeris-p5-ux-final": "4c7a41bd89f5b8905e56cd4fe05b93891fa6c17dd08a832367f886f1e0625c7c",
  "/js/finance/app.js?release=20261127-aeris-p5-ux-final": "531d11cae0abbeff4e32c1bb79e2808b03763acecca6662fb772f38869de8a14",
  "/js/finance/candidates.js?release=20261127-aeris-p5-ux-final": "7a395615ff3b5986567f75180f312604cf0a615cf44a1957cda5adec78c9d72c",
  "/js/finance/disclosure.js?release=20261127-aeris-p5-ux-final": "b4032c25e57ec04b72d4d5141e5a857dd6e96e34e9cb5edc1526f3e5640a2c62",
  "/js/finance/notification-ledger.js?release=20261127-aeris-p5-ux-final": "9c25fec579c578af82b5d996679c5ee6f1ecf83902e5346e9963c995d22aacd5",
  "/js/transfer/app.js?release=20261127-aeris-p5-ux-final": "3787fdab9a74c1e22b3a15de3b84ee1b063ecf437e56f6c237d4e92aee7aad3b",
  "/js/transfer/updates.js?release=20261127-aeris-p5-ux-final": "cc1dd699f5587366f72fa0e3dbc49d308685a3e44f69f5bd4f9a9bf8b863167a",
  "/js/language/achievements.js?release=20261127-aeris-p5-ux-final": "3071fb4ee7b5a7a85009ec4293c47e4adfd98a73d37c9d9e6e2aa891badd5f26",
  "/js/language/history.js?release=20261127-aeris-p5-ux-final": "6b3e9d2a4e8f45a959e6e5c3999bc307af1770479ea7f32a4c8135cb1e82e4ba",
  "/js/language/pdf.js?release=20261127-aeris-p5-ux-final": "59662916aade5334b395563d903780e757d714c36bc6dd0a48a3bb24fb5a17eb",
  "/js/language/mastery.js?release=20261127-aeris-p5-ux-final": "1b803de4b0adc333e40d7d787320028a1cd10d6b33644bf6d8d98c4dcea293f0",
  "/js/language/mastery-state.js?release=20261127-aeris-p5-ux-final": "94dc4e4c9253a9d0fa8aed57ec81b3029926dd8642eec7b3edbbc5808edca478",
  "/js/language/mastery-journal.js?release=20261127-aeris-p5-ux-final": "db058c3fcd9181f826e6b3f904d3a625c6f603fe366b61c0fccac59a31d133e0",
  "/js/language/quiz.js?release=20261127-aeris-p5-ux-final": "cd4546dc7e48876bac503c49e259267bde99b79ab0cf5565cb917c1ed031e3b0",
  "/js/language/speech.js?release=20261127-aeris-p5-ux-final": "a6c7ab6b03d7e8499abef932670e18e013f0e65cb1a4cf6192e67fe50541bf6c",
  "/js/language/speech-rate.js?release=20261127-aeris-p5-ux-final": "375d7100787d437854bfae0496783ecabbc65781c351cbe70f1edf272021cf48",
  "/js/language/sync-adapter.js?release=20261127-aeris-p5-ux-final": "e41448445c381ded9b982a16007dffe1d846401143d99c277d93f9a39d9a53d2",
  "/js/language/wrong-book.js?release=20261127-aeris-p5-ux-final": "9837f2a407b05119666d32e4f2f8641d88c440d355c293d869c94f26424acebe",
  "/js/membership/account.js?release=20261127-aeris-p5-ux-final": "b262fb48b08381f6e4a6849c5ad83f05748a5e8a2a3f54fc1705d53141b9b493",
  "/js/membership/plans.js?release=20261127-aeris-p5-ux-final": "3636e0bb273f9fb0443c97d0cac48d04d96d1252140cd174cf7661b6e2a5337a",
  "/js/membership/recharge.js?release=20261127-aeris-p5-ux-final": "b2e04cb1a4fdd788f3f5157a5924479389bb93ce4d382c05d525052448508c57",
  "/js/admin/formatters.js?release=20261127-aeris-p5-ux-final": "a9f836b1649a721af2df7d8d9100e10ebfc3cd5563d8de967db8178eca4f5ca9",
  "/tools.js?release=20261127-aeris-p5-ux-final": "c0b031490e290bcfbf312e2c233e88245e3612606ba6a40dc0ff1e22c45b9d86",
  "/js/tools/catalog.js?release=20261127-aeris-p5-ux-final": "0bd0445f4cf9f8bee49e84c887d484d6a23287eba47ed0d26829ea133b8f65f7",
  "/js/tools/file.js?release=20261127-aeris-p5-ux-final": "93c0351b558a8b5b44412a2c5b33af7d611056650969cfa284aa24d88bb8f9f9",
  "/js/tools/image.js?release=20261127-aeris-p5-ux-final": "603c77607efa267a4e2dfedd18502ce428c70966354389798cfced66964343bb",
  "/js/tools/random.js?release=20261127-aeris-p5-ux-final": "5e3ab30d9a0d1bcf84879f8518b40304f960da5a20c7352ebac27a74cb5e1439",
  "/js/tools/runner.js?release=20261127-aeris-p5-ux-final": "b0f0370cbb72b57b082016dc67802688652e08816a8c7a134538db2bdd123220",
  "/js/tools/temporary.js?release=20261127-aeris-p5-ux-final": "00d807346ed025da0618c1da40c1973b613782660d888c6c12286a48ea310fa2",
  "/js/tools/text.js?release=20261127-aeris-p5-ux-final": "f2fb34f77d9ee379c47c0261e86710e18f8c22d667cc7956be5c4b9105067871",
  "/workflows.js?release=20261127-aeris-p5-ux-final": "8607040213a9aac222e6bc80863496fde68ea45d5a5cfa27eab60eb28ad63b51",
  "/vendor/qrcode.js?v=2.0.4": "79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c",
  "/vendor/opencc-st-characters.txt": "81c27e6364fd164181276197b9215cf95f7f12a050aa207375248a5badf8d6fc",
  "/vendor/opencc-ts-characters.txt": "737c21c66f55a419dd6956cb3089476cdefc5a36877452631617696df1e5d925",
  "/manifest.webmanifest?release=20261127-aeris-p5-ux-final": "27bf1b56cc0927aa3a62940127a29cefd0a861e01a9810eb7bf8d58c2e73ce5f",
  "/js/core/feature-flags.js?release=20261127-aeris-p5-ux-final": "05df8950a2498806b3af4858ba4caddcc159e905b628b106aa617db3de01c7d1",
  "/js/core/feature-console.js?release=20261127-aeris-p5-ux-final": "790f32c2b9ffe6b2b026fff4f13b5f75d393c98fba40c0937038b6646ea639bb",
  "/js/core/startup.js?release=20261127-aeris-p5-ux-final": "3b3fe2af83847cc6eb6357f29e5fa613b27936eca9c68d4630c4fcb99ceceb42",
  "/js/core/home-widget-layout.js?release=20261127-aeris-p5-ux-final": "a8d6f280fb30cbff8e5ef1f2432d799c2f7318facdbb1f6437e5c780b88df052",
  "/js/core/home-widgets.js?release=20261127-aeris-p5-ux-final": "7c644c4ebee462d735025e0ccea0de4615c89cfa5fd700b80ce2a673ee299eac",
  "/js/core/home-widget-data.js?release=20261127-aeris-p5-ux-final": "091b780ae73f8bae9a66387273974307ba5cfcaecf784d59de9b4dc6f1824f0c",
  "/js/transfer/upload-part.js?release=20261127-aeris-p5-ux-final": "49ec1e3f623aac0f5812c6c6a6b35d137b28cb8aa07592015ea62de96de3ae1a",
  "/js/core/lazy-controller.js?release=20261127-aeris-p5-ux-final": "5baddd29157f65e032a333f4192abd20ccb4512df713d4afe948b281df387637",
  "/js/core/parked-rows.js?release=20261127-aeris-p5-ux-final": "dba6e9fe3ee28d55727cc3bb80edeb6b9ba421021efbc4aaa03995f75d3b2c10",
  "/js/core/dashboard.js?release=20261127-aeris-p5-ux-final": "61fa9a8afdb2cd25e8d9773f902b525908af8cfd2a6601d4cfc7e8824e01136c",
  "/js/finance/format.js?release=20261127-aeris-p5-ux-final": "51c5a674bcc37e25c4e4cf4f2a0acfe7192ceae6dd67b18045f2c021d8181ecb",
  "/js/tools/digest-worker.js?release=20261127-aeris-p5-ux-final": "647fa8643bdffd0c6e6d86afa5f2bd961029f73ebbab698ed89fea10a5a1f1db",
  "/js/language/wrong-review.js?release=20261127-aeris-p5-ux-final": "d77ec0816756cf4a65a7c4f804ea80d6c17aee4757524bcee7ba2aca558c3a25",
  "/js/language/wrong-review-sync.js?release=20261127-aeris-p5-ux-final": "1ef6224421593bb0916986bdd5533c5305aac93f54ca83d9311c100b99ce9b70",
  "/js/finance/money.js?release=20261127-aeris-p5-ux-final": "f1172d6c74835784bd1a6629d48c1884f46c14d9825f9f8308a07d3542214277",
  "/js/account/security-center.js?release=20261127-aeris-p5-ux-final": "99c4d9d3526c8dcb39eed95f0dc123e7d87465b2e77874a153cca33095d73ab5",
  "/js/account/policy-page.js?release=20261127-aeris-p5-ux-final": "7d54511a956995afc6065f27ccac275dfb6657b3040f51d51ea4d8b8334562da",
  "/js/account/policy-version.js?release=20261127-aeris-p5-ux-final": "601fb007c886c38a71c45afc216e79a9923c86ccd7883c26316e638767c8323e",
  "/js/account/password-policy.js?release=20261127-aeris-p5-ux-final": "48fd3d494120682e5b8baac8c73fb6ff68714cbc89d567318e9ea39549c80c56",
  "/js/account/password-fields.js?release=20261127-aeris-p5-ux-final": "21be4157354b7ef3a74c97b87968b83239cec3dfa0049f9721901fb11d373113"
});
const PUBLICATION_HASH = "f2693e77ccd24962fb01022ba20806eb660498175d1c62fcf58452f935a04699";
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
