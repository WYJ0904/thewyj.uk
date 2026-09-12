import assert from "node:assert/strict";

import {
  CAPABILITY,
  CapabilityError,
  capabilityProblems,
  classifyCapabilities,
  detectCapabilities,
  fallbackRandomId,
  randomId,
  requireCapability,
} from "../js/core/capabilities.js";

// 1. A modern browser reports every capability the app uses.
const modernGlobal = {
  crypto: {
    randomUUID: () => "11111111-2222-4333-8444-555555555555",
    subtle: { digest: async () => new ArrayBuffer(32) },
    getRandomValues: (bytes) => bytes.fill(7),
  },
  localStorage: storage(),
  sessionStorage: storage(),
  navigator: { clipboard: { writeText: () => {} }, serviceWorker: {} },
  document: {
    createElement: (tag) => (tag === "a" ? { download: "" } : { click: () => {} }),
  },
  File: function File() {},
  Blob: function Blob() {},
  ArrayBuffer,
  TextEncoder: function TextEncoder() {},
  TextDecoder: function TextDecoder() {},
  Audio: function Audio() {},
  speechSynthesis: { speak: () => {} },
};

function storage() {
  const map = new Map();
  return { setItem: (k, v) => map.set(k, v), getItem: (k) => map.get(k) ?? null, removeItem: (k) => map.delete(k) };
}

const modern = detectCapabilities(modernGlobal);
assert.ok(Object.values(modern).every(Boolean), "every modern capability must be detected");
assert.deepEqual(capabilityProblems(modern), [], "a modern browser has no blocking capabilities");
assert.equal(randomId(modernGlobal), "11111111-2222-4333-8444-555555555555");

// 2. An old WebView: no randomUUID / subtle / storage / audio. The audit must
// describe the real consequences instead of throwing later.
const legacyGlobal = {
  crypto: { getRandomValues: (bytes) => bytes.fill(9) },
  navigator: {},
  document: { createElement: () => ({}) },
};
const legacy = detectCapabilities(legacyGlobal);
assert.equal(legacy.cryptoRandomUUID, false);
assert.equal(legacy.cryptoSubtle, false);
assert.equal(legacy.audio, false);
const legacyClassification = classifyCapabilities(legacy);
assert.equal(legacyClassification.cryptoRandomUUID, CAPABILITY.FALLBACK_AVAILABLE);
assert.equal(legacyClassification.cryptoSubtle, CAPABILITY.UNSUPPORTED);
// No audio element and no speech engine at all: dictation cannot produce sound
// in any path, so the runtime must surface a blocking capability message
// instead of pretending a fallback exists.
assert.equal(legacyClassification.audio, CAPABILITY.UNSUPPORTED);
const messages = capabilityProblems(legacy);
assert.ok(messages.some((message) => /WebCrypto/.test(message)), "WebCrypto gap must be explained");
assert.ok(messages.some((message) => /本地存储/.test(message)), "storage gap must be explained");
assert.ok(messages.some((message) => /TextEncoder/.test(message)), "text codec gap must be explained");
assert.ok(messages.some((message) => /音频/.test(message)), "a runtime that cannot speak must say so");

// With a device engine available, the missing audio element is still only a
// fallback situation - dictation keeps working offline.
const speechOnly = detectCapabilities({
  speechSynthesis: { speak: () => {} },
  navigator: {},
  document: { createElement: () => ({}) },
});
assert.equal(speechOnly.audio, false);
assert.equal(speechOnly.speechFallback, true);
assert.equal(classifyCapabilities(speechOnly).audio, CAPABILITY.FALLBACK_AVAILABLE);

// 3. Fallback id generation still yields a unique-looking id without randomUUID.
const fallback = fallbackRandomId(legacyGlobal);
assert.match(fallback, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.equal(randomId(legacyGlobal), fallback);

// 4. requireCapability throws a user-facing error (never a silent failure) and
//    accepts the documented fallbacks.
assert.equal(requireCapability("cryptoRandomUUID", legacyGlobal), true);
assert.throws(
  () => requireCapability("cryptoSubtle", legacyGlobal),
  (error) => error instanceof CapabilityError && /WebCrypto/.test(error.userMessage),
);
assert.equal(requireCapability("audio", modernGlobal), true);

console.log("Capability audit checks passed (detection, classification, fallbacks, user-facing errors).");
