const CACHE = "wyj-shell-20261116-aeris-task27-release-es-modules";
const RELEASE = "20261116-aeris-task27-release";
const OWNED_PREFIX = "wyj-shell-";
const observedShellReleases = new Set();
const NAVIGATION_TIMEOUT_MS = 5000;
const ASSET_TIMEOUT_MS = 10000;
// Do not spend every resource's deadline waiting in the browser connection queue.
const INSTALL_CONCURRENCY = 6;
const CORE_SHELL = [
  "/",
  "/index.html",
  "/styles.css?release=20261116-aeris-task27-release",
  "/product-ui.css?release=20261116-aeris-task27-release",
  "/design-system.css?release=20261116-aeris-task27-release",
  "/public-experience.css?release=20261116-aeris-task27-release",
  "/workspace-experience.css?release=20261116-aeris-task27-release",
  "/spatial-experience.css?release=20261116-aeris-task27-release",
  "/changelog.js?release=20261116-aeris-task27-release",
  "/learning-sync.js?release=20261116-aeris-task27-release",
  "/app.js?release=20261116-aeris-task27-release",
  "/js/core/api.js?release=20261116-aeris-task27-release",
  "/js/core/changelog.js?release=20261116-aeris-task27-release",
  "/js/core/capabilities.js?release=20261116-aeris-task27-release",
  "/js/core/config.js?release=20261116-aeris-task27-release",
  "/js/core/router.js?release=20261116-aeris-task27-release",
  "/js/core/session.js?release=20261116-aeris-task27-release",
  "/js/core/storage.js?release=20261116-aeris-task27-release",
  "/js/core/ui.js?release=20261116-aeris-task27-release",
  "/js/core/design-system.js?release=20261116-aeris-task27-release",
  "/js/core/public-ui-policy.js?release=20261116-aeris-task27-release",
  "/js/core/download.js?release=20261116-aeris-task27-release",
  "/js/core/perf.js?release=20261116-aeris-task27-release",
  "/js/core/motion.js?release=20261116-aeris-task27-release",
  "/js/core/keyed-list.js?release=20261116-aeris-task27-release",
  "/js/core/public-experience.js?release=20261116-aeris-task27-release",
  "/favicon.ico?release=20261116-aeris-task27-release",
  "/assets/brand/favicon-32.png?release=20261116-aeris-task27-release",
  "/assets/brand/apple-touch-icon.png?release=20261116-aeris-task27-release",
  "/assets/brand/aeris-maskable-512.png?release=20261116-aeris-task27-release",
  "/assets/brand/aeris-lockup.png?release=20261116-aeris-task27-release",
  "/icon-192.png?release=20261116-aeris-task27-release",
  "/icon-512.png?release=20261116-aeris-task27-release",
  "/js/finance/app.js?release=20261116-aeris-task27-release",
  "/js/finance/candidates.js?release=20261116-aeris-task27-release",
  "/js/finance/disclosure.js?release=20261116-aeris-task27-release",
  "/js/finance/notification-ledger.js?release=20261116-aeris-task27-release",
  "/js/transfer/app.js?release=20261116-aeris-task27-release",
  "/js/transfer/updates.js?release=20261116-aeris-task27-release",
  "/js/language/achievements.js?release=20261116-aeris-task27-release",
  "/js/language/history.js?release=20261116-aeris-task27-release",
  "/js/language/pdf.js?release=20261116-aeris-task27-release",
  "/js/language/mastery.js?release=20261116-aeris-task27-release",
  "/js/language/mastery-state.js?release=20261116-aeris-task27-release",
  "/js/language/mastery-journal.js?release=20261116-aeris-task27-release",
  "/js/language/quiz.js?release=20261116-aeris-task27-release",
  "/js/language/speech.js?release=20261116-aeris-task27-release",
  "/js/language/speech-rate.js?release=20261116-aeris-task27-release",
  "/js/language/sync-adapter.js?release=20261116-aeris-task27-release",
  "/js/language/wrong-book.js?release=20261116-aeris-task27-release",
  "/js/membership/account.js?release=20261116-aeris-task27-release",
  "/js/membership/plans.js?release=20261116-aeris-task27-release",
  "/js/membership/recharge.js?release=20261116-aeris-task27-release",
  "/js/admin/formatters.js?release=20261116-aeris-task27-release",
  "/tools.js?release=20261116-aeris-task27-release",
  "/js/tools/catalog.js?release=20261116-aeris-task27-release",
  "/js/tools/file.js?release=20261116-aeris-task27-release",
  "/js/tools/image.js?release=20261116-aeris-task27-release",
  "/js/tools/random.js?release=20261116-aeris-task27-release",
  "/js/tools/runner.js?release=20261116-aeris-task27-release",
  "/js/tools/temporary.js?release=20261116-aeris-task27-release",
  "/js/tools/text.js?release=20261116-aeris-task27-release",
  "/workflows.js?release=20261116-aeris-task27-release",
  "/vendor/qrcode.js?v=2.0.4",
  "/vendor/opencc-st-characters.txt",
  "/vendor/opencc-ts-characters.txt",
  "/manifest.webmanifest?release=20261116-aeris-task27-release",
  "/icon-192.png",
  "/icon-512.png"
];
CORE_SHELL.push("/js/core/feature-flags.js?release=20261116-aeris-task27-release", "/js/core/feature-console.js?release=20261116-aeris-task27-release");
const OPTIONAL_BRAND_ASSETS = ["/assets/logo.png"];
CORE_SHELL.push("/js/core/startup.js?release=20261116-aeris-task27-release");
CORE_SHELL.push("/js/core/home-widget-layout.js?release=20261116-aeris-task27-release");
CORE_SHELL.push("/js/core/home-widgets.js?release=20261116-aeris-task27-release", "/js/core/home-widget-data.js?release=20261116-aeris-task27-release");
CORE_SHELL.push("/js/transfer/upload-part.js?release=20261116-aeris-task27-release");
CORE_SHELL.push("/js/core/lazy-controller.js?release=20261116-aeris-task27-release", "/js/core/parked-rows.js?release=20261116-aeris-task27-release", "/js/core/dashboard.js?release=20261116-aeris-task27-release", "/js/finance/format.js?release=20261116-aeris-task27-release", "/js/tools/digest-worker.js?release=20261116-aeris-task27-release");

// Keep the independently fingerprinted 81-resource RC5 shell intact. Task26
// extends its required graph; these imports are never best-effort artwork.
const TASK26_SHELL = [
  "/js/language/wrong-review.js?release=20261116-aeris-task27-release",
  "/js/language/wrong-review-sync.js?release=20261116-aeris-task27-release",
];
// Finance formatting statically imports money.js. A fresh installation must
// include it before publishing HTML, while retaining the original RC5 layer.
const FINANCE_SHELL = ["/js/finance/money.js?release=20261116-aeris-task27-release"];
const TASK27_SHELL = ["/js/account/security-center.js?release=20261116-aeris-task27-release", "/js/account/policy-page.js?release=20261116-aeris-task27-release", "/js/account/policy-version.js?release=20261116-aeris-task27-release", "/js/account/password-policy.js?release=20261116-aeris-task27-release", "/js/account/password-fields.js?release=20261116-aeris-task27-release"];
const REQUIRED_SHELL = [...CORE_SHELL, ...TASK26_SHELL, ...FINANCE_SHELL, ...TASK27_SHELL];
// Canonical UTF-8 hashes bind the current S0 shell plus Task27 additions.
const TASK26_INTEGRITY = Object.freeze({
  "/": "9d12eddb61a18db053367f3d01b2bc3b07266d3061c1285c0a9bef7390cb7bf0",
  "/index.html": "9d12eddb61a18db053367f3d01b2bc3b07266d3061c1285c0a9bef7390cb7bf0",
  "/app.js?release=20261116-aeris-task27-release": "f1e5d5b8d9a1179990723f40abbda3b105ac5e686faf23b36f0be93f88e2a08c",
  "/learning-sync.js?release=20261116-aeris-task27-release": "74ced24b8dab7c8ad16dc6b4b68ff81a89e968d18a607bbba6b066a8bee7727d",
  "/product-ui.css?release=20261116-aeris-task27-release": "752cbf9388843818974e19597ea2bb771bf8689d655e4c6efc59286aca8834de",
  "/js/language/mastery.js?release=20261116-aeris-task27-release": "38ce736bcd7d148bc24b52d28ed58595f0a22637b9d3e91f613e4635c926eacc",
  "/js/language/quiz.js?release=20261116-aeris-task27-release": "cd4546dc7e48876bac503c49e259267bde99b79ab0cf5565cb917c1ed031e3b0",
  "/js/language/wrong-book.js?release=20261116-aeris-task27-release": "ebf8a40b0f34d16385d124aa9c2654aceef832fd836147e809c6af47e7834d93",
  "/js/language/wrong-review.js?release=20261116-aeris-task27-release": "d77ec0816756cf4a65a7c4f804ea80d6c17aee4757524bcee7ba2aca558c3a25",
  "/js/language/wrong-review-sync.js?release=20261116-aeris-task27-release": "ed7d63929dd073910fb0b47f959d0a0657f687602bae0ea7cd220e828b977689",
  "/js/finance/money.js?release=20261116-aeris-task27-release": "f1172d6c74835784bd1a6629d48c1884f46c14d9825f9f8308a07d3542214277",
  "/js/language/speech.js?release=20261116-aeris-task27-release": "a6c7ab6b03d7e8499abef932670e18e013f0e65cb1a4cf6192e67fe50541bf6c",
  "/js/account/security-center.js?release=20261116-aeris-task27-release": "e1dab849bf72868b1c531df5449bb8214a20358e0a65909ca6c54d29ceac75ab",
  "/js/account/policy-page.js?release=20261116-aeris-task27-release": "7d54511a956995afc6065f27ccac275dfb6657b3040f51d51ea4d8b8334562da",
  "/js/core/api.js?release=20261116-aeris-task27-release": "66edb5653a52ec5160de3d08eba54e198ae40400e56ca565840b58a852c3178f",
  "/js/core/router.js?release=20261116-aeris-task27-release": "382cf576cd3a5e65e5b6e7646c816f52e6efcb35bdf5851297c071230f1767f9",
  "/js/account/policy-version.js?release=20261116-aeris-task27-release": "601fb007c886c38a71c45afc216e79a9923c86ccd7883c26316e638767c8323e",
  "/js/transfer/app.js?release=20261116-aeris-task27-release": "b1a027dc49c3aa3eecc085d3ad7b526bb31095099b98d048e1a8f0a9fb6237ed",
  "/js/account/password-policy.js?release=20261116-aeris-task27-release": "48fd3d494120682e5b8baac8c73fb6ff68714cbc89d567318e9ea39549c80c56",
  "/js/account/password-fields.js?release=20261116-aeris-task27-release": "b59cfb731ae7cbf01a82967975f958d72dfd83af776cf54a8dd62fe6f8a6eb48"
});
const PUBLICATION_HASH = "ca84ae949d91ed8ea9f2941fb43c124b6688e9309dbe8c68202f5946d9873f58";
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
  if (current && REQUIRED_SHELL.includes(url.pathname + url.search))
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
