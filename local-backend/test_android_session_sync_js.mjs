import assert from "node:assert/strict";

const history = [];
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  location: {
    get href() { return history[history.length - 1] || ""; },
    set href(v) { history.push(String(v)); },
  },
};
globalThis.location = globalThis.window.location;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { userAgent: "Mozilla/5.0 Android/36 thewyj-android/1.3.38" },
});

const {
  queueNativeBridgeNavigation,
  requestNativeSessionRefresh,
  requestNativeLogout,
} = await import("../js/core/session.js");

// Immediate first dispatch + deferred different-channel bridge prevents thewyj://theme
// from cancelling an in-flight thewyj://session/refresh navigation in WebView.
assert.equal(requestNativeSessionRefresh("authentication_required"), true);
assert.equal(queueNativeBridgeNavigation("thewyj://theme/dark"), true);
assert.deepEqual(history, ["thewyj://session/refresh?reason=authentication_required"]);

await new Promise((resolve) => setTimeout(resolve, 110));
assert.deepEqual(history, [
  "thewyj://session/refresh?reason=authentication_required",
  "thewyj://theme/dark",
]);

// Explicit logout preempts a pending (deferred) non-logout queued navigation.
assert.equal(requestNativeSessionRefresh("retry"), true);
assert.equal(queueNativeBridgeNavigation("thewyj://theme/light"), true);
history.length = 0;
assert.equal(requestNativeLogout(), true);
assert.deepEqual(history, ["thewyj://session/logout"]);

await new Promise((resolve) => setTimeout(resolve, 110));
assert.deepEqual(history, ["thewyj://session/logout"]);

console.log("Android native bridge queue regression test passed.");
