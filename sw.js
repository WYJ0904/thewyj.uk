const CACHE = "wyj-shell-20260828-task17-finance-web-es-modules";
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=20260828-task17-finance-web",
  "/product-ui.css?v=20260828-task17-finance-web",
  "/changelog.js?v=20260828-task17-finance-web",
  "/learning-sync.js?v=20260828-task17-finance-web",
  "/app.js?v=20260828-task17-finance-web",
  "/js/core/api.js?v=20260828-task17-finance-web",
  "/js/core/changelog.js?v=20260828-task17-finance-web",
  "/js/core/config.js?v=20260828-task17-finance-web",
  "/js/core/router.js?v=20260828-task17-finance-web",
  "/js/core/session.js?v=20260828-task17-finance-web",
  "/js/core/storage.js?v=20260828-task17-finance-web",
  "/js/core/ui.js?v=20260828-task17-finance-web",
  "/js/finance/app.js?v=20260828-task17-finance-web",
  "/js/language/achievements.js?v=20260828-task17-finance-web",
  "/js/language/history.js?v=20260828-task17-finance-web",
  "/js/language/pdf.js?v=20260828-task17-finance-web",
  "/js/language/quiz.js?v=20260828-task17-finance-web",
  "/js/language/sync-adapter.js?v=20260828-task17-finance-web",
  "/js/language/wrong-book.js?v=20260828-task17-finance-web",
  "/js/membership/account.js?v=20260828-task17-finance-web",
  "/js/membership/plans.js?v=20260828-task17-finance-web",
  "/js/membership/recharge.js?v=20260828-task17-finance-web",
  "/js/admin/formatters.js?v=20260828-task17-finance-web",
  "/tools.js?v=20260828-task17-finance-web",
  "/js/tools/catalog.js?v=20260828-task17-finance-web",
  "/js/tools/file.js?v=20260828-task17-finance-web",
  "/js/tools/image.js?v=20260828-task17-finance-web",
  "/js/tools/random.js?v=20260828-task17-finance-web",
  "/js/tools/runner.js?v=20260828-task17-finance-web",
  "/js/tools/temporary.js?v=20260828-task17-finance-web",
  "/js/tools/text.js?v=20260828-task17-finance-web",
  "/workflows.js?v=20260828-task17-finance-web",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?v=20260828-task17-finance-web",
  "/icon-192.png",
  "/icon-512.png",
];
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];

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
