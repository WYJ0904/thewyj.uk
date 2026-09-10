export const APP_ROUTE_MANIFEST = Object.freeze([
  "/", "/login", "/register", "/trial", "/changelog", "/download", "/select", "/language",
  "/language/english", "/language/japanese", "/tools", "/tools/:tool_id", "/tools/workflows",
  "/finance", "/account", "/recharge", "/admin", "/share/text/:id", "/share/file/:id",
  "/share/clipboard/:code", "/share/qr/:id", "/share/room/:id", "/transfer",
]);

export function createRouter({ onRouteChange = () => {} } = {}) {
  function pushRoute(path, replace = false) {
    const target = String(path || "/");
    if (location.pathname === target) return;
    history[replace ? "replaceState" : "pushState"]({}, "", target);
    onRouteChange(target);
  }

  return Object.freeze({ pushRoute });
}

export function nativeAppRoute(value, origin) {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) return null;
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password) return null;
  const known = APP_ROUTE_MANIFEST.some((route) => {
    const pattern = route.replace(/:[a-z_]+/g, "[A-Za-z0-9_-]+");
    return new RegExp(`^${pattern}$`).test(url.pathname);
  });
  return known ? url.pathname + url.search + url.hash : null;
}

// One document and one route renderer. Rapid native taps coalesce to the
// latest destination: the URL and the route surface are applied immediately,
// while data hydration for every visited tab continues in the background and
// the router generation guard drops any older render that finishes late.
export function createNativeNavigation({ origin, pushRoute, renderRoute, beforeNavigate = () => {}, onError = () => {} }) {
  let pending = null;
  let running = false;
  let current = Promise.resolve(true);

  function drain() {
    try {
      while (pending !== null) {
        const target = pending;
        pending = null;
        beforeNavigate();
        // The URL and the route surface switch synchronously here; data
        // hydration continues in the background so the next tap is never
        // blocked by a slow page.
        pushRoute(target);
        Promise.resolve()
          .then(() => renderRoute())
          .catch((error) => onError(error));
      }
      return true;
    } finally {
      running = false;
      // A tap that arrived while the last iteration was finishing must not be
      // dropped: re-check the queue once more before going idle.
      if (pending !== null) {
        running = true;
        current = Promise.resolve().then(drain);
      }
    }
  }

  function navigate(value) {
    const route = nativeAppRoute(value, origin);
    if (!route) return Promise.resolve(false);
    pending = route;
    if (!running) {
      running = true;
      current = Promise.resolve().then(drain);
    }
    return current;
  }
  return Object.freeze({ navigate });
}
