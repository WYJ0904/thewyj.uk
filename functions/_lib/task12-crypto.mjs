export const PASSWORD_HASH_PREFIX = "pbkdf2_sha256";
export const PASSWORD_HASH_ITERATIONS = 310_000;
export const SESSION_TOKEN_PREFIX = "sha256";

const MIN_ACCEPTED_ITERATIONS = 100_000;
const MAX_ACCEPTED_ITERATIONS = 2_000_000;
const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(text + "=".repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) {
    return false;
  }
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(left, right);
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function parsePasswordHash(encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_PREFIX) return null;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < MIN_ACCEPTED_ITERATIONS || iterations > MAX_ACCEPTED_ITERATIONS) {
    return null;
  }
  try {
    const salt = base64UrlToBytes(parts[2]);
    const digest = base64UrlToBytes(parts[3]);
    if (salt.length < 8 || salt.length > 64 || digest.length !== 32) return null;
    return { iterations, salt, digest };
  } catch (_) {
    return null;
  }
}

async function deriveSecret(secret, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret || "")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashSecret(secret, iterations = PASSWORD_HASH_ITERATIONS) {
  if (!Number.isInteger(iterations) || iterations < PASSWORD_HASH_ITERATIONS || iterations > MAX_ACCEPTED_ITERATIONS) {
    throw new TypeError("Unsupported PBKDF2 iteration count");
  }
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const digest = await deriveSecret(secret, salt, iterations);
  return `${PASSWORD_HASH_PREFIX}$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(digest)}`;
}

export async function verifySecret(secret, encoded) {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return { valid: false, needsUpgrade: false };
  const actual = await deriveSecret(secret, parsed.salt, parsed.iterations);
  return {
    valid: constantTimeEqual(actual, parsed.digest),
    needsUpgrade: parsed.iterations < PASSWORD_HASH_ITERATIONS,
  };
}

export async function consumeVerificationWork(secret) {
  await deriveSecret(secret, new Uint8Array(16), PASSWORD_HASH_ITERATIONS);
}

export async function sessionStorageKey(token) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(token || "")));
  return `${SESSION_TOKEN_PREFIX}$${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export const __testing = {
  base64UrlToBytes,
  bytesToBase64Url,
  constantTimeEqual,
  deriveSecret,
};
