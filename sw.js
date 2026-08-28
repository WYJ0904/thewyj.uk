const CACHE = "wyj-shell-20260829-task17-finance-hotfix-es-modules";
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=20260829-task17-finance-hotfix",
  "/product-ui.css?v=20260829-task17-finance-hotfix",
  "/changelog.js?v=20260829-task17-finance-hotfix",
  "/learning-sync.js?v=20260829-task17-finance-hotfix",
  "/app.js?v=20260829-task17-finance-hotfix",
  "/js/core/api.js?v=20260829-task17-finance-hotfix",
  "/js/core/changelog.js?v=20260829-task17-finance-hotfix",
  "/js/core/config.js?v=20260829-task17-finance-hotfix",
  "/js/core/router.js?v=20260829-task17-finance-hotfix",
  "/js/core/session.js?v=20260829-task17-finance-hotfix",
  "/js/core/storage.js?v=20260829-task17-finance-hotfix",
  "/js/core/ui.js?v=20260829-task17-finance-hotfix",
  "/js/finance/app.js?v=20260829-task17-finance-hotfix",
  "/js/language/achievements.js?v=20260829-task17-finance-hotfix",
  "/js/language/history.js?v=20260829-task17-finance-hotfix",
  "/js/language/pdf.js?v=20260829-task17-finance-hotfix",
  "/js/language/quiz.js?v=20260829-task17-finance-hotfix",
  "/js/language/sync-adapter.js?v=20260829-task17-finance-hotfix",
  "/js/language/wrong-book.js?v=20260829-task17-finance-hotfix",
  "/js/membership/account.js?v=20260829-task17-finance-hotfix",
  "/js/membership/plans.js?v=20260829-task17-finance-hotfix",
  "/js/membership/recharge.js?v=20260829-task17-finance-hotfix",
  "/js/admin/formatters.js?v=20260829-task17-finance-hotfix",
  "/tools.js?v=20260829-task17-finance-hotfix",
  "/js/tools/catalog.js?v=20260829-task17-finance-hotfix",
  "/js/tools/file.js?v=20260829-task17-finance-hotfix",
  "/js/tools/image.js?v=20260829-task17-finance-hotfix",
  "/js/tools/random.js?v=20260829-task17-finance-hotfix",
  "/js/tools/runner.js?v=20260829-task17-finance-hotfix",
  "/js/tools/temporary.js?v=20260829-task17-finance-hotfix",
  "/js/tools/text.js?v=20260829-task17-finance-hotfix",
  "/workflows.js?v=20260829-task17-finance-hotfix",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?v=20260829-task17-finance-hotfix",
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
