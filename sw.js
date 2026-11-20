const CACHE = "wyj-shell-20261119-aeris-i03-preview-es-modules";
const RELEASE = "20261119-aeris-i03-preview";
const OWNED_PREFIX = "wyj-shell-";
const observedShellReleases = new Set();
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
// Do not spend every resource's deadline waiting in the browser connection queue.
const INSTALL_CONCURRENCY = 6;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?release=20261119-aeris-i03-preview",
  "/product-ui.css?release=20261119-aeris-i03-preview",
  "/design-system.css?release=20261119-aeris-i03-preview",
  "/public-experience.css?release=20261119-aeris-i03-preview",
  "/workspace-experience.css?release=20261119-aeris-i03-preview",
  "/spatial-experience.css?release=20261119-aeris-i03-preview",
  "/changelog.js?release=20261119-aeris-i03-preview",
  "/learning-sync.js?release=20261119-aeris-i03-preview",
  "/app.js?release=20261119-aeris-i03-preview",
  "/js/core/api.js?release=20261119-aeris-i03-preview",
  "/js/core/changelog.js?release=20261119-aeris-i03-preview",
  "/js/core/capabilities.js?release=20261119-aeris-i03-preview",
  "/js/core/config.js?release=20261119-aeris-i03-preview",
  "/js/core/router.js?release=20261119-aeris-i03-preview",
  "/js/core/session.js?release=20261119-aeris-i03-preview",
  "/js/core/storage.js?release=20261119-aeris-i03-preview",
  "/js/core/ui.js?release=20261119-aeris-i03-preview",
  "/js/core/design-system.js?release=20261119-aeris-i03-preview",
  "/js/core/public-ui-policy.js?release=20261119-aeris-i03-preview",
  "/js/core/download.js?release=20261119-aeris-i03-preview",
  "/js/core/perf.js?release=20261119-aeris-i03-preview",
  "/js/core/motion.js?release=20261119-aeris-i03-preview",
  "/js/core/keyed-list.js?release=20261119-aeris-i03-preview",
  "/js/core/public-experience.js?release=20261119-aeris-i03-preview",
  "/favicon.ico?release=20261119-aeris-i03-preview",
  "/assets/brand/favicon-32.png?release=20261119-aeris-i03-preview",
  "/assets/brand/apple-touch-icon.png?release=20261119-aeris-i03-preview",
  "/assets/brand/aeris-maskable-512.png?release=20261119-aeris-i03-preview",
  "/assets/brand/aeris-lockup.png?release=20261119-aeris-i03-preview",
  "/icon-192.png?release=20261119-aeris-i03-preview",
  "/icon-512.png?release=20261119-aeris-i03-preview",
  "/js/finance/app.js?release=20261119-aeris-i03-preview",
  "/js/finance/candidates.js?release=20261119-aeris-i03-preview",
  "/js/finance/disclosure.js?release=20261119-aeris-i03-preview",
  "/js/finance/notification-ledger.js?release=20261119-aeris-i03-preview",
  "/js/transfer/app.js?release=20261119-aeris-i03-preview",
  "/js/transfer/updates.js?release=20261119-aeris-i03-preview",
  "/js/language/achievements.js?release=20261119-aeris-i03-preview",
  "/js/language/history.js?release=20261119-aeris-i03-preview",
  "/js/language/pdf.js?release=20261119-aeris-i03-preview",
  "/js/language/mastery.js?release=20261119-aeris-i03-preview",
  "/js/language/mastery-state.js?release=20261119-aeris-i03-preview",
  "/js/language/mastery-journal.js?release=20261119-aeris-i03-preview",
  "/js/language/quiz.js?release=20261119-aeris-i03-preview",
  "/js/language/speech.js?release=20261119-aeris-i03-preview",
  "/js/language/speech-rate.js?release=20261119-aeris-i03-preview",
  "/js/language/sync-adapter.js?release=20261119-aeris-i03-preview",
  "/js/language/wrong-book.js?release=20261119-aeris-i03-preview",
  "/js/membership/account.js?release=20261119-aeris-i03-preview",
  "/js/membership/plans.js?release=20261119-aeris-i03-preview",
  "/js/membership/recharge.js?release=20261119-aeris-i03-preview",
  "/js/admin/formatters.js?release=20261119-aeris-i03-preview",
  "/tools.js?release=20261119-aeris-i03-preview",
  "/js/tools/catalog.js?release=20261119-aeris-i03-preview",
  "/js/tools/file.js?release=20261119-aeris-i03-preview",
  "/js/tools/image.js?release=20261119-aeris-i03-preview",
  "/js/tools/random.js?release=20261119-aeris-i03-preview",
  "/js/tools/runner.js?release=20261119-aeris-i03-preview",
  "/js/tools/temporary.js?release=20261119-aeris-i03-preview",
  "/js/tools/text.js?release=20261119-aeris-i03-preview",
  "/workflows.js?release=20261119-aeris-i03-preview",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?release=20261119-aeris-i03-preview",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?release=20261119-aeris-i03-preview", "/js/core/feature-console.js?release=20261119-aeris-i03-preview");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?release=20261119-aeris-i03-preview");
CORE_SHELL.push("/js/core/home-widget-layout.js?release=20261119-aeris-i03-preview");
CORE_SHELL.push("/js/core/home-widgets.js?release=20261119-aeris-i03-preview", "/js/core/home-widget-data.js?release=20261119-aeris-i03-preview");
CORE_SHELL.push("/js/transfer/upload-part.js?release=20261119-aeris-i03-preview");
CORE_SHELL.push("/js/core/lazy-controller.js?release=20261119-aeris-i03-preview", "/js/core/parked-rows.js?release=20261119-aeris-i03-preview", "/js/core/dashboard.js?release=20261119-aeris-i03-preview", "/js/finance/format.js?release=20261119-aeris-i03-preview", "/js/tools/digest-worker.js?release=20261119-aeris-i03-preview");

// Keep the independently fingerprinted 81-resource RC5 shell intact. Task26
// extends its required graph; these imports are never best-effort artwork.
const TASK26_SHELL = [
  "/js/language/wrong-review.js?release=20261119-aeris-i03-preview",
  "/js/language/wrong-review-sync.js?release=20261119-aeris-i03-preview",
];
// Finance formatting statically imports money.js. A fresh installation must
// include it before publishing HTML, while retaining the original RC5 layer.
const FINANCE_SHELL = ["/js/finance/money.js?release=20261119-aeris-i03-preview"];
const TASK27_SHELL = ["/js/account/security-center.js?release=20261119-aeris-i03-preview", "/js/account/policy-page.js?release=20261119-aeris-i03-preview", "/js/account/policy-version.js?release=20261119-aeris-i03-preview", "/js/account/password-policy.js?release=20261119-aeris-i03-preview", "/js/account/password-fields.js?release=20261119-aeris-i03-preview"];
const REQUIRED_SHELL = [...CORE_SHELL, ...TASK26_SHELL, ...FINANCE_SHELL, ...TASK27_SHELL];
const INSTALL_SHELL = REQUIRED_SHELL;
// Canonical UTF-8 hashes bind the current S0 shell plus Task27 additions.
const TASK26_INTEGRITY = Object.freeze({
  "/": "cfe4489aeea701469c94aaf18221c55a755c41668d4b1f6959e6e4b7d6dfc39f",
  "/index.html": "cfe4489aeea701469c94aaf18221c55a755c41668d4b1f6959e6e4b7d6dfc39f",
  "/app.js?release=20261119-aeris-i03-preview": "08c4bdd7d10b028ba55bc7161aa32054ee4256e518bb201687f6c17879150e69",
  "/learning-sync.js?release=20261119-aeris-i03-preview": "74ced24b8dab7c8ad16dc6b4b68ff81a89e968d18a607bbba6b066a8bee7727d",
  "/product-ui.css?release=20261119-aeris-i03-preview": "a2598656d43f2c83b613835d6f97496259f779b9be8ea10a40e538dd6f8e427e",
  "/js/language/mastery.js?release=20261119-aeris-i03-preview": "4a7d1569df211aac958e4c8ab83904e82926ba4258b9d03c5c266aeda331c7a7",
  "/js/language/quiz.js?release=20261119-aeris-i03-preview": "cd4546dc7e48876bac503c49e259267bde99b79ab0cf5565cb917c1ed031e3b0",
  "/js/language/wrong-book.js?release=20261119-aeris-i03-preview": "658e93029afc5269ec5b5b02b47043fdd385d297a7e67c890a5f67862be80049",
  "/js/language/wrong-review.js?release=20261119-aeris-i03-preview": "d77ec0816756cf4a65a7c4f804ea80d6c17aee4757524bcee7ba2aca558c3a25",
  "/js/language/wrong-review-sync.js?release=20261119-aeris-i03-preview": "a1dc03f8f1d51d67ef93d73412de2b31d62a4ad312f3c5958195c153391444fa",
  "/js/finance/money.js?release=20261119-aeris-i03-preview": "f1172d6c74835784bd1a6629d48c1884f46c14d9825f9f8308a07d3542214277",
  "/js/language/speech.js?release=20261119-aeris-i03-preview": "a6c7ab6b03d7e8499abef932670e18e013f0e65cb1a4cf6192e67fe50541bf6c",
  "/js/account/security-center.js?release=20261119-aeris-i03-preview": "d7b43477e4f07cbbbdeb02feedc5f072f8baa6f7d396df072d28dc85f2813d67",
  "/js/account/policy-page.js?release=20261119-aeris-i03-preview": "7d54511a956995afc6065f27ccac275dfb6657b3040f51d51ea4d8b8334562da",
  "/js/core/api.js?release=20261119-aeris-i03-preview": "bb4ef39dcb1ebaf9c204405c24f2756287879df88faaca54ef21cfd09cea4580",
  "/js/core/router.js?release=20261119-aeris-i03-preview": "67ec8601f63fb4bfc732f556723a1c4ce1258dbb41c6cfcdec3bfa118522779d",
  "/js/account/policy-version.js?release=20261119-aeris-i03-preview": "601fb007c886c38a71c45afc216e79a9923c86ccd7883c26316e638767c8323e",
  "/js/transfer/app.js?release=20261119-aeris-i03-preview": "297656b83c16175f461743bc147c16c3fc6b8ccce8505213c940b388fe577462",
  "/js/account/password-policy.js?release=20261119-aeris-i03-preview": "48fd3d494120682e5b8baac8c73fb6ff68714cbc89d567318e9ea39549c80c56",
  "/js/account/password-fields.js?release=20261119-aeris-i03-preview": "2454b6113bbd45df46898c3fa189af09c83df2b9bd5d69460ec81d75e31c5a37"
});
const PUBLICATION_HASH = "7d1399360cb95bbb6c238e18d58cc2cd7b3091e4c301df8a4f29f4e1a46e2a5e";
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
