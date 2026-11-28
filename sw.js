const CACHE = "wyj-shell-20261128-aeris-p7-account-v3-es-modules";
const RELEASE = "20261128-aeris-p7-account-v3";
const OWNED_PREFIX = "wyj-shell-";
const observedShellReleases = new Set();
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
// Do not spend every resource's deadline waiting in the browser connection queue.
const INSTALL_CONCURRENCY = 6;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?release=20261128-aeris-p7-account-v3",
  "/product-ui.css?release=20261128-aeris-p7-account-v3",
  "/design-system.css?release=20261128-aeris-p7-account-v3",
  "/public-experience.css?release=20261128-aeris-p7-account-v3",
  "/workspace-experience.css?release=20261128-aeris-p7-account-v3",
  "/spatial-experience.css?release=20261128-aeris-p7-account-v3",
  "/changelog.js?release=20261128-aeris-p7-account-v3",
  "/learning-sync.js?release=20261128-aeris-p7-account-v3",
  "/app.js?release=20261128-aeris-p7-account-v3",
  "/js/core/api.js?release=20261128-aeris-p7-account-v3",
  "/js/core/changelog.js?release=20261128-aeris-p7-account-v3",
  "/js/core/capabilities.js?release=20261128-aeris-p7-account-v3",
  "/js/core/config.js?release=20261128-aeris-p7-account-v3",
  "/js/core/router.js?release=20261128-aeris-p7-account-v3",
  "/js/core/session.js?release=20261128-aeris-p7-account-v3",
  "/js/core/storage.js?release=20261128-aeris-p7-account-v3",
  "/js/core/ui.js?release=20261128-aeris-p7-account-v3",
  "/js/core/design-system.js?release=20261128-aeris-p7-account-v3",
  "/js/core/public-ui-policy.js?release=20261128-aeris-p7-account-v3",
  "/js/core/download.js?release=20261128-aeris-p7-account-v3",
  "/js/core/perf.js?release=20261128-aeris-p7-account-v3",
  "/js/core/motion.js?release=20261128-aeris-p7-account-v3",
  "/js/core/keyed-list.js?release=20261128-aeris-p7-account-v3",
  "/js/core/public-experience.js?release=20261128-aeris-p7-account-v3",
  "/favicon.ico?release=20261128-aeris-p7-account-v3",
  "/assets/brand/favicon-32.png?release=20261128-aeris-p7-account-v3",
  "/assets/brand/apple-touch-icon.png?release=20261128-aeris-p7-account-v3",
  "/assets/brand/aeris-maskable-512.png?release=20261128-aeris-p7-account-v3",
  "/assets/brand/aeris-lockup.png?release=20261128-aeris-p7-account-v3",
  "/icon-192.png?release=20261128-aeris-p7-account-v3",
  "/icon-512.png?release=20261128-aeris-p7-account-v3",
  "/js/finance/app.js?release=20261128-aeris-p7-account-v3",
  "/js/finance/candidates.js?release=20261128-aeris-p7-account-v3",
  "/js/finance/disclosure.js?release=20261128-aeris-p7-account-v3",
  "/js/finance/notification-ledger.js?release=20261128-aeris-p7-account-v3",
  "/js/transfer/app.js?release=20261128-aeris-p7-account-v3",
  "/js/transfer/updates.js?release=20261128-aeris-p7-account-v3",
  "/js/language/achievements.js?release=20261128-aeris-p7-account-v3",
  "/js/language/history.js?release=20261128-aeris-p7-account-v3",
  "/js/language/pdf.js?release=20261128-aeris-p7-account-v3",
  "/js/language/mastery.js?release=20261128-aeris-p7-account-v3",
  "/js/language/mastery-state.js?release=20261128-aeris-p7-account-v3",
  "/js/language/mastery-journal.js?release=20261128-aeris-p7-account-v3",
  "/js/language/quiz.js?release=20261128-aeris-p7-account-v3",
  "/js/language/speech.js?release=20261128-aeris-p7-account-v3",
  "/js/language/speech-rate.js?release=20261128-aeris-p7-account-v3",
  "/js/language/sync-adapter.js?release=20261128-aeris-p7-account-v3",
  "/js/language/wrong-book.js?release=20261128-aeris-p7-account-v3",
  "/js/membership/account.js?release=20261128-aeris-p7-account-v3",
  "/js/membership/plans.js?release=20261128-aeris-p7-account-v3",
  "/js/membership/recharge.js?release=20261128-aeris-p7-account-v3",
  "/js/admin/formatters.js?release=20261128-aeris-p7-account-v3",
  "/tools.js?release=20261128-aeris-p7-account-v3",
  "/js/tools/catalog.js?release=20261128-aeris-p7-account-v3",
  "/js/tools/file.js?release=20261128-aeris-p7-account-v3",
  "/js/tools/image.js?release=20261128-aeris-p7-account-v3",
  "/js/tools/random.js?release=20261128-aeris-p7-account-v3",
  "/js/tools/runner.js?release=20261128-aeris-p7-account-v3",
  "/js/tools/temporary.js?release=20261128-aeris-p7-account-v3",
  "/js/tools/text.js?release=20261128-aeris-p7-account-v3",
  "/workflows.js?release=20261128-aeris-p7-account-v3",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?release=20261128-aeris-p7-account-v3",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?release=20261128-aeris-p7-account-v3", "/js/core/feature-console.js?release=20261128-aeris-p7-account-v3");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?release=20261128-aeris-p7-account-v3");
CORE_SHELL.push("/js/core/home-widget-layout.js?release=20261128-aeris-p7-account-v3");
CORE_SHELL.push("/js/core/home-widgets.js?release=20261128-aeris-p7-account-v3", "/js/core/home-widget-data.js?release=20261128-aeris-p7-account-v3");
CORE_SHELL.push("/js/transfer/upload-part.js?release=20261128-aeris-p7-account-v3");
CORE_SHELL.push("/js/core/lazy-controller.js?release=20261128-aeris-p7-account-v3", "/js/core/parked-rows.js?release=20261128-aeris-p7-account-v3", "/js/core/dashboard.js?release=20261128-aeris-p7-account-v3", "/js/finance/format.js?release=20261128-aeris-p7-account-v3", "/js/tools/digest-worker.js?release=20261128-aeris-p7-account-v3");

// Keep the independently fingerprinted 81-resource RC5 shell intact. Task26
// extends its required graph; these imports are never best-effort artwork.
const TASK26_SHELL = [
  "/js/language/wrong-review.js?release=20261128-aeris-p7-account-v3",
  "/js/language/wrong-review-sync.js?release=20261128-aeris-p7-account-v3",
];
// Finance formatting statically imports money.js. A fresh installation must
// include it before publishing HTML, while retaining the original RC5 layer.
const FINANCE_SHELL = ["/js/finance/money.js?release=20261128-aeris-p7-account-v3"];
const TASK27_SHELL = ["/js/account/security-center.js?release=20261128-aeris-p7-account-v3", "/js/account/policy-page.js?release=20261128-aeris-p7-account-v3", "/js/account/policy-version.js?release=20261128-aeris-p7-account-v3", "/js/account/password-policy.js?release=20261128-aeris-p7-account-v3", "/js/account/password-fields.js?release=20261128-aeris-p7-account-v3"];
const REQUIRED_SHELL = [...CORE_SHELL, ...TASK26_SHELL, ...FINANCE_SHELL, ...TASK27_SHELL];
const INSTALL_SHELL = REQUIRED_SHELL;
// Canonical UTF-8 hashes bind the current S0 shell plus Task27 additions.
const TASK26_INTEGRITY = Object.freeze({
  "/": "7366406f30f51b6ad27e4e606b1eb4ef70b5012b2def48b797c1f1a551450e69",
  "/index.html": "7366406f30f51b6ad27e4e606b1eb4ef70b5012b2def48b797c1f1a551450e69",
  "/styles.css?release=20261128-aeris-p7-account-v3": "2ff3d395eb27b4f61c1265008e234cea214d9747da637a42454ba7114d9f4910",
  "/product-ui.css?release=20261128-aeris-p7-account-v3": "bb0e2293c3efd9cae84dd2386a2ddd39fd156051110d9f9c1725f0f5df6dc34c",
  "/design-system.css?release=20261128-aeris-p7-account-v3": "f499bc7b7b670f4a46bacf27fec663b91c9495b8ef7fb5a40cc127baa75ca2a6",
  "/public-experience.css?release=20261128-aeris-p7-account-v3": "9875692c2c19f78a43a1fb0991430c3aeb1db90508c31d3a7e10ecbbd3b9002e",
  "/workspace-experience.css?release=20261128-aeris-p7-account-v3": "713896d0d192154aadeee6278fd7fd216dfb1e46a96a4c84c580044f09e422ae",
  "/spatial-experience.css?release=20261128-aeris-p7-account-v3": "0b5321ee0a7ea79e5879b13c9af725e14557c81bb0b59da8bedf0331c740a0a6",
  "/changelog.js?release=20261128-aeris-p7-account-v3": "e7dfbb4fc6c7c9fbdf2a677b6036bd895003a197d08908ee225aa40cce88eb4e",
  "/learning-sync.js?release=20261128-aeris-p7-account-v3": "74ced24b8dab7c8ad16dc6b4b68ff81a89e968d18a607bbba6b066a8bee7727d",
  "/app.js?release=20261128-aeris-p7-account-v3": "41ce2e0b0b519a34c27a146c8942f08e7a3dc1ebcb7bd39893fdaf7b4656b868",
  "/js/core/api.js?release=20261128-aeris-p7-account-v3": "b4c291230bedf50597063d0aa08d4ce6270a3ee387db7abba6cdadaf6aa2cca3",
  "/js/core/changelog.js?release=20261128-aeris-p7-account-v3": "49b133b4255a9d02eeef25ed948489a60f153f989a64b1a7abe6a1013014f322",
  "/js/core/capabilities.js?release=20261128-aeris-p7-account-v3": "01a07b545f76a18aa05b1c98589b093f0c4a30597d4acd5a7efc5c9ec1ef2b56",
  "/js/core/config.js?release=20261128-aeris-p7-account-v3": "edc210e8c7c475bfe28ba1fbb20a188eb16276b010f9cea097e84955fc3b23af",
  "/js/core/router.js?release=20261128-aeris-p7-account-v3": "959a88f6e8bf8dcf0f40880821ca5e2be2663bf321030bd765f7dc770cdef220",
  "/js/core/session.js?release=20261128-aeris-p7-account-v3": "b41d5cadfb1a5baac5fee9bceaca59461a8115e1c20582c14f644d246f52bbc5",
  "/js/core/storage.js?release=20261128-aeris-p7-account-v3": "6dc0175f5f17ad2dc4ff7cb73065b8840062b51f80ffaf32151df059e5cb1200",
  "/js/core/ui.js?release=20261128-aeris-p7-account-v3": "1f320136e403425ce10a0dd2f49a771283c752eec1b94e5734d1f75cd6757815",
  "/js/core/design-system.js?release=20261128-aeris-p7-account-v3": "0c9ea4a5c218ed40fb19fc5fc717c4bc3885c12df6f5ed9cba4c9e433b9dbd5a",
  "/js/core/public-ui-policy.js?release=20261128-aeris-p7-account-v3": "0ba84e2ad06a282b2805d8eb5886c6fb2779439adb95a2a4d79ea4027898f823",
  "/js/core/download.js?release=20261128-aeris-p7-account-v3": "74f6e124985edae142f0d636f07e25711e74ad2bd738a449ec5f20f82882c0fe",
  "/js/core/perf.js?release=20261128-aeris-p7-account-v3": "add801f4828b3de5510cab3aa278b388ebbfe63ab940afeeb7de0954b4d58779",
  "/js/core/motion.js?release=20261128-aeris-p7-account-v3": "09d80045e9cfdf4813b923ae2dea532a37cf22cf323fea994f035ea05574267f",
  "/js/core/keyed-list.js?release=20261128-aeris-p7-account-v3": "b62db272aaa9adde9c39e039e692bfbd5f013f78970e0936ccd8c38bd4eecfea",
  "/js/core/public-experience.js?release=20261128-aeris-p7-account-v3": "2a9dea72f203ad61dc59ddefbae3fec831efa6ff4ac38c5f06deac6fb631fd8c",
  "/js/finance/app.js?release=20261128-aeris-p7-account-v3": "9b68341987875afc2d11f28bf7c17568b5b9fc3368831d2d74eff7b2e62a6656",
  "/js/finance/candidates.js?release=20261128-aeris-p7-account-v3": "d80c3e469eccfa58b680b6765689b0e0ee899507c092feca266473789385cee3",
  "/js/finance/disclosure.js?release=20261128-aeris-p7-account-v3": "b4032c25e57ec04b72d4d5141e5a857dd6e96e34e9cb5edc1526f3e5640a2c62",
  "/js/finance/notification-ledger.js?release=20261128-aeris-p7-account-v3": "9c25fec579c578af82b5d996679c5ee6f1ecf83902e5346e9963c995d22aacd5",
  "/js/transfer/app.js?release=20261128-aeris-p7-account-v3": "56a9c15a1aa4e8d32479e18bb57a1a11a1669f2b226082ccc39ba590d7a63965",
  "/js/transfer/updates.js?release=20261128-aeris-p7-account-v3": "cc1dd699f5587366f72fa0e3dbc49d308685a3e44f69f5bd4f9a9bf8b863167a",
  "/js/language/achievements.js?release=20261128-aeris-p7-account-v3": "1a8d517ced2546aaac0490883a2878bdf3907fc787ae581a1c6cd1cea0dee3cf",
  "/js/language/history.js?release=20261128-aeris-p7-account-v3": "9525f041c3201f2a545b6ef82873bead84981b83d95ad54e7b4e50b0821ce0b6",
  "/js/language/pdf.js?release=20261128-aeris-p7-account-v3": "59662916aade5334b395563d903780e757d714c36bc6dd0a48a3bb24fb5a17eb",
  "/js/language/mastery.js?release=20261128-aeris-p7-account-v3": "8d1e593ed5fa72a4cb5c08f21b1915aab13b2e798748e5f4ea016fec056823a4",
  "/js/language/mastery-state.js?release=20261128-aeris-p7-account-v3": "94dc4e4c9253a9d0fa8aed57ec81b3029926dd8642eec7b3edbbc5808edca478",
  "/js/language/mastery-journal.js?release=20261128-aeris-p7-account-v3": "7821dcbcc68662442b6a5cc9adc201aab35de9d53045ab7e193939b546da88c1",
  "/js/language/quiz.js?release=20261128-aeris-p7-account-v3": "cd4546dc7e48876bac503c49e259267bde99b79ab0cf5565cb917c1ed031e3b0",
  "/js/language/speech.js?release=20261128-aeris-p7-account-v3": "a6c7ab6b03d7e8499abef932670e18e013f0e65cb1a4cf6192e67fe50541bf6c",
  "/js/language/speech-rate.js?release=20261128-aeris-p7-account-v3": "375d7100787d437854bfae0496783ecabbc65781c351cbe70f1edf272021cf48",
  "/js/language/sync-adapter.js?release=20261128-aeris-p7-account-v3": "5f6d8a1be4908d38ab3ae458260d4b43593049aaf40c95c77061a17228f8380c",
  "/js/language/wrong-book.js?release=20261128-aeris-p7-account-v3": "897405f6abe32faec5e5152ab9c031174ec3b42827609d21471911a6c0ea7367",
  "/js/membership/account.js?release=20261128-aeris-p7-account-v3": "b262fb48b08381f6e4a6849c5ad83f05748a5e8a2a3f54fc1705d53141b9b493",
  "/js/membership/plans.js?release=20261128-aeris-p7-account-v3": "3636e0bb273f9fb0443c97d0cac48d04d96d1252140cd174cf7661b6e2a5337a",
  "/js/membership/recharge.js?release=20261128-aeris-p7-account-v3": "b2e04cb1a4fdd788f3f5157a5924479389bb93ce4d382c05d525052448508c57",
  "/js/admin/formatters.js?release=20261128-aeris-p7-account-v3": "a9f836b1649a721af2df7d8d9100e10ebfc3cd5563d8de967db8178eca4f5ca9",
  "/tools.js?release=20261128-aeris-p7-account-v3": "2fb49efd7c5877901f3e69d61e057cbbeb21fa7077415fdfa1f27219ed68f7e5",
  "/js/tools/catalog.js?release=20261128-aeris-p7-account-v3": "0bd0445f4cf9f8bee49e84c887d484d6a23287eba47ed0d26829ea133b8f65f7",
  "/js/tools/file.js?release=20261128-aeris-p7-account-v3": "dc2fe530b28d727dda0349b4b8a65bca14442dd47f560f8033b2a478f7c301ac",
  "/js/tools/image.js?release=20261128-aeris-p7-account-v3": "8471fdbd6618c68fbb0c3a0e949815838eed76fc1ab83d6ec07294a2dd6955df",
  "/js/tools/random.js?release=20261128-aeris-p7-account-v3": "5e3ab30d9a0d1bcf84879f8518b40304f960da5a20c7352ebac27a74cb5e1439",
  "/js/tools/runner.js?release=20261128-aeris-p7-account-v3": "b0f0370cbb72b57b082016dc67802688652e08816a8c7a134538db2bdd123220",
  "/js/tools/temporary.js?release=20261128-aeris-p7-account-v3": "00d807346ed025da0618c1da40c1973b613782660d888c6c12286a48ea310fa2",
  "/js/tools/text.js?release=20261128-aeris-p7-account-v3": "141cbcc010d3aceb455187719537525f0f16709631a1d7e55c8b2ea58b2fcd1e",
  "/workflows.js?release=20261128-aeris-p7-account-v3": "db510ca1b9d7ccfae29a08f20c0ff90dfe32d283a895e2e0f71b836330b10ccf",
  "/vendor/qrcode.js?v=2.0.4": "79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c",
  "/vendor/opencc-st-characters.txt": "81c27e6364fd164181276197b9215cf95f7f12a050aa207375248a5badf8d6fc",
  "/vendor/opencc-ts-characters.txt": "737c21c66f55a419dd6956cb3089476cdefc5a36877452631617696df1e5d925",
  "/manifest.webmanifest?release=20261128-aeris-p7-account-v3": "27bf1b56cc0927aa3a62940127a29cefd0a861e01a9810eb7bf8d58c2e73ce5f",
  "/js/core/feature-flags.js?release=20261128-aeris-p7-account-v3": "28c758926b5ab17fe6e9d79753cdf5fdd0d2002b412aeb51ab09eecd4be76ee6",
  "/js/core/feature-console.js?release=20261128-aeris-p7-account-v3": "cd4c49521d3563903539f77337d5abe6e11c39af4d97969844ca332919f199ce",
  "/js/core/startup.js?release=20261128-aeris-p7-account-v3": "3b3fe2af83847cc6eb6357f29e5fa613b27936eca9c68d4630c4fcb99ceceb42",
  "/js/core/home-widget-layout.js?release=20261128-aeris-p7-account-v3": "a8d6f280fb30cbff8e5ef1f2432d799c2f7318facdbb1f6437e5c780b88df052",
  "/js/core/home-widgets.js?release=20261128-aeris-p7-account-v3": "c5a0142b88635c97fa357fe0184939775382ddd27f08fec67302dcad7e8392ca",
  "/js/core/home-widget-data.js?release=20261128-aeris-p7-account-v3": "091b780ae73f8bae9a66387273974307ba5cfcaecf784d59de9b4dc6f1824f0c",
  "/js/transfer/upload-part.js?release=20261128-aeris-p7-account-v3": "82fd99b7b2afa44d2d6f768dae44eb0c445e87583789d49ab12322c4b137b7a4",
  "/js/core/lazy-controller.js?release=20261128-aeris-p7-account-v3": "5baddd29157f65e032a333f4192abd20ccb4512df713d4afe948b281df387637",
  "/js/core/parked-rows.js?release=20261128-aeris-p7-account-v3": "dba6e9fe3ee28d55727cc3bb80edeb6b9ba421021efbc4aaa03995f75d3b2c10",
  "/js/core/dashboard.js?release=20261128-aeris-p7-account-v3": "d8bcca2b2caa1d49613d12d40935dda2908af79aebb119a1a0b61307a7ee22a4",
  "/js/finance/format.js?release=20261128-aeris-p7-account-v3": "e61b3be3b48fa0c96abaa16c8ed525e3ce3e0d20c97b7a02106cf8942b4b1ded",
  "/js/tools/digest-worker.js?release=20261128-aeris-p7-account-v3": "e024dd1f326c2273880cc45d0dfbc0c4a1c41b98e3abe3e9077df310a6d96158",
  "/js/language/wrong-review.js?release=20261128-aeris-p7-account-v3": "d77ec0816756cf4a65a7c4f804ea80d6c17aee4757524bcee7ba2aca558c3a25",
  "/js/language/wrong-review-sync.js?release=20261128-aeris-p7-account-v3": "9a3cfbdd1d60e7b692c7f0fffca9fb960faecc214f0c59d0f4f2039acc6657f9",
  "/js/finance/money.js?release=20261128-aeris-p7-account-v3": "f1172d6c74835784bd1a6629d48c1884f46c14d9825f9f8308a07d3542214277",
  "/js/account/security-center.js?release=20261128-aeris-p7-account-v3": "310c6703bb358f071bb5b0eb256992bfbc0824e15081bda929f733cb18a51c49",
  "/js/account/policy-page.js?release=20261128-aeris-p7-account-v3": "7d54511a956995afc6065f27ccac275dfb6657b3040f51d51ea4d8b8334562da",
  "/js/account/policy-version.js?release=20261128-aeris-p7-account-v3": "601fb007c886c38a71c45afc216e79a9923c86ccd7883c26316e638767c8323e",
  "/js/account/password-policy.js?release=20261128-aeris-p7-account-v3": "48fd3d494120682e5b8baac8c73fb6ff68714cbc89d567318e9ea39549c80c56",
  "/js/account/password-fields.js?release=20261128-aeris-p7-account-v3": "5af0a36a87f350918655112c6e1266d0bea48afe440771cda427a011cf92a4ca"
});
const PUBLICATION_HASH = "a0a8211af084d83040455edb9a15742daf6692e94c20590a378648dba54d9990";
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
