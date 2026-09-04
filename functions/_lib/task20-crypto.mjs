import { sha256Hex } from "./cloudflare-foundation.mjs";

const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function task20DeviceDigest(deviceId) {
  return await sha256Hex(`task20-device\u0000${deviceId}`);
}

export async function deriveTask20Token(secret, purpose, sessionId, rotationCounter) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`thewyj-task20-v1\u0000${purpose}\u0000${sessionId}\u0000${rotationCounter}`),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export const __testing = { bytesToBase64Url };
