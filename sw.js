const CACHE = "wyj-shell-20261107-aeris-p07-final-rc3-es-modules";
const RELEASE = "20261107-aeris-p07-final-rc3";
const OWNED_PREFIX = "wyj-shell-";
const observedShellReleases = new Set();
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?release=20261107-aeris-p07-final-rc3",
  "/product-ui.css?release=20261107-aeris-p07-final-rc3",
  "/design-system.css?release=20261107-aeris-p07-final-rc3",
  "/public-experience.css?release=20261107-aeris-p07-final-rc3",
  "/workspace-experience.css?release=20261107-aeris-p07-final-rc3",
  "/spatial-experience.css?release=20261107-aeris-p07-final-rc3",
  "/changelog.js?release=20261107-aeris-p07-final-rc3",
  "/learning-sync.js?release=20261107-aeris-p07-final-rc3",
  "/app.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/api.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/changelog.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/capabilities.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/config.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/router.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/session.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/storage.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/ui.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/design-system.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/public-ui-policy.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/download.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/perf.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/motion.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/keyed-list.js?release=20261107-aeris-p07-final-rc3",
  "/js/core/public-experience.js?release=20261107-aeris-p07-final-rc3",
  "/favicon.ico?release=20261107-aeris-p07-final-rc3",
  "/assets/brand/favicon-32.png?release=20261107-aeris-p07-final-rc3",
  "/assets/brand/apple-touch-icon.png?release=20261107-aeris-p07-final-rc3",
  "/assets/brand/aeris-maskable-512.png?release=20261107-aeris-p07-final-rc3",
  "/assets/brand/aeris-lockup.png?release=20261107-aeris-p07-final-rc3",
  "/icon-192.png?release=20261107-aeris-p07-final-rc3",
  "/icon-512.png?release=20261107-aeris-p07-final-rc3",
  "/js/finance/app.js?release=20261107-aeris-p07-final-rc3",
  "/js/finance/candidates.js?release=20261107-aeris-p07-final-rc3",
  "/js/finance/disclosure.js?release=20261107-aeris-p07-final-rc3",
  "/js/finance/notification-ledger.js?release=20261107-aeris-p07-final-rc3",
  "/js/transfer/app.js?release=20261107-aeris-p07-final-rc3",
  "/js/transfer/updates.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/achievements.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/history.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/pdf.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/mastery.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/mastery-state.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/mastery-journal.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/quiz.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/speech.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/speech-rate.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/sync-adapter.js?release=20261107-aeris-p07-final-rc3",
  "/js/language/wrong-book.js?release=20261107-aeris-p07-final-rc3",
  "/js/membership/account.js?release=20261107-aeris-p07-final-rc3",
  "/js/membership/plans.js?release=20261107-aeris-p07-final-rc3",
  "/js/membership/recharge.js?release=20261107-aeris-p07-final-rc3",
  "/js/admin/formatters.js?release=20261107-aeris-p07-final-rc3",
  "/tools.js?release=20261107-aeris-p07-final-rc3",
  "/js/tools/catalog.js?release=20261107-aeris-p07-final-rc3",
  "/js/tools/file.js?release=20261107-aeris-p07-final-rc3",
  "/js/tools/image.js?release=20261107-aeris-p07-final-rc3",
  "/js/tools/random.js?release=20261107-aeris-p07-final-rc3",
  "/js/tools/runner.js?release=20261107-aeris-p07-final-rc3",
  "/js/tools/temporary.js?release=20261107-aeris-p07-final-rc3",
  "/js/tools/text.js?release=20261107-aeris-p07-final-rc3",
  "/workflows.js?release=20261107-aeris-p07-final-rc3",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?release=20261107-aeris-p07-final-rc3",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?release=20261107-aeris-p07-final-rc3", "/js/core/feature-console.js?release=20261107-aeris-p07-final-rc3");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?release=20261107-aeris-p07-final-rc3");
CORE_SHELL.push("/js/core/home-widget-layout.js?release=20261107-aeris-p07-final-rc3");
CORE_SHELL.push("/js/core/home-widgets.js?release=20261107-aeris-p07-final-rc3", "/js/core/home-widget-data.js?release=20261107-aeris-p07-final-rc3");
CORE_SHELL.push("/js/transfer/upload-part.js?release=20261107-aeris-p07-final-rc3");
CORE_SHELL.push("/js/core/lazy-controller.js?release=20261107-aeris-p07-final-rc3", "/js/core/parked-rows.js?release=20261107-aeris-p07-final-rc3", "/js/core/dashboard.js?release=20261107-aeris-p07-final-rc3", "/js/finance/format.js?release=20261107-aeris-p07-final-rc3", "/js/tools/digest-worker.js?release=20261107-aeris-p07-final-rc3");

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
  return await shellRelease(response) === RELEASE;
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
  const selected = versioned ? `${OWNED_PREFIX}${version}-es-modules` : CACHE;
  const keys = await caches.keys();
  if (keys.includes(selected)) {
    const cached = await (await caches.open(selected)).match(request);
    if (cached) return cached;
  }
  if (versioned && version !== RELEASE && /\.(?:m?js|css)$/.test(url.pathname)) {
    // A newer HTML document may be served before its worker activates. Its
    // observed release can use network assets; do not cache an incomplete
    // future shell. Unobserved old cache misses still fail closed.
    if (observedShellReleases.has(version))
      return fetchWithDeadline(request, ASSET_TIMEOUT_MS, { cache: 'no-store' });
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
          const release = await shellRelease(response);
          if (release) observedShellReleases.add(release);
          if (release === RELEASE) {
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
