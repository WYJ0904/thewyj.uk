export const APP_ROUTE_MANIFEST = Object.freeze([
  "/", "/login", "/register", "/trial", "/changelog", "/select", "/language",
  "/language/english", "/language/japanese", "/tools", "/tools/:tool_id", "/tools/workflows",
  "/finance", "/account", "/recharge", "/admin", "/share/text/:id", "/share/file/:id",
  "/share/clipboard/:code", "/share/qr/:id", "/share/room/:id",
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

// One document and one route renderer. Rapid native taps coalesce to the latest
// destination while an existing permission/data request finishes.
export function createNativeNavigation({ origin, pushRoute, renderRoute, beforeNavigate = () => {}, onError = () => {} }) {
  let pending = null;
  let running = null;
  function navigate(value) {
    const route = nativeAppRoute(value, origin);
    if (!route) return Promise.resolve(false);
    pending = route;
    if (!running) {
      running = Promise.resolve().then(async () => {
        while (pending !== null) {
          const target = pending;
          pending = null;
          beforeNavigate();
          pushRoute(target);
          try { await renderRoute(); } catch (error) { onError(error); }
        }
        return true;
      }).finally(() => { running = null; });
    }
    return running;
  }
  return Object.freeze({ navigate });
}
