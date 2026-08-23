import {
  hashSecret,
  parsePasswordHash,
  verifySecret,
} from "./task12-crypto.mjs";
import { Task14Error } from "./task14-model.mjs";

const encoder = new TextEncoder();
const MIN_SECRET_BYTES = 32;

function secretBytes(secret) {
  const bytes = encoder.encode(String(secret || ""));
  if (bytes.byteLength < MIN_SECRET_BYTES) {
    throw new Task14Error("临时分享加密 Secret 尚未配置", 503, "task14_secret_unavailable", true);
  }
  return bytes;
}

function constantTimeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(left, right);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function verifyLegacyPbkdf2(secret, encoded) {
  const parsed = parsePasswordHash(encoded);
  if (!parsed || parsed.scheme !== "pbkdf2_sha256") return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(String(secret || "")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: parsed.salt, iterations: parsed.iterations }, key, 256,
  );
  return constantTimeEqual(new Uint8Array(bits), parsed.digest);
}

export function temporarySecretConfigured(secret) {
  return encoder.encode(String(secret || "")).byteLength >= MIN_SECRET_BYTES;
}

export async function hashTemporaryPassword(password, secret) {
  const value = String(password || "");
  if (!value) return "";
  if (value.length > 128) throw new Task14Error("访问密码不能超过 128 个字符", 400, "temporary_password_invalid");
  secretBytes(secret);
  return await hashSecret(value, secret);
}

export async function verifyTemporaryPassword(password, encoded, secret) {
  const hash = String(encoded || "");
  if (!hash) return true;
  secretBytes(secret);
  const checked = await verifySecret(String(password || ""), hash, secret);
  if (checked.valid) return true;
  if (checked.needsLegacyVerification) return await verifyLegacyPbkdf2(password, hash);
  return false;
}

async function importHmacKey(secret) {
  return await crypto.subtle.importKey(
    "raw", secretBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
}

export async function hmacHex(value, secret, context = "task14") {
  const signature = await crypto.subtle.sign(
    "HMAC", await importHmacKey(secret), encoder.encode(`${context}\0${String(value || "")}`),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function connectionCodeDigest(code, secret) {
  const value = String(code || "").trim();
  if (!/^\d{6}$/.test(value)) throw new Task14Error("连接码必须是六位数字", 400, "clipboard_code_invalid");
  return await hmacHex(value, secret, "task14-clipboard-v1");
}

export async function legacyConnectionCodeDigest(code, secret) {
  const value = String(code || "").trim();
  if (!/^\d{6}$/.test(value)) throw new Task14Error("连接码必须是六位数字", 400, "clipboard_code_invalid");
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function grantTokenDigest(token) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(token || "")));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const __testing = Object.freeze({ constantTimeEqual, secretBytes, verifyLegacyPbkdf2 });
