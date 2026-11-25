const CACHE = "wyj-shell-20261121-aeris-i05-preview-es-modules";
const RELEASE = "20261121-aeris-i05-preview";
const OWNED_PREFIX = "wyj-shell-";
const observedShellReleases = new Set();
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
// Do not spend every resource's deadline waiting in the browser connection queue.
const INSTALL_CONCURRENCY = 6;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?release=20261121-aeris-i05-preview",
  "/product-ui.css?release=20261121-aeris-i05-preview",
  "/design-system.css?release=20261121-aeris-i05-preview",
  "/public-experience.css?release=20261121-aeris-i05-preview",
  "/workspace-experience.css?release=20261121-aeris-i05-preview",
  "/spatial-experience.css?release=20261121-aeris-i05-preview",
  "/changelog.js?release=20261121-aeris-i05-preview",
  "/learning-sync.js?release=20261121-aeris-i05-preview",
  "/app.js?release=20261121-aeris-i05-preview",
  "/js/core/api.js?release=20261121-aeris-i05-preview",
  "/js/core/changelog.js?release=20261121-aeris-i05-preview",
  "/js/core/capabilities.js?release=20261121-aeris-i05-preview",
  "/js/core/config.js?release=20261121-aeris-i05-preview",
  "/js/core/router.js?release=20261121-aeris-i05-preview",
  "/js/core/session.js?release=20261121-aeris-i05-preview",
  "/js/core/storage.js?release=20261121-aeris-i05-preview",
  "/js/core/ui.js?release=20261121-aeris-i05-preview",
  "/js/core/design-system.js?release=20261121-aeris-i05-preview",
  "/js/core/public-ui-policy.js?release=20261121-aeris-i05-preview",
  "/js/core/download.js?release=20261121-aeris-i05-preview",
  "/js/core/perf.js?release=20261121-aeris-i05-preview",
  "/js/core/motion.js?release=20261121-aeris-i05-preview",
  "/js/core/keyed-list.js?release=20261121-aeris-i05-preview",
  "/js/core/public-experience.js?release=20261121-aeris-i05-preview",
  "/favicon.ico?release=20261121-aeris-i05-preview",
  "/assets/brand/favicon-32.png?release=20261121-aeris-i05-preview",
  "/assets/brand/apple-touch-icon.png?release=20261121-aeris-i05-preview",
  "/assets/brand/aeris-maskable-512.png?release=20261121-aeris-i05-preview",
  "/assets/brand/aeris-lockup.png?release=20261121-aeris-i05-preview",
  "/icon-192.png?release=20261121-aeris-i05-preview",
  "/icon-512.png?release=20261121-aeris-i05-preview",
  "/js/finance/app.js?release=20261121-aeris-i05-preview",
  "/js/finance/candidates.js?release=20261121-aeris-i05-preview",
  "/js/finance/disclosure.js?release=20261121-aeris-i05-preview",
  "/js/finance/notification-ledger.js?release=20261121-aeris-i05-preview",
  "/js/transfer/app.js?release=20261121-aeris-i05-preview",
  "/js/transfer/updates.js?release=20261121-aeris-i05-preview",
  "/js/language/achievements.js?release=20261121-aeris-i05-preview",
  "/js/language/history.js?release=20261121-aeris-i05-preview",
  "/js/language/pdf.js?release=20261121-aeris-i05-preview",
  "/js/language/mastery.js?release=20261121-aeris-i05-preview",
  "/js/language/mastery-state.js?release=20261121-aeris-i05-preview",
  "/js/language/mastery-journal.js?release=20261121-aeris-i05-preview",
  "/js/language/quiz.js?release=20261121-aeris-i05-preview",
  "/js/language/speech.js?release=20261121-aeris-i05-preview",
  "/js/language/speech-rate.js?release=20261121-aeris-i05-preview",
  "/js/language/sync-adapter.js?release=20261121-aeris-i05-preview",
  "/js/language/wrong-book.js?release=20261121-aeris-i05-preview",
  "/js/membership/account.js?release=20261121-aeris-i05-preview",
  "/js/membership/plans.js?release=20261121-aeris-i05-preview",
  "/js/membership/recharge.js?release=20261121-aeris-i05-preview",
  "/js/admin/formatters.js?release=20261121-aeris-i05-preview",
  "/tools.js?release=20261121-aeris-i05-preview",
  "/js/tools/catalog.js?release=20261121-aeris-i05-preview",
  "/js/tools/file.js?release=20261121-aeris-i05-preview",
  "/js/tools/image.js?release=20261121-aeris-i05-preview",
  "/js/tools/random.js?release=20261121-aeris-i05-preview",
  "/js/tools/runner.js?release=20261121-aeris-i05-preview",
  "/js/tools/temporary.js?release=20261121-aeris-i05-preview",
  "/js/tools/text.js?release=20261121-aeris-i05-preview",
  "/workflows.js?release=20261121-aeris-i05-preview",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?release=20261121-aeris-i05-preview",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?release=20261121-aeris-i05-preview", "/js/core/feature-console.js?release=20261121-aeris-i05-preview");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?release=20261121-aeris-i05-preview");
CORE_SHELL.push("/js/core/home-widget-layout.js?release=20261121-aeris-i05-preview");
CORE_SHELL.push("/js/core/home-widgets.js?release=20261121-aeris-i05-preview", "/js/core/home-widget-data.js?release=20261121-aeris-i05-preview");
CORE_SHELL.push("/js/transfer/upload-part.js?release=20261121-aeris-i05-preview");
CORE_SHELL.push("/js/core/lazy-controller.js?release=20261121-aeris-i05-preview", "/js/core/parked-rows.js?release=20261121-aeris-i05-preview", "/js/core/dashboard.js?release=20261121-aeris-i05-preview", "/js/finance/format.js?release=20261121-aeris-i05-preview", "/js/tools/digest-worker.js?release=20261121-aeris-i05-preview");

// Keep the independently fingerprinted 81-resource RC5 shell intact. Task26
// extends its required graph; these imports are never best-effort artwork.
const TASK26_SHELL = [
  "/js/language/wrong-review.js?release=20261121-aeris-i05-preview",
  "/js/language/wrong-review-sync.js?release=20261121-aeris-i05-preview",
];
// Finance formatting statically imports money.js. A fresh installation must
// include it before publishing HTML, while retaining the original RC5 layer.
const FINANCE_SHELL = ["/js/finance/money.js?release=20261121-aeris-i05-preview"];
const TASK27_SHELL = ["/js/account/security-center.js?release=20261121-aeris-i05-preview", "/js/account/policy-page.js?release=20261121-aeris-i05-preview", "/js/account/policy-version.js?release=20261121-aeris-i05-preview", "/js/account/password-policy.js?release=20261121-aeris-i05-preview", "/js/account/password-fields.js?release=20261121-aeris-i05-preview"];
const REQUIRED_SHELL = [...CORE_SHELL, ...TASK26_SHELL, ...FINANCE_SHELL, ...TASK27_SHELL];
const INSTALL_SHELL = REQUIRED_SHELL;
// Canonical UTF-8 hashes bind the current S0 shell plus Task27 additions.
const TASK26_INTEGRITY = Object.freeze({
  "/": "aef0e77fead41ddc5e83bf625b0a3c720ac6fd2b77a520a22cc233b41ff2cd1d",
  "/index.html": "aef0e77fead41ddc5e83bf625b0a3c720ac6fd2b77a520a22cc233b41ff2cd1d",
  "/styles.css?release=20261121-aeris-i05-preview": "fced3f47c7568a08d5fe8bdae7345dd96aacfd545621651f63dee3b961907305",
  "/product-ui.css?release=20261121-aeris-i05-preview": "bb0e2293c3efd9cae84dd2386a2ddd39fd156051110d9f9c1725f0f5df6dc34c",
  "/design-system.css?release=20261121-aeris-i05-preview": "0edc01cffb80021d63c3ca1c272850fda86b1d9e86483d145ecf110eff08883d",
  "/public-experience.css?release=20261121-aeris-i05-preview": "9875692c2c19f78a43a1fb0991430c3aeb1db90508c31d3a7e10ecbbd3b9002e",
  "/workspace-experience.css?release=20261121-aeris-i05-preview": "713896d0d192154aadeee6278fd7fd216dfb1e46a96a4c84c580044f09e422ae",
  "/spatial-experience.css?release=20261121-aeris-i05-preview": "9556132bdaca47547ba4947f25786582803748294e0fd5549893490eddbcbaab",
  "/changelog.js?release=20261121-aeris-i05-preview": "e7dfbb4fc6c7c9fbdf2a677b6036bd895003a197d08908ee225aa40cce88eb4e",
  "/learning-sync.js?release=20261121-aeris-i05-preview": "74ced24b8dab7c8ad16dc6b4b68ff81a89e968d18a607bbba6b066a8bee7727d",
  "/app.js?release=20261121-aeris-i05-preview": "2c14ea5d6ba0e6e860b08d924cf5be3b90fd4b52f7937fc94ac6cb631d6e392e",
  "/js/core/api.js?release=20261121-aeris-i05-preview": "e43598b6e896e541f9a40d8b4b5741217ef7547774c99875c3e9ec4b636e0680",
  "/js/core/changelog.js?release=20261121-aeris-i05-preview": "52fe2296f6fb51a63585b6e6607a239d71e77021d8878664c06fc4745eeacef9",
  "/js/core/capabilities.js?release=20261121-aeris-i05-preview": "01a07b545f76a18aa05b1c98589b093f0c4a30597d4acd5a7efc5c9ec1ef2b56",
  "/js/core/config.js?release=20261121-aeris-i05-preview": "d26937211fff17119e60c795b3e20894c85c48cb159eb055baa221e41ba6cfdc",
  "/js/core/router.js?release=20261121-aeris-i05-preview": "959a88f6e8bf8dcf0f40880821ca5e2be2663bf321030bd765f7dc770cdef220",
  "/js/core/session.js?release=20261121-aeris-i05-preview": "1212c51eab5e80ec72cfc1178fc9839582175a6e4676dcfacbbb969008702b4a",
  "/js/core/storage.js?release=20261121-aeris-i05-preview": "6dc0175f5f17ad2dc4ff7cb73065b8840062b51f80ffaf32151df059e5cb1200",
  "/js/core/ui.js?release=20261121-aeris-i05-preview": "4184cf444c6e344b796152ff61203ce60676be4adc89e36c784dc4e564b7d7f0",
  "/js/core/design-system.js?release=20261121-aeris-i05-preview": "aaecfdc397883caa6998a6aee20286f46629369bffd4e0273191dbb469581f83",
  "/js/core/public-ui-policy.js?release=20261121-aeris-i05-preview": "0ba84e2ad06a282b2805d8eb5886c6fb2779439adb95a2a4d79ea4027898f823",
  "/js/core/download.js?release=20261121-aeris-i05-preview": "74f6e124985edae142f0d636f07e25711e74ad2bd738a449ec5f20f82882c0fe",
  "/js/core/perf.js?release=20261121-aeris-i05-preview": "add801f4828b3de5510cab3aa278b388ebbfe63ab940afeeb7de0954b4d58779",
  "/js/core/motion.js?release=20261121-aeris-i05-preview": "20ce2f630e009c45ad2700b80d38cf12720ba3e944a4aa126fb7b94ece14c9ae",
  "/js/core/keyed-list.js?release=20261121-aeris-i05-preview": "b25531bc4ad00a867d067bc58f0358473abca58a7f803969dc371481e316de4d",
  "/js/core/public-experience.js?release=20261121-aeris-i05-preview": "76922782075a006edc4ad52020bab5c659944a62e6861c4278db22460187ea06",
  "/js/finance/app.js?release=20261121-aeris-i05-preview": "70796818ceb425609b0d882b4f1e626ce2399c757ef902f975d09e5b8ec8e13e",
  "/js/finance/candidates.js?release=20261121-aeris-i05-preview": "04a816bd66ac0893650d41805f7f34fa82a08c3e36ccfebdb2cd3195489fc661",
  "/js/finance/disclosure.js?release=20261121-aeris-i05-preview": "b4032c25e57ec04b72d4d5141e5a857dd6e96e34e9cb5edc1526f3e5640a2c62",
  "/js/finance/notification-ledger.js?release=20261121-aeris-i05-preview": "9c25fec579c578af82b5d996679c5ee6f1ecf83902e5346e9963c995d22aacd5",
  "/js/transfer/app.js?release=20261121-aeris-i05-preview": "44d3b4c8f76376af4b75ad0b43a7503b1da6222ffcdbb106bf26d94570d51bbb",
  "/js/transfer/updates.js?release=20261121-aeris-i05-preview": "cc1dd699f5587366f72fa0e3dbc49d308685a3e44f69f5bd4f9a9bf8b863167a",
  "/js/language/achievements.js?release=20261121-aeris-i05-preview": "d60d6fe18839132d08f4f1d06bd9c7ed86ccb7b64ebf7f50f8fdcef73ccee6dd",
  "/js/language/history.js?release=20261121-aeris-i05-preview": "c3339f51f512e87b9422c613e52a8099ff9e5fa5786e1452e3689b581bee4bfb",
  "/js/language/pdf.js?release=20261121-aeris-i05-preview": "59662916aade5334b395563d903780e757d714c36bc6dd0a48a3bb24fb5a17eb",
  "/js/language/mastery.js?release=20261121-aeris-i05-preview": "8a45bd65d69445c2f697c0abfb0dbff57c70b0ed4ceaee7f8617b115f676b51b",
  "/js/language/mastery-state.js?release=20261121-aeris-i05-preview": "94dc4e4c9253a9d0fa8aed57ec81b3029926dd8642eec7b3edbbc5808edca478",
  "/js/language/mastery-journal.js?release=20261121-aeris-i05-preview": "d8920788df58939c961b5e8f295f776ed7a8e119bc26b58b569e64b75dcfbd31",
  "/js/language/quiz.js?release=20261121-aeris-i05-preview": "cd4546dc7e48876bac503c49e259267bde99b79ab0cf5565cb917c1ed031e3b0",
  "/js/language/speech.js?release=20261121-aeris-i05-preview": "a6c7ab6b03d7e8499abef932670e18e013f0e65cb1a4cf6192e67fe50541bf6c",
  "/js/language/speech-rate.js?release=20261121-aeris-i05-preview": "375d7100787d437854bfae0496783ecabbc65781c351cbe70f1edf272021cf48",
  "/js/language/sync-adapter.js?release=20261121-aeris-i05-preview": "e126509bd389bf4e538d6a6da9ded6eeecdfde2cb27ff864b89f27bdb1555a4a",
  "/js/language/wrong-book.js?release=20261121-aeris-i05-preview": "bf37ff363205f1d462cf47ad1ee6000707d13731f0feacd25ffd971dbeeff2fe",
  "/js/membership/account.js?release=20261121-aeris-i05-preview": "b262fb48b08381f6e4a6849c5ad83f05748a5e8a2a3f54fc1705d53141b9b493",
  "/js/membership/plans.js?release=20261121-aeris-i05-preview": "3636e0bb273f9fb0443c97d0cac48d04d96d1252140cd174cf7661b6e2a5337a",
  "/js/membership/recharge.js?release=20261121-aeris-i05-preview": "b2e04cb1a4fdd788f3f5157a5924479389bb93ce4d382c05d525052448508c57",
  "/js/admin/formatters.js?release=20261121-aeris-i05-preview": "a9f836b1649a721af2df7d8d9100e10ebfc3cd5563d8de967db8178eca4f5ca9",
  "/tools.js?release=20261121-aeris-i05-preview": "78410184740e9849dd0d058eeeb4236417f8ce5bab3895b7e116df72bf739505",
  "/js/tools/catalog.js?release=20261121-aeris-i05-preview": "0bd0445f4cf9f8bee49e84c887d484d6a23287eba47ed0d26829ea133b8f65f7",
  "/js/tools/file.js?release=20261121-aeris-i05-preview": "a7a607f33e920f6001dda6336daaaf0a2ee4f89b6160ae24245e5c55822d96ca",
  "/js/tools/image.js?release=20261121-aeris-i05-preview": "2a5bc3501019c7136849150fcfcbd33718b738f1310e837726117544f8b70e40",
  "/js/tools/random.js?release=20261121-aeris-i05-preview": "5e3ab30d9a0d1bcf84879f8518b40304f960da5a20c7352ebac27a74cb5e1439",
  "/js/tools/runner.js?release=20261121-aeris-i05-preview": "b0f0370cbb72b57b082016dc67802688652e08816a8c7a134538db2bdd123220",
  "/js/tools/temporary.js?release=20261121-aeris-i05-preview": "00d807346ed025da0618c1da40c1973b613782660d888c6c12286a48ea310fa2",
  "/js/tools/text.js?release=20261121-aeris-i05-preview": "f11678f0f05ecd70be282530091000090d31921aecdd87fc0ea5f0dd04849ce5",
  "/workflows.js?release=20261121-aeris-i05-preview": "5e576476b4fa0229f22e54003b6d54e594850ade6c2b061df10b9326c56e8b76",
  "/vendor/qrcode.js?v=2.0.4": "79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c",
  "/vendor/opencc-st-characters.txt": "81c27e6364fd164181276197b9215cf95f7f12a050aa207375248a5badf8d6fc",
  "/vendor/opencc-ts-characters.txt": "737c21c66f55a419dd6956cb3089476cdefc5a36877452631617696df1e5d925",
  "/manifest.webmanifest?release=20261121-aeris-i05-preview": "27bf1b56cc0927aa3a62940127a29cefd0a861e01a9810eb7bf8d58c2e73ce5f",
  "/js/core/feature-flags.js?release=20261121-aeris-i05-preview": "68d68e86ffce8d3a1ae64fb9cbb915aa006933a691e6ab5b98ed5afce7dd106a",
  "/js/core/feature-console.js?release=20261121-aeris-i05-preview": "d52922e947fd73e2281531431eaae8467858c125b26cecc9dafd704aafd8a7a4",
  "/js/core/startup.js?release=20261121-aeris-i05-preview": "3b3fe2af83847cc6eb6357f29e5fa613b27936eca9c68d4630c4fcb99ceceb42",
  "/js/core/home-widget-layout.js?release=20261121-aeris-i05-preview": "a8d6f280fb30cbff8e5ef1f2432d799c2f7318facdbb1f6437e5c780b88df052",
  "/js/core/home-widgets.js?release=20261121-aeris-i05-preview": "8f2e2ad8a58ee8604f35d47342b5ca7097d891dbad4a80baf9c52686dc89be73",
  "/js/core/home-widget-data.js?release=20261121-aeris-i05-preview": "091b780ae73f8bae9a66387273974307ba5cfcaecf784d59de9b4dc6f1824f0c",
  "/js/transfer/upload-part.js?release=20261121-aeris-i05-preview": "49ec1e3f623aac0f5812c6c6a6b35d137b28cb8aa07592015ea62de96de3ae1a",
  "/js/core/lazy-controller.js?release=20261121-aeris-i05-preview": "5baddd29157f65e032a333f4192abd20ccb4512df713d4afe948b281df387637",
  "/js/core/parked-rows.js?release=20261121-aeris-i05-preview": "dba6e9fe3ee28d55727cc3bb80edeb6b9ba421021efbc4aaa03995f75d3b2c10",
  "/js/core/dashboard.js?release=20261121-aeris-i05-preview": "3a880f4efc5649decfffc79822a346ed1e6744a802b615bbbc9b5c2dafabecb4",
  "/js/finance/format.js?release=20261121-aeris-i05-preview": "aa8f702968b0baeeed2d3be15ab0f8c6770c02436ebe3485e3d5de9d26e2300d",
  "/js/tools/digest-worker.js?release=20261121-aeris-i05-preview": "41feb014ca99c40a9641675eda1e6c5263234ca74643f4fbeb45d4c51d3367db",
  "/js/language/wrong-review.js?release=20261121-aeris-i05-preview": "d77ec0816756cf4a65a7c4f804ea80d6c17aee4757524bcee7ba2aca558c3a25",
  "/js/language/wrong-review-sync.js?release=20261121-aeris-i05-preview": "1e55cc2febcf71076de303d6a1a68152ccbdc8379ced31304fec88273876c3e6",
  "/js/finance/money.js?release=20261121-aeris-i05-preview": "f1172d6c74835784bd1a6629d48c1884f46c14d9825f9f8308a07d3542214277",
  "/js/account/security-center.js?release=20261121-aeris-i05-preview": "6a5a47ede6ddc2db3dedc7f7fab88b9a950b862340d774f9ce775631f544813a",
  "/js/account/policy-page.js?release=20261121-aeris-i05-preview": "7d54511a956995afc6065f27ccac275dfb6657b3040f51d51ea4d8b8334562da",
  "/js/account/policy-version.js?release=20261121-aeris-i05-preview": "601fb007c886c38a71c45afc216e79a9923c86ccd7883c26316e638767c8323e",
  "/js/account/password-policy.js?release=20261121-aeris-i05-preview": "48fd3d494120682e5b8baac8c73fb6ff68714cbc89d567318e9ea39549c80c56",
  "/js/account/password-fields.js?release=20261121-aeris-i05-preview": "e67497c31748194bdba244723e45620dbfd9552840c7721b1a9b0530208c2e78"
});
const PUBLICATION_HASH = "10ec10d9be807cb15ede0bd84769a71ede757c70537a2e2263c6e24a50075e96";
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
