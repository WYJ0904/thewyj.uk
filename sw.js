const CACHE = "wyj-shell-20261106-aeris-p07-r4c-integration-es-modules";
const RELEASE = "20261106-aeris-p07-r4c-integration";
const OWNED_PREFIX = "wyj-shell-";
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=20261106-aeris-p07-r4c-integration",
  "/product-ui.css?v=20261106-aeris-p07-r4c-integration",
  "/design-system.css?v=20261106-aeris-p07-r4c-integration",
  "/public-experience.css?v=20261106-aeris-p07-r4c-integration",
  "/workspace-experience.css?v=20261106-aeris-p07-r4c-integration",
  "/spatial-experience.css?v=20261106-aeris-p07-r4c-integration",
  "/changelog.js?v=20261106-aeris-p07-r4c-integration",
  "/learning-sync.js?v=20261106-aeris-p07-r4c-integration",
  "/app.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/api.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/changelog.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/capabilities.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/config.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/router.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/session.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/storage.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/ui.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/design-system.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/public-ui-policy.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/download.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/perf.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/motion.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/keyed-list.js?v=20261106-aeris-p07-r4c-integration",
  "/js/core/public-experience.js?v=20261106-aeris-p07-r4c-integration",
  "/favicon.ico?v=20261106-aeris-p07-r4c-integration",
  "/assets/brand/favicon-32.png?v=20261106-aeris-p07-r4c-integration",
  "/assets/brand/apple-touch-icon.png?v=20261106-aeris-p07-r4c-integration",
  "/assets/brand/aeris-maskable-512.png?v=20261106-aeris-p07-r4c-integration",
  "/assets/brand/aeris-lockup.png?v=20261106-aeris-p07-r4c-integration",
  "/icon-192.png?v=20261106-aeris-p07-r4c-integration",
  "/icon-512.png?v=20261106-aeris-p07-r4c-integration",
  "/js/finance/app.js?v=20261106-aeris-p07-r4c-integration",
  "/js/finance/candidates.js?v=20261106-aeris-p07-r4c-integration",
  "/js/finance/disclosure.js?v=20261106-aeris-p07-r4c-integration",
  "/js/finance/notification-ledger.js?v=20261106-aeris-p07-r4c-integration",
  "/js/transfer/app.js?v=20261106-aeris-p07-r4c-integration",
  "/js/transfer/updates.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/achievements.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/history.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/pdf.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/mastery.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/mastery-state.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/mastery-journal.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/quiz.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/speech.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/speech-rate.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/sync-adapter.js?v=20261106-aeris-p07-r4c-integration",
  "/js/language/wrong-book.js?v=20261106-aeris-p07-r4c-integration",
  "/js/membership/account.js?v=20261106-aeris-p07-r4c-integration",
  "/js/membership/plans.js?v=20261106-aeris-p07-r4c-integration",
  "/js/membership/recharge.js?v=20261106-aeris-p07-r4c-integration",
  "/js/admin/formatters.js?v=20261106-aeris-p07-r4c-integration",
  "/tools.js?v=20261106-aeris-p07-r4c-integration",
  "/js/tools/catalog.js?v=20261106-aeris-p07-r4c-integration",
  "/js/tools/file.js?v=20261106-aeris-p07-r4c-integration",
  "/js/tools/image.js?v=20261106-aeris-p07-r4c-integration",
  "/js/tools/random.js?v=20261106-aeris-p07-r4c-integration",
  "/js/tools/runner.js?v=20261106-aeris-p07-r4c-integration",
  "/js/tools/temporary.js?v=20261106-aeris-p07-r4c-integration",
  "/js/tools/text.js?v=20261106-aeris-p07-r4c-integration",
  "/workflows.js?v=20261106-aeris-p07-r4c-integration",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?v=20261106-aeris-p07-r4c-integration",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?v=20261106-aeris-p07-r4c-integration", "/js/core/feature-console.js?v=20261106-aeris-p07-r4c-integration");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?v=20261106-aeris-p07-r4c-integration");
CORE_SHELL.push("/js/core/home-widget-layout.js?v=20261106-aeris-p07-r4c-integration");
CORE_SHELL.push("/js/core/home-widgets.js?v=20261106-aeris-p07-r4c-integration", "/js/core/home-widget-data.js?v=20261106-aeris-p07-r4c-integration");
CORE_SHELL.push("/js/transfer/upload-part.js?v=20261106-aeris-p07-r4c-integration");
CORE_SHELL.push("/js/core/lazy-controller.js?v=20261106-aeris-p07-r4c-integration", "/js/core/parked-rows.js?v=20261106-aeris-p07-r4c-integration", "/js/core/dashboard.js?v=20261106-aeris-p07-r4c-integration", "/js/finance/format.js?v=20261106-aeris-p07-r4c-integration", "/js/tools/digest-worker.js?v=20261106-aeris-p07-r4c-integration");

async function fetchWithDeadline(input, timeoutMs, options = {}) {
  if (typeof AbortController === "undefined") return fetch(input, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...options, signal: controller.signal });
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
    (async () => {
      const stagingName = CACHE + '-installing';
      const staging = await caches.open(stagingName);
      try {
        const results = await Promise.allSettled(CORE_SHELL.map(async asset => {
          const response = await fetchWithDeadline(asset, ASSET_TIMEOUT_MS, { cache: 'no-store' });
          if (!response.ok) throw new Error('Incomplete release asset: ' + asset);
          if (asset === '/index.html' && !await htmlMatchesRelease(response)) throw new Error('Release changed during installation');
          await staging.put(asset, response);
        }));
        if (results.some(result => result.status === 'rejected')) throw new Error('Release shell is incomplete');
        await Promise.allSettled(OPTIONAL_BRAND_ASSETS.map(asset => cacheAssetSafely(staging, asset)));
        const cache = await caches.open(CACHE);
        const requests = await staging.keys();
        // Publish the offline HTML only after all of its release assets exist.
        for (const request of requests.filter(r => !['/', '/index.html'].includes(new URL(r.url).pathname)))
          await cache.put(request, await staging.match(request));
        for (const request of requests.filter(r => ['/', '/index.html'].includes(new URL(r.url).pathname)))
          await cache.put(request, await staging.match(request));
        await self.skipWaiting();
      } finally { await caches.delete(stagingName); }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Older open clients may still import their release's lazy modules. Keep
    // exact prior shell bytes; never delete unrelated/user Cache Storage.
    self.clients.claim(),
  );
});

async function htmlMatchesRelease(response) {
  const text = await response.clone().text();
  return text.includes('/app.js?v=' + RELEASE + '"');
}

async function matchingAsset(request, url) {
  const version = url.searchParams.get('v');
  const versioned = /^\d{8}-aeris-/.test(version || '');
  const selected = versioned ? `${OWNED_PREFIX}${version}-es-modules` : CACHE;
  const keys = await caches.keys();
  if (keys.includes(selected)) {
    const cached = await (await caches.open(selected)).match(request);
    if (cached) return cached;
  }
  if (versioned && version !== RELEASE && /\.(?:m?js|css)$/.test(url.pathname)) {
    // An old cache miss must not silently execute the current release under an
    // old module URL. A normal navigation loads the new versioned shell.
    return new Response('This release is no longer available; reload the page.', { status: 503 });
  }
  const response = await fetchWithDeadline(request, ASSET_TIMEOUT_MS);
  if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
  return response;
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
          if (await htmlMatchesRelease(response)) {
            const cache = await caches.open(CACHE);
            await cache.put("/index.html", response.clone());
          }
          return response;
        } catch (_) {
          return (await (await caches.open(CACHE)).match("/index.html")) || new Response("网络暂时不可用，请联网后刷新。", {
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
