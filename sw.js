const CACHE = "wyj-shell-20261109-aeris-p07-production-r2-es-modules";
const RELEASE = "20261109-aeris-p07-production-r2";
const OWNED_PREFIX = "wyj-shell-";
const observedShellReleases = new Set();
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
// Do not spend every resource's deadline waiting in the browser connection queue.
const INSTALL_CONCURRENCY = 6;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?release=20261109-aeris-p07-production-r2",
  "/product-ui.css?release=20261109-aeris-p07-production-r2",
  "/design-system.css?release=20261109-aeris-p07-production-r2",
  "/public-experience.css?release=20261109-aeris-p07-production-r2",
  "/workspace-experience.css?release=20261109-aeris-p07-production-r2",
  "/spatial-experience.css?release=20261109-aeris-p07-production-r2",
  "/changelog.js?release=20261109-aeris-p07-production-r2",
  "/learning-sync.js?release=20261109-aeris-p07-production-r2",
  "/app.js?release=20261109-aeris-p07-production-r2",
  "/js/core/api.js?release=20261109-aeris-p07-production-r2",
  "/js/core/changelog.js?release=20261109-aeris-p07-production-r2",
  "/js/core/capabilities.js?release=20261109-aeris-p07-production-r2",
  "/js/core/config.js?release=20261109-aeris-p07-production-r2",
  "/js/core/router.js?release=20261109-aeris-p07-production-r2",
  "/js/core/session.js?release=20261109-aeris-p07-production-r2",
  "/js/core/storage.js?release=20261109-aeris-p07-production-r2",
  "/js/core/ui.js?release=20261109-aeris-p07-production-r2",
  "/js/core/design-system.js?release=20261109-aeris-p07-production-r2",
  "/js/core/public-ui-policy.js?release=20261109-aeris-p07-production-r2",
  "/js/core/download.js?release=20261109-aeris-p07-production-r2",
  "/js/core/perf.js?release=20261109-aeris-p07-production-r2",
  "/js/core/motion.js?release=20261109-aeris-p07-production-r2",
  "/js/core/keyed-list.js?release=20261109-aeris-p07-production-r2",
  "/js/core/public-experience.js?release=20261109-aeris-p07-production-r2",
  "/favicon.ico?release=20261109-aeris-p07-production-r2",
  "/assets/brand/favicon-32.png?release=20261109-aeris-p07-production-r2",
  "/assets/brand/apple-touch-icon.png?release=20261109-aeris-p07-production-r2",
  "/assets/brand/aeris-maskable-512.png?release=20261109-aeris-p07-production-r2",
  "/assets/brand/aeris-lockup.png?release=20261109-aeris-p07-production-r2",
  "/icon-192.png?release=20261109-aeris-p07-production-r2",
  "/icon-512.png?release=20261109-aeris-p07-production-r2",
  "/js/finance/app.js?release=20261109-aeris-p07-production-r2",
  "/js/finance/candidates.js?release=20261109-aeris-p07-production-r2",
  "/js/finance/disclosure.js?release=20261109-aeris-p07-production-r2",
  "/js/finance/notification-ledger.js?release=20261109-aeris-p07-production-r2",
  "/js/transfer/app.js?release=20261109-aeris-p07-production-r2",
  "/js/transfer/updates.js?release=20261109-aeris-p07-production-r2",
  "/js/language/achievements.js?release=20261109-aeris-p07-production-r2",
  "/js/language/history.js?release=20261109-aeris-p07-production-r2",
  "/js/language/pdf.js?release=20261109-aeris-p07-production-r2",
  "/js/language/mastery.js?release=20261109-aeris-p07-production-r2",
  "/js/language/mastery-state.js?release=20261109-aeris-p07-production-r2",
  "/js/language/mastery-journal.js?release=20261109-aeris-p07-production-r2",
  "/js/language/quiz.js?release=20261109-aeris-p07-production-r2",
  "/js/language/speech.js?release=20261109-aeris-p07-production-r2",
  "/js/language/speech-rate.js?release=20261109-aeris-p07-production-r2",
  "/js/language/sync-adapter.js?release=20261109-aeris-p07-production-r2",
  "/js/language/wrong-book.js?release=20261109-aeris-p07-production-r2",
  "/js/membership/account.js?release=20261109-aeris-p07-production-r2",
  "/js/membership/plans.js?release=20261109-aeris-p07-production-r2",
  "/js/membership/recharge.js?release=20261109-aeris-p07-production-r2",
  "/js/admin/formatters.js?release=20261109-aeris-p07-production-r2",
  "/tools.js?release=20261109-aeris-p07-production-r2",
  "/js/tools/catalog.js?release=20261109-aeris-p07-production-r2",
  "/js/tools/file.js?release=20261109-aeris-p07-production-r2",
  "/js/tools/image.js?release=20261109-aeris-p07-production-r2",
  "/js/tools/random.js?release=20261109-aeris-p07-production-r2",
  "/js/tools/runner.js?release=20261109-aeris-p07-production-r2",
  "/js/tools/temporary.js?release=20261109-aeris-p07-production-r2",
  "/js/tools/text.js?release=20261109-aeris-p07-production-r2",
  "/workflows.js?release=20261109-aeris-p07-production-r2",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?release=20261109-aeris-p07-production-r2",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?release=20261109-aeris-p07-production-r2", "/js/core/feature-console.js?release=20261109-aeris-p07-production-r2");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?release=20261109-aeris-p07-production-r2");
CORE_SHELL.push("/js/core/home-widget-layout.js?release=20261109-aeris-p07-production-r2");
CORE_SHELL.push("/js/core/home-widgets.js?release=20261109-aeris-p07-production-r2", "/js/core/home-widget-data.js?release=20261109-aeris-p07-production-r2");
CORE_SHELL.push("/js/transfer/upload-part.js?release=20261109-aeris-p07-production-r2");
CORE_SHELL.push("/js/core/lazy-controller.js?release=20261109-aeris-p07-production-r2", "/js/core/parked-rows.js?release=20261109-aeris-p07-production-r2", "/js/core/dashboard.js?release=20261109-aeris-p07-production-r2", "/js/finance/format.js?release=20261109-aeris-p07-production-r2", "/js/tools/digest-worker.js?release=20261109-aeris-p07-production-r2");

// Keep the independently fingerprinted 81-resource RC5 shell intact. Task26
// extends its required graph; these imports are never best-effort artwork.
const TASK26_SHELL = [
  "/js/language/wrong-review.js?release=20261109-aeris-p07-production-r2",
  "/js/language/wrong-review-sync.js?release=20261109-aeris-p07-production-r2",
];
const REQUIRED_SHELL = [...CORE_SHELL, ...TASK26_SHELL];
// Canonical UTF-8 text (CRLF -> LF) binds the changed Task26 graph, not only its
// public P07 URL token. The publication name changes with these source hashes.
const TASK26_INTEGRITY = Object.freeze({
  "/": "58400cb089e7d453905fe664f3c3b1a024b7f144473311408df9488df68a3463",
  "/index.html": "58400cb089e7d453905fe664f3c3b1a024b7f144473311408df9488df68a3463",
  "/app.js?release=20261109-aeris-p07-production-r2": "eff3903e3e2f82647e6be53577dced7cf1a000928075c509030adf41bf782eaa",
  "/learning-sync.js?release=20261109-aeris-p07-production-r2": "74ced24b8dab7c8ad16dc6b4b68ff81a89e968d18a607bbba6b066a8bee7727d",
  "/product-ui.css?release=20261109-aeris-p07-production-r2": "2afdb61afc1770198569bad4a2afa1c4fe131a5201a688c4e3af40cb96a1e5b8",
  "/js/language/mastery.js?release=20261109-aeris-p07-production-r2": "65b55adb1e66d075d9c899481a17020a0241fb388ff2e71925214190dd9b4797",
  "/js/language/quiz.js?release=20261109-aeris-p07-production-r2": "cd4546dc7e48876bac503c49e259267bde99b79ab0cf5565cb917c1ed031e3b0",
  "/js/language/wrong-book.js?release=20261109-aeris-p07-production-r2": "a1b452848f7d332f4add1d6c7b55feb00d7ba6f80045c352b9ce32fbade724eb",
  "/js/language/wrong-review.js?release=20261109-aeris-p07-production-r2": "d77ec0816756cf4a65a7c4f804ea80d6c17aee4757524bcee7ba2aca558c3a25",
  "/js/language/wrong-review-sync.js?release=20261109-aeris-p07-production-r2": "231cb66e91aa6909157253d064b0241fe9cf3e6c841b95c1b41a2ba0657f5997"
});
const PUBLICATION_HASH = "efeb501ab7ab59b008ab7cc978fc448414a2ec69e44772ffd1f10e549920f4f3";
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
      // A previous worker can finish asynchronous requests after activation.
      // Its legacy CACHE writes must never reach this immutable publication.
      if (await publicationCache()) { await self.skipWaiting(); return; }
      const stagingName = PUBLICATION_CACHE + '-installing';
      const staging = await caches.open(stagingName);
      let createdPublication = false, createdCompatibility = false;
      try {
        let next = 0;
        const results = await Promise.allSettled(Array.from(
          { length: Math.min(INSTALL_CONCURRENCY, REQUIRED_SHELL.length) }, async () => {
            while (next < REQUIRED_SHELL.length) {
              const asset = REQUIRED_SHELL[next++];
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
        if (!self.registration?.active && !(await caches.keys()).includes(CACHE)) {
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
  const current = !versioned || version === RELEASE;
  const selected = current ? PUBLICATION_CACHE : `${OWNED_PREFIX}${version}-es-modules`;
  const keys = await caches.keys();
  if (keys.includes(selected)) {
    const cache = current ? await publicationCache() : await caches.open(selected);
    const cached = cache && await cache.match(request);
    if (cached) return cached;
  }
  if (current && REQUIRED_SHELL.includes(url.pathname + url.search))
    return new Response('The complete publication is unavailable; reconnect and reload.', { status: 503 });
  if (versioned && version !== RELEASE && /\.(?:m?js|css)$/.test(url.pathname)) {
    // A newer HTML document may be served before its worker activates. Its
    // observed release can use network assets; do not cache an incomplete
    // future shell. Unobserved old cache misses still fail closed.
    if (observedShellReleases.has(version))
      return fetchWithDeadline(request, ASSET_TIMEOUT_MS, { cache: 'no-store' });
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
          return (cache && await cache.match("/index.html")) || new Response("网络暂时不可用，请联网后刷新。", {
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
