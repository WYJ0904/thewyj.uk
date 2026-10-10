const CACHE = "wyj-shell-20261010-aeris-release-b50-es-modules";
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=20261010-aeris-release-b50",
  "/product-ui.css?v=20261010-aeris-release-b50",
  "/design-system.css?v=20261010-aeris-release-b50",
  "/public-experience.css?v=20261010-aeris-release-b50",
  "/workspace-experience.css?v=20261010-aeris-release-b50",
  "/changelog.js?v=20261010-aeris-release-b50",
  "/learning-sync.js?v=20261010-aeris-release-b50",
  "/app.js?v=20261010-aeris-release-b50",
  "/js/core/api.js?v=20261010-aeris-release-b50",
  "/js/core/changelog.js?v=20261010-aeris-release-b50",
  "/js/core/capabilities.js?v=20261010-aeris-release-b50",
  "/js/core/config.js?v=20261010-aeris-release-b50",
  "/js/core/router.js?v=20261010-aeris-release-b50",
  "/js/core/session.js?v=20261010-aeris-release-b50",
  "/js/core/storage.js?v=20261010-aeris-release-b50",
  "/js/core/ui.js?v=20261010-aeris-release-b50",
  "/js/core/design-system.js?v=20261010-aeris-release-b50",
  "/js/core/download.js?v=20261010-aeris-release-b50",
  "/js/core/perf.js?v=20261010-aeris-release-b50",
  "/js/core/motion.js?v=20261010-aeris-release-b50",
  "/js/core/keyed-list.js?v=20261010-aeris-release-b50",
  "/js/core/public-experience.js?v=20261010-aeris-release-b50",
  "/favicon.ico?v=20261010-aeris-release-b50",
  "/assets/brand/favicon-32.png?v=20261010-aeris-release-b50",
  "/assets/brand/apple-touch-icon.png?v=20261010-aeris-release-b50",
  "/assets/brand/aeris-maskable-512.png?v=20261010-aeris-release-b50",
  "/assets/brand/aeris-lockup.png?v=20261010-aeris-release-b50",
  "/icon-192.png?v=20261010-aeris-release-b50",
  "/icon-512.png?v=20261010-aeris-release-b50",
  "/js/finance/app.js?v=20261010-aeris-release-b50",
  "/js/finance/candidates.js?v=20261010-aeris-release-b50",
  "/js/finance/disclosure.js?v=20261010-aeris-release-b50",
  "/js/finance/notification-ledger.js?v=20261010-aeris-release-b50",
  "/js/transfer/app.js?v=20261010-aeris-release-b50",
  "/js/transfer/updates.js?v=20261010-aeris-release-b50",
  "/js/language/achievements.js?v=20261010-aeris-release-b50",
  "/js/language/history.js?v=20261010-aeris-release-b50",
  "/js/language/pdf.js?v=20261010-aeris-release-b50",
  "/js/language/quiz.js?v=20261010-aeris-release-b50",
  "/js/language/speech.js?v=20261010-aeris-release-b50",
  "/js/language/speech-rate.js?v=20261010-aeris-release-b50",
  "/js/language/sync-adapter.js?v=20261010-aeris-release-b50",
  "/js/language/wrong-book.js?v=20261010-aeris-release-b50",
  "/js/membership/account.js?v=20261010-aeris-release-b50",
  "/js/membership/plans.js?v=20261010-aeris-release-b50",
  "/js/membership/recharge.js?v=20261010-aeris-release-b50",
  "/js/admin/formatters.js?v=20261010-aeris-release-b50",
  "/tools.js?v=20261010-aeris-release-b50",
  "/js/tools/catalog.js?v=20261010-aeris-release-b50",
  "/js/tools/file.js?v=20261010-aeris-release-b50",
  "/js/tools/image.js?v=20261010-aeris-release-b50",
  "/js/tools/random.js?v=20261010-aeris-release-b50",
  "/js/tools/runner.js?v=20261010-aeris-release-b50",
  "/js/tools/temporary.js?v=20261010-aeris-release-b50",
  "/js/tools/text.js?v=20261010-aeris-release-b50",
  "/workflows.js?v=20261010-aeris-release-b50",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?v=20261010-aeris-release-b50",
  "/icon-192.png",
  "/icon-512.png",
];
CORE_SHELL.push("/js/core/feature-flags.js?v=20261010-aeris-release-b50", "/js/core/feature-console.js?v=20261010-aeris-release-b50");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/home-widget-layout.js?v=20261010-aeris-release-b50");
CORE_SHELL.push("/js/core/home-widgets.js?v=20261010-aeris-release-b50", "/js/core/home-widget-data.js?v=20261010-aeris-release-b50");
CORE_SHELL.push("/js/transfer/upload-part.js?v=20261010-aeris-release-b50");
CORE_SHELL.push("/js/core/lazy-controller.js?v=20261010-aeris-release-b50", "/js/core/parked-rows.js?v=20261010-aeris-release-b50", "/js/core/dashboard.js?v=20261010-aeris-release-b50", "/js/finance/format.js?v=20261010-aeris-release-b50", "/js/tools/digest-worker.js?v=20261010-aeris-release-b50");

async function fetchWithDeadline(input, timeoutMs) {
  if (typeof AbortController === "undefined") return fetch(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheAssetSafely(cache, asset) {
  try {
    const response = await fetchWithDeadline(asset, ASSET_TIMEOUT_MS);
    if (response.ok) await cache.put(asset, response);
  } catch (_) {
    // A partial shell is still useful; one unavailable asset must not block SW installation.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await Promise.allSettled(
          [...CORE_SHELL, ...OPTIONAL_BRAND_ASSETS].map((asset) => cacheAssetSafely(cache, asset)),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetchWithDeadline(request, NAVIGATION_TIMEOUT_MS);
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put("/index.html", response.clone());
          }
          return response;
        } catch (_) {
          return (await caches.match("/index.html")) || new Response("网络暂时不可用，请联网后刷新。", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetchWithDeadline(request, ASSET_TIMEOUT_MS).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      });
    }),
  );
});
