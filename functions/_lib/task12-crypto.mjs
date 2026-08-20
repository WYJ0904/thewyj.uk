export const PASSWORD_HASH_PREFIX = "pbkdf2_sha256";
export const CLOUD_PASSWORD_HASH_PREFIX = "pbkdf2_sha256_cf_v1";
export const PASSWORD_HASH_ITERATIONS = 310_000;
export const SESSION_TOKEN_PREFIX = "sha256";

const CLOUD_PBKDF2_STAGES = Object.freeze([100_000, 100_000, 100_000, 10_000]);
const CLOUD_KDF_CONTEXT = "wyj-task12-cloud-pbkdf2-v1";
const CLOUD_VERIFIER_CONTEXT = "wyj-task12-password-verifier-v1";
const MIN_ACCEPTED_ITERATIONS = 100_000;
const MAX_ACCEPTED_ITERATIONS = 2_000_000;
const MIN_PASSWORD_PEPPER_BYTES = 32;
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

function concatBytes(...values) {
  const arrays = values.map((value) => value instanceof Uint8Array ? value : new Uint8Array(value));
  const output = new Uint8Array(arrays.reduce((total, value) => total + value.length, 0));
  let offset = 0;
  for (const value of arrays) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
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

function passwordPepperBytes(pepper) {
  const value = encoder.encode(String(pepper || ""));
  if (!passwordPepperConfigured(pepper)) {
    throw new TypeError("Task 12 password pepper is not configured");
  }
  return value;
}

export function passwordPepperConfigured(pepper) {
  return encoder.encode(String(pepper || "")).length >= MIN_PASSWORD_PEPPER_BYTES;
}

export function parsePasswordHash(encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 4 || ![PASSWORD_HASH_PREFIX, CLOUD_PASSWORD_HASH_PREFIX].includes(parts[0])) return null;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < MIN_ACCEPTED_ITERATIONS || iterations > MAX_ACCEPTED_ITERATIONS) {
    return null;
  }
  if (parts[0] === CLOUD_PASSWORD_HASH_PREFIX && iterations !== PASSWORD_HASH_ITERATIONS) return null;
  try {
    const salt = base64UrlToBytes(parts[2]);
    const digest = base64UrlToBytes(parts[3]);
    if (salt.length < 8 || salt.length > 64 || digest.length !== 32) return null;
    return { scheme: parts[0], iterations, salt, digest };
  } catch (_) {
    return null;
  }
}

async function importPasswordKey(secret) {
  return await crypto.subtle.importKey(
    "raw", encoder.encode(String(secret || "")), "PBKDF2", false, ["deriveBits"],
  );
}

async function derivePbkdf2(key, salt, iterations) {
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256,
  );
  return new Uint8Array(bits);
}

async function deriveLegacySecret(secret, salt, iterations) {
  if (iterations > 100_000) return null;
  return await derivePbkdf2(await importPasswordKey(secret), salt, iterations);
}

async function deriveCloudSecret(secret, salt, pepper) {
  const passwordKey = await importPasswordKey(secret);
  let state = encoder.encode(CLOUD_KDF_CONTEXT);
  for (const [index, iterations] of CLOUD_PBKDF2_STAGES.entries()) {
    const stageSalt = concatBytes(salt, new Uint8Array([index]), state);
    state = await derivePbkdf2(passwordKey, stageSalt, iterations);
  }
  const pepperKey = await crypto.subtle.importKey(
    "raw", passwordPepperBytes(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const verifier = await crypto.subtle.sign(
    "HMAC", pepperKey, concatBytes(encoder.encode(CLOUD_VERIFIER_CONTEXT), salt, state),
  );
  return new Uint8Array(verifier);
}

export async function hashSecret(secret, pepper) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const digest = await deriveCloudSecret(secret, salt, pepper);
  return `${CLOUD_PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(digest)}`;
}

export async function verifySecret(secret, encoded, pepper) {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return { valid: false, needsUpgrade: false, needsLegacyVerification: false, scheme: "" };
  if (parsed.scheme === PASSWORD_HASH_PREFIX) {
    const actual = await deriveLegacySecret(secret, parsed.salt, parsed.iterations);
    if (!actual) {
      return {
        valid: false, needsUpgrade: false, needsLegacyVerification: true, scheme: parsed.scheme,
      };
    }
    return {
      valid: constantTimeEqual(actual, parsed.digest),
      needsUpgrade: true,
      needsLegacyVerification: false,
      scheme: parsed.scheme,
    };
  }
  const actual = await deriveCloudSecret(secret, parsed.salt, pepper);
  return {
    valid: constantTimeEqual(actual, parsed.digest),
    needsUpgrade: false,
    needsLegacyVerification: false,
    scheme: parsed.scheme,
  };
}

export async function consumeVerificationWork(secret, pepper) {
  await deriveCloudSecret(secret, new Uint8Array(16), pepper);
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
  CLOUD_PBKDF2_STAGES,
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  constantTimeEqual,
  deriveCloudSecret,
  deriveLegacySecret,
};
