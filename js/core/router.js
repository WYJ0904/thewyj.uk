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
