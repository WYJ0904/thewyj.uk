const CACHE = "wyj-shell-20261127-aeris-p5-cache-fix-es-modules";
const RELEASE = "20261127-aeris-p5-cache-fix";
const OWNED_PREFIX = "wyj-shell-";
const observedShellReleases = new Set();
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
// Do not spend every resource's deadline waiting in the browser connection queue.
const INSTALL_CONCURRENCY = 6;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?release=20261127-aeris-p5-cache-fix",
  "/product-ui.css?release=20261127-aeris-p5-cache-fix",
  "/design-system.css?release=20261127-aeris-p5-cache-fix",
  "/public-experience.css?release=20261127-aeris-p5-cache-fix",
  "/workspace-experience.css?release=20261127-aeris-p5-cache-fix",
  "/spatial-experience.css?release=20261127-aeris-p5-cache-fix",
  "/changelog.js?release=20261127-aeris-p5-cache-fix",
  "/learning-sync.js?release=20261127-aeris-p5-cache-fix",
  "/app.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/api.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/changelog.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/capabilities.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/config.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/router.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/session.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/storage.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/ui.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/design-system.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/public-ui-policy.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/download.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/perf.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/motion.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/keyed-list.js?release=20261127-aeris-p5-cache-fix",
  "/js/core/public-experience.js?release=20261127-aeris-p5-cache-fix",
  "/favicon.ico?release=20261127-aeris-p5-cache-fix",
  "/assets/brand/favicon-32.png?release=20261127-aeris-p5-cache-fix",
  "/assets/brand/apple-touch-icon.png?release=20261127-aeris-p5-cache-fix",
  "/assets/brand/aeris-maskable-512.png?release=20261127-aeris-p5-cache-fix",
  "/assets/brand/aeris-lockup.png?release=20261127-aeris-p5-cache-fix",
  "/icon-192.png?release=20261127-aeris-p5-cache-fix",
  "/icon-512.png?release=20261127-aeris-p5-cache-fix",
  "/js/finance/app.js?release=20261127-aeris-p5-cache-fix",
  "/js/finance/candidates.js?release=20261127-aeris-p5-cache-fix",
  "/js/finance/disclosure.js?release=20261127-aeris-p5-cache-fix",
  "/js/finance/notification-ledger.js?release=20261127-aeris-p5-cache-fix",
  "/js/transfer/app.js?release=20261127-aeris-p5-cache-fix",
  "/js/transfer/updates.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/achievements.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/history.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/pdf.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/mastery.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/mastery-state.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/mastery-journal.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/quiz.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/speech.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/speech-rate.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/sync-adapter.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/wrong-book.js?release=20261127-aeris-p5-cache-fix",
  "/js/membership/account.js?release=20261127-aeris-p5-cache-fix",
  "/js/membership/plans.js?release=20261127-aeris-p5-cache-fix",
  "/js/membership/recharge.js?release=20261127-aeris-p5-cache-fix",
  "/js/admin/formatters.js?release=20261127-aeris-p5-cache-fix",
  "/tools.js?release=20261127-aeris-p5-cache-fix",
  "/js/tools/catalog.js?release=20261127-aeris-p5-cache-fix",
  "/js/tools/file.js?release=20261127-aeris-p5-cache-fix",
  "/js/tools/image.js?release=20261127-aeris-p5-cache-fix",
  "/js/tools/random.js?release=20261127-aeris-p5-cache-fix",
  "/js/tools/runner.js?release=20261127-aeris-p5-cache-fix",
  "/js/tools/temporary.js?release=20261127-aeris-p5-cache-fix",
  "/js/tools/text.js?release=20261127-aeris-p5-cache-fix",
  "/workflows.js?release=20261127-aeris-p5-cache-fix",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?release=20261127-aeris-p5-cache-fix",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?release=20261127-aeris-p5-cache-fix", "/js/core/feature-console.js?release=20261127-aeris-p5-cache-fix");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?release=20261127-aeris-p5-cache-fix");
CORE_SHELL.push("/js/core/home-widget-layout.js?release=20261127-aeris-p5-cache-fix");
CORE_SHELL.push("/js/core/home-widgets.js?release=20261127-aeris-p5-cache-fix", "/js/core/home-widget-data.js?release=20261127-aeris-p5-cache-fix");
CORE_SHELL.push("/js/transfer/upload-part.js?release=20261127-aeris-p5-cache-fix");
CORE_SHELL.push("/js/core/lazy-controller.js?release=20261127-aeris-p5-cache-fix", "/js/core/parked-rows.js?release=20261127-aeris-p5-cache-fix", "/js/core/dashboard.js?release=20261127-aeris-p5-cache-fix", "/js/finance/format.js?release=20261127-aeris-p5-cache-fix", "/js/tools/digest-worker.js?release=20261127-aeris-p5-cache-fix");

// Keep the independently fingerprinted 81-resource RC5 shell intact. Task26
// extends its required graph; these imports are never best-effort artwork.
const TASK26_SHELL = [
  "/js/language/wrong-review.js?release=20261127-aeris-p5-cache-fix",
  "/js/language/wrong-review-sync.js?release=20261127-aeris-p5-cache-fix",
];
// Finance formatting statically imports money.js. A fresh installation must
// include it before publishing HTML, while retaining the original RC5 layer.
const FINANCE_SHELL = ["/js/finance/money.js?release=20261127-aeris-p5-cache-fix"];
const TASK27_SHELL = ["/js/account/security-center.js?release=20261127-aeris-p5-cache-fix", "/js/account/policy-page.js?release=20261127-aeris-p5-cache-fix", "/js/account/policy-version.js?release=20261127-aeris-p5-cache-fix", "/js/account/password-policy.js?release=20261127-aeris-p5-cache-fix", "/js/account/password-fields.js?release=20261127-aeris-p5-cache-fix"];
const REQUIRED_SHELL = [...CORE_SHELL, ...TASK26_SHELL, ...FINANCE_SHELL, ...TASK27_SHELL];
const INSTALL_SHELL = REQUIRED_SHELL;
// Canonical UTF-8 hashes bind the current S0 shell plus Task27 additions.
const TASK26_INTEGRITY = Object.freeze({
  "/": "282ffd53e71e2e58a5c5e6824504c8a2b730c6c6fc620162af6471f666dd4e07",
  "/index.html": "282ffd53e71e2e58a5c5e6824504c8a2b730c6c6fc620162af6471f666dd4e07",
  "/styles.css?release=20261127-aeris-p5-cache-fix": "fced3f47c7568a08d5fe8bdae7345dd96aacfd545621651f63dee3b961907305",
  "/product-ui.css?release=20261127-aeris-p5-cache-fix": "bb0e2293c3efd9cae84dd2386a2ddd39fd156051110d9f9c1725f0f5df6dc34c",
  "/design-system.css?release=20261127-aeris-p5-cache-fix": "3d5c6860126463cb0c6f8770fecd87cbe57ca84255f19807635eb8a0adfcdac0",
  "/public-experience.css?release=20261127-aeris-p5-cache-fix": "9875692c2c19f78a43a1fb0991430c3aeb1db90508c31d3a7e10ecbbd3b9002e",
  "/workspace-experience.css?release=20261127-aeris-p5-cache-fix": "713896d0d192154aadeee6278fd7fd216dfb1e46a96a4c84c580044f09e422ae",
  "/spatial-experience.css?release=20261127-aeris-p5-cache-fix": "ba99a62b8f2226848a786b35858b43a2ffb434569304e51ec98a3ccdf7cf9bc9",
  "/changelog.js?release=20261127-aeris-p5-cache-fix": "e7dfbb4fc6c7c9fbdf2a677b6036bd895003a197d08908ee225aa40cce88eb4e",
  "/learning-sync.js?release=20261127-aeris-p5-cache-fix": "74ced24b8dab7c8ad16dc6b4b68ff81a89e968d18a607bbba6b066a8bee7727d",
  "/app.js?release=20261127-aeris-p5-cache-fix": "b9df9eef3341e34c3d5ad2fd156039a3dcf3c8567ba21c6314cc7080f169b922",
  "/js/core/api.js?release=20261127-aeris-p5-cache-fix": "8c83567adf9f557610779df4401cab95b27b9d093ae892d67b777628668b98b4",
  "/js/core/changelog.js?release=20261127-aeris-p5-cache-fix": "36dbeda5325785355e616a1de1fdeb00fdbf0917160c13ba121635af58dad285",
  "/js/core/capabilities.js?release=20261127-aeris-p5-cache-fix": "01a07b545f76a18aa05b1c98589b093f0c4a30597d4acd5a7efc5c9ec1ef2b56",
  "/js/core/config.js?release=20261127-aeris-p5-cache-fix": "62bc91316594549014ad3405970f1a541968908ad81ef9b6158838a533914c1f",
  "/js/core/router.js?release=20261127-aeris-p5-cache-fix": "959a88f6e8bf8dcf0f40880821ca5e2be2663bf321030bd765f7dc770cdef220",
  "/js/core/session.js?release=20261127-aeris-p5-cache-fix": "4c7a3c6ee44903662c9e2d883a0f3b4e2b440381be67e54afe2e0f07bdb08e17",
  "/js/core/storage.js?release=20261127-aeris-p5-cache-fix": "6dc0175f5f17ad2dc4ff7cb73065b8840062b51f80ffaf32151df059e5cb1200",
  "/js/core/ui.js?release=20261127-aeris-p5-cache-fix": "f79f7a083c1848c3a220e4ab0f37a85472429a19f66da65ba18892f7cdfbb6ad",
  "/js/core/design-system.js?release=20261127-aeris-p5-cache-fix": "aaecfdc397883caa6998a6aee20286f46629369bffd4e0273191dbb469581f83",
  "/js/core/public-ui-policy.js?release=20261127-aeris-p5-cache-fix": "0ba84e2ad06a282b2805d8eb5886c6fb2779439adb95a2a4d79ea4027898f823",
  "/js/core/download.js?release=20261127-aeris-p5-cache-fix": "74f6e124985edae142f0d636f07e25711e74ad2bd738a449ec5f20f82882c0fe",
  "/js/core/perf.js?release=20261127-aeris-p5-cache-fix": "add801f4828b3de5510cab3aa278b388ebbfe63ab940afeeb7de0954b4d58779",
  "/js/core/motion.js?release=20261127-aeris-p5-cache-fix": "09d80045e9cfdf4813b923ae2dea532a37cf22cf323fea994f035ea05574267f",
  "/js/core/keyed-list.js?release=20261127-aeris-p5-cache-fix": "0a904e6f499470572d4a408a7e0a253089cd4b8884606c8340640851493c229f",
  "/js/core/public-experience.js?release=20261127-aeris-p5-cache-fix": "4e4a6cea3373292ce431cdd53bec198489f3cba52bdda5d7d258ef274784162c",
  "/js/finance/app.js?release=20261127-aeris-p5-cache-fix": "87cb925c04351f478471d75b71d372bd996875301f1e8db9ac10e6ac8a017124",
  "/js/finance/candidates.js?release=20261127-aeris-p5-cache-fix": "21a7481e6080595eeda6f5914639968e5ee356998fd7b27ab2ea8b6895949918",
  "/js/finance/disclosure.js?release=20261127-aeris-p5-cache-fix": "b4032c25e57ec04b72d4d5141e5a857dd6e96e34e9cb5edc1526f3e5640a2c62",
  "/js/finance/notification-ledger.js?release=20261127-aeris-p5-cache-fix": "9c25fec579c578af82b5d996679c5ee6f1ecf83902e5346e9963c995d22aacd5",
  "/js/transfer/app.js?release=20261127-aeris-p5-cache-fix": "1d7b989c8d4722ff2577d379f431c288453a2582de88ae07dea1cd039ffcac9e",
  "/js/transfer/updates.js?release=20261127-aeris-p5-cache-fix": "cc1dd699f5587366f72fa0e3dbc49d308685a3e44f69f5bd4f9a9bf8b863167a",
  "/js/language/achievements.js?release=20261127-aeris-p5-cache-fix": "8979f78b760964c1b221fdbeacfc7237c9fdc19b3c11a02ce122c9aa5379bcb7",
  "/js/language/history.js?release=20261127-aeris-p5-cache-fix": "e143aa25d1c150731b9cc15f510d72a2d780029cb685225fe6d8ccc53c7ad5a7",
  "/js/language/pdf.js?release=20261127-aeris-p5-cache-fix": "59662916aade5334b395563d903780e757d714c36bc6dd0a48a3bb24fb5a17eb",
  "/js/language/mastery.js?release=20261127-aeris-p5-cache-fix": "8b310eac582ae958be0b4e4d9caf5682ecfeaa5d8ba7669627cc6a8e08f63dbe",
  "/js/language/mastery-state.js?release=20261127-aeris-p5-cache-fix": "94dc4e4c9253a9d0fa8aed57ec81b3029926dd8642eec7b3edbbc5808edca478",
  "/js/language/mastery-journal.js?release=20261127-aeris-p5-cache-fix": "437c1417db38d4c0b27609171a8619dd7e362cb2217ad2cef297835d8018a5c1",
  "/js/language/quiz.js?release=20261127-aeris-p5-cache-fix": "cd4546dc7e48876bac503c49e259267bde99b79ab0cf5565cb917c1ed031e3b0",
  "/js/language/speech.js?release=20261127-aeris-p5-cache-fix": "a6c7ab6b03d7e8499abef932670e18e013f0e65cb1a4cf6192e67fe50541bf6c",
  "/js/language/speech-rate.js?release=20261127-aeris-p5-cache-fix": "375d7100787d437854bfae0496783ecabbc65781c351cbe70f1edf272021cf48",
  "/js/language/sync-adapter.js?release=20261127-aeris-p5-cache-fix": "775ac7e72ba4d9eafc4049fecc9a2ef0098c79f576ab59c4123ddf3d1cece357",
  "/js/language/wrong-book.js?release=20261127-aeris-p5-cache-fix": "6a71fe46f825df361ef04b852508c0b671ac48b3afea58d7e7ad24a6d5848582",
  "/js/membership/account.js?release=20261127-aeris-p5-cache-fix": "b262fb48b08381f6e4a6849c5ad83f05748a5e8a2a3f54fc1705d53141b9b493",
  "/js/membership/plans.js?release=20261127-aeris-p5-cache-fix": "3636e0bb273f9fb0443c97d0cac48d04d96d1252140cd174cf7661b6e2a5337a",
  "/js/membership/recharge.js?release=20261127-aeris-p5-cache-fix": "b2e04cb1a4fdd788f3f5157a5924479389bb93ce4d382c05d525052448508c57",
  "/js/admin/formatters.js?release=20261127-aeris-p5-cache-fix": "a9f836b1649a721af2df7d8d9100e10ebfc3cd5563d8de967db8178eca4f5ca9",
  "/tools.js?release=20261127-aeris-p5-cache-fix": "d710237e5653aac910d6e10aa387c22e702e07812aa9151cad0926512f0977c6",
  "/js/tools/catalog.js?release=20261127-aeris-p5-cache-fix": "0bd0445f4cf9f8bee49e84c887d484d6a23287eba47ed0d26829ea133b8f65f7",
  "/js/tools/file.js?release=20261127-aeris-p5-cache-fix": "1207ea35563a6fb98c24cfacd9f3e72928c8fcbadcc10b1d9427d4beb753f034",
  "/js/tools/image.js?release=20261127-aeris-p5-cache-fix": "16387a3c1754998906f816c8729e28275fa0894013d3143b21e6cadb38e36442",
  "/js/tools/random.js?release=20261127-aeris-p5-cache-fix": "5e3ab30d9a0d1bcf84879f8518b40304f960da5a20c7352ebac27a74cb5e1439",
  "/js/tools/runner.js?release=20261127-aeris-p5-cache-fix": "b0f0370cbb72b57b082016dc67802688652e08816a8c7a134538db2bdd123220",
  "/js/tools/temporary.js?release=20261127-aeris-p5-cache-fix": "00d807346ed025da0618c1da40c1973b613782660d888c6c12286a48ea310fa2",
  "/js/tools/text.js?release=20261127-aeris-p5-cache-fix": "6f39def00951532d398a1f15797b1173ecf98eb52d47948f0350a35a655c2059",
  "/workflows.js?release=20261127-aeris-p5-cache-fix": "5634197ec2f1663473e415b228bd50d804900afd5507e93a3e955588b8c0000c",
  "/vendor/qrcode.js?v=2.0.4": "79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c",
  "/vendor/opencc-st-characters.txt": "81c27e6364fd164181276197b9215cf95f7f12a050aa207375248a5badf8d6fc",
  "/vendor/opencc-ts-characters.txt": "737c21c66f55a419dd6956cb3089476cdefc5a36877452631617696df1e5d925",
  "/manifest.webmanifest?release=20261127-aeris-p5-cache-fix": "27bf1b56cc0927aa3a62940127a29cefd0a861e01a9810eb7bf8d58c2e73ce5f",
  "/js/core/feature-flags.js?release=20261127-aeris-p5-cache-fix": "5cfc691ba634589e71ec7c33cc5ef3b2979f626d4ce337d252e622606dda6ee9",
  "/js/core/feature-console.js?release=20261127-aeris-p5-cache-fix": "562514d5fa752a537ab059f3fdccc10cb6bafb2abf9dd923cd96c48c6c25426a",
  "/js/core/startup.js?release=20261127-aeris-p5-cache-fix": "3b3fe2af83847cc6eb6357f29e5fa613b27936eca9c68d4630c4fcb99ceceb42",
  "/js/core/home-widget-layout.js?release=20261127-aeris-p5-cache-fix": "a8d6f280fb30cbff8e5ef1f2432d799c2f7318facdbb1f6437e5c780b88df052",
  "/js/core/home-widgets.js?release=20261127-aeris-p5-cache-fix": "ac85be56f6ecbf9e6d3111db5fb29aff7053d0b614a5bd149d310e1df0375339",
  "/js/core/home-widget-data.js?release=20261127-aeris-p5-cache-fix": "091b780ae73f8bae9a66387273974307ba5cfcaecf784d59de9b4dc6f1824f0c",
  "/js/transfer/upload-part.js?release=20261127-aeris-p5-cache-fix": "49ec1e3f623aac0f5812c6c6a6b35d137b28cb8aa07592015ea62de96de3ae1a",
  "/js/core/lazy-controller.js?release=20261127-aeris-p5-cache-fix": "5baddd29157f65e032a333f4192abd20ccb4512df713d4afe948b281df387637",
  "/js/core/parked-rows.js?release=20261127-aeris-p5-cache-fix": "dba6e9fe3ee28d55727cc3bb80edeb6b9ba421021efbc4aaa03995f75d3b2c10",
  "/js/core/dashboard.js?release=20261127-aeris-p5-cache-fix": "2ef34a9ce05abc764d7a4bef5a96f83e708c54aeb38d764dd05e74a43fb369ab",
  "/js/finance/format.js?release=20261127-aeris-p5-cache-fix": "63f453c3531879cfc988c15e4cec95c76278ec56f8b360a06e26362b6843a406",
  "/js/tools/digest-worker.js?release=20261127-aeris-p5-cache-fix": "765df8b8a339ae98b36de6746621199ac761e151416fca2a7d83fa85f8ab1036",
  "/js/language/wrong-review.js?release=20261127-aeris-p5-cache-fix": "d77ec0816756cf4a65a7c4f804ea80d6c17aee4757524bcee7ba2aca558c3a25",
  "/js/language/wrong-review-sync.js?release=20261127-aeris-p5-cache-fix": "e7bbc1acfdece603338fcf80d4614ccd48a83c4f1797ac2d055aebe3216eae47",
  "/js/finance/money.js?release=20261127-aeris-p5-cache-fix": "f1172d6c74835784bd1a6629d48c1884f46c14d9825f9f8308a07d3542214277",
  "/js/account/security-center.js?release=20261127-aeris-p5-cache-fix": "f3bcc3b7373e66041514737581d10cd50f62b4311242a1cca7c066ee74744c41",
  "/js/account/policy-page.js?release=20261127-aeris-p5-cache-fix": "7d54511a956995afc6065f27ccac275dfb6657b3040f51d51ea4d8b8334562da",
  "/js/account/policy-version.js?release=20261127-aeris-p5-cache-fix": "601fb007c886c38a71c45afc216e79a9923c86ccd7883c26316e638767c8323e",
  "/js/account/password-policy.js?release=20261127-aeris-p5-cache-fix": "48fd3d494120682e5b8baac8c73fb6ff68714cbc89d567318e9ea39549c80c56",
  "/js/account/password-fields.js?release=20261127-aeris-p5-cache-fix": "8aef167baf17c6e59d085f91fcd5b9c718332fd8bf1d587a7574a93b7914c414"
});
const PUBLICATION_HASH = "712df0eb0e4a92f1536dcc783216649b1dcd947fbafa5235a730f24e2a5e369f";
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
