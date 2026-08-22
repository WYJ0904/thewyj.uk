const encoder = new TextEncoder();
const BRIDGE_VERSION = "1";
const BRIDGE_MAX_AGE_SECONDS = 45;
const BRIDGE_HEADERS = Object.freeze({
  version: "X-WYJ-Identity-Version",
  userId: "X-WYJ-Identity-User-ID",
  username: "X-WYJ-Identity-Username",
  issuedAt: "X-WYJ-Identity-Issued-At",
  requestId: "X-WYJ-Identity-Request-ID",
  signature: "X-WYJ-Identity-Signature",
});

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function canonicalIdentity({ userId, username, issuedAt, requestId, method, pathname }) {
  return [
    "wyj-legacy-identity-v1",
    String(issuedAt),
    String(requestId),
    String(method).toUpperCase(),
    String(pathname),
    String(userId),
    String(username),
  ].join("\n");
}

async function hmacSignature(secret, canonical) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical))));
}

export function bridgeConfigured(env = {}) {
  return String(env.WYJ_LEGACY_IDENTITY_BRIDGE_SECRET || "").length >= 32;
}

export async function addLegacyIdentityHeaders(headers, request, account, env = {}, requestId = "", now = Date.now()) {
  if (!bridgeConfigured(env)) throw new Error("Task 12 legacy identity bridge is not configured");
  const url = new URL(request.url);
  const issuedAt = Math.floor(now / 1000);
  const identity = {
    userId: String(account?.id || ""),
    username: String(account?.username || ""),
    issuedAt,
    requestId: String(requestId || crypto.randomUUID()),
    method: request.method,
    pathname: url.pathname,
  };
  if (!identity.userId || !identity.username) throw new Error("Task 12 account identity is incomplete");
  const signature = await hmacSignature(
    env.WYJ_LEGACY_IDENTITY_BRIDGE_SECRET,
    canonicalIdentity(identity),
  );
  headers.delete("X-Session-Token");
  headers.set(BRIDGE_HEADERS.version, BRIDGE_VERSION);
  headers.set(BRIDGE_HEADERS.userId, encodeURIComponent(identity.userId));
  headers.set(BRIDGE_HEADERS.username, encodeURIComponent(identity.username));
  headers.set(BRIDGE_HEADERS.issuedAt, String(identity.issuedAt));
  headers.set(BRIDGE_HEADERS.requestId, identity.requestId);
  headers.set(BRIDGE_HEADERS.signature, signature);
  return headers;
}

export const __testing = {
  BRIDGE_HEADERS,
  BRIDGE_MAX_AGE_SECONDS,
  BRIDGE_VERSION,
  canonicalIdentity,
  hmacSignature,
};
