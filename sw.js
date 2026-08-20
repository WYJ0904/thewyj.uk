const CACHE = "wyj-shell-20260820-task11-cloud-migration-es-modules";
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=20260820-task11-cloud-migration",
  "/product-ui.css?v=20260820-task11-cloud-migration",
  "/changelog.js?v=20260820-task11-cloud-migration",
  "/learning-sync.js?v=20260820-task11-cloud-migration",
  "/app.js?v=20260820-task11-cloud-migration",
  "/js/core/api.js",
  "/js/core/changelog.js",
  "/js/core/config.js",
  "/js/core/router.js",
  "/js/core/session.js",
  "/js/core/storage.js",
  "/js/core/ui.js",
  "/js/language/achievements.js",
  "/js/language/history.js",
  "/js/language/quiz.js",
  "/js/language/sync-adapter.js",
  "/js/language/wrong-book.js",
  "/js/membership/account.js",
  "/js/membership/plans.js",
  "/js/membership/recharge.js",
  "/js/admin/formatters.js",
  "/tools.js?v=20260820-task11-cloud-migration",
  "/js/tools/catalog.js",
  "/js/tools/file.js",
  "/js/tools/image.js",
  "/js/tools/random.js",
  "/js/tools/runner.js",
  "/js/tools/temporary.js",
  "/js/tools/text.js",
  "/workflows.js?v=20260820-task11-cloud-migration",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?v=20260820-task11-cloud-migration",
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
