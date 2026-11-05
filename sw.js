const CACHE = "wyj-shell-20261105-aeris-p07-r4a-runtime-r2-es-modules";
const RELEASE = "20261105-aeris-p07-r4a-runtime-r2";
const OWNED_PREFIX = "wyj-shell-";
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=20261105-aeris-p07-r4a-runtime-r2",
  "/product-ui.css?v=20261105-aeris-p07-r4a-runtime-r2",
  "/design-system.css?v=20261105-aeris-p07-r4a-runtime-r2",
  "/public-experience.css?v=20261105-aeris-p07-r4a-runtime-r2",
  "/workspace-experience.css?v=20261105-aeris-p07-r4a-runtime-r2",
  "/spatial-experience.css?v=20261105-aeris-p07-r4a-runtime-r2",
  "/changelog.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/learning-sync.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/app.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/api.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/changelog.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/capabilities.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/config.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/router.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/session.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/storage.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/ui.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/design-system.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/public-ui-policy.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/download.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/perf.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/motion.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/keyed-list.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/core/public-experience.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/favicon.ico?v=20261105-aeris-p07-r4a-runtime-r2",
  "/assets/brand/favicon-32.png?v=20261105-aeris-p07-r4a-runtime-r2",
  "/assets/brand/apple-touch-icon.png?v=20261105-aeris-p07-r4a-runtime-r2",
  "/assets/brand/aeris-maskable-512.png?v=20261105-aeris-p07-r4a-runtime-r2",
  "/assets/brand/aeris-lockup.png?v=20261105-aeris-p07-r4a-runtime-r2",
  "/icon-192.png?v=20261105-aeris-p07-r4a-runtime-r2",
  "/icon-512.png?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/finance/app.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/finance/candidates.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/finance/disclosure.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/finance/notification-ledger.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/transfer/app.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/transfer/updates.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/achievements.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/history.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/pdf.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/mastery.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/mastery-state.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/mastery-journal.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/quiz.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/speech.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/speech-rate.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/sync-adapter.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/language/wrong-book.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/membership/account.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/membership/plans.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/membership/recharge.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/admin/formatters.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/tools.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/tools/catalog.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/tools/file.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/tools/image.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/tools/random.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/tools/runner.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/tools/temporary.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/js/tools/text.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/workflows.js?v=20261105-aeris-p07-r4a-runtime-r2",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?v=20261105-aeris-p07-r4a-runtime-r2",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?v=20261105-aeris-p07-r4a-runtime-r2", "/js/core/feature-console.js?v=20261105-aeris-p07-r4a-runtime-r2");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/home-widget-layout.js?v=20261105-aeris-p07-r4a-runtime-r2");
CORE_SHELL.push("/js/core/home-widgets.js?v=20261105-aeris-p07-r4a-runtime-r2", "/js/core/home-widget-data.js?v=20261105-aeris-p07-r4a-runtime-r2");
CORE_SHELL.push("/js/transfer/upload-part.js?v=20261105-aeris-p07-r4a-runtime-r2");
CORE_SHELL.push("/js/core/lazy-controller.js?v=20261105-aeris-p07-r4a-runtime-r2", "/js/core/parked-rows.js?v=20261105-aeris-p07-r4a-runtime-r2", "/js/core/dashboard.js?v=20261105-aeris-p07-r4a-runtime-r2", "/js/finance/format.js?v=20261105-aeris-p07-r4a-runtime-r2", "/js/tools/digest-worker.js?v=20261105-aeris-p07-r4a-runtime-r2");

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
