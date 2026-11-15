import { Task12Error } from './task12-model.mjs';

const encoder = new TextEncoder();
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export function equalText(a, b) { return equalBytes(encoder.encode(a), encoder.encode(b)); }
export function randomBytes(length) { return crypto.getRandomValues(new Uint8Array(length)); }
export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unbase64url(value) {
  try { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
  catch (_) { throw new Task12Error('安全密钥配置无效', 503, 'task27_key_invalid'); }
}
export function base32(bytes) {
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}
export function unbase32(text) {
  let bits = 0, value = 0; const out = [];
  for (const c of text.replace(/=+$/, '').toUpperCase()) {
    const part = BASE32.indexOf(c);
    if (part < 0) throw new Task12Error('验证器配置无效', 503, 'task27_totp_invalid');
    value = (value << 5) | part; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
export function challengeSecret(env) {
  const value = String(env.WYJ_TASK27_CHALLENGE_SECRET || '');
  if (encoder.encode(value).length < 32) throw new Task12Error('账户安全服务尚未配置', 503, 'task27_secret_unavailable');
  return value;
}
export async function keyedDigest(env, purpose, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(challengeSecret(env)), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${purpose}\0${value}`))));
}
export function randomDigits() {
  const max = 0x100000000 - (0x100000000 % 1000000);
  let n;
  do { n = new DataView(randomBytes(4).buffer).getUint32(0); } while (n >= max);
  return String(n % 1000000).padStart(6, '0');
}
export function temporaryPassword() {
  const groups=['ABCDEFGHJKLMNPQRSTUVWXYZ','abcdefghijkmnopqrstuvwxyz','23456789','!@$%*-_'];
  const index=max=>{const limit=256-(256%max);let n;do{n=randomBytes(1)[0];}while(n>=limit);return n%max;};
  const alphabet=groups.join(''),result=groups.map(group=>group[index(group.length)]);
  while(result.length<20)result.push(alphabet[index(alphabet.length)]);
  for(let i=result.length-1;i>0;i--){const j=index(i+1);[result[i],result[j]]=[result[j],result[i]];}
  return result.join('');
}
export function totpUri(username,secret) {
  if(!/^[A-Z2-7]{32}$/.test(secret))throw new TypeError('Invalid TOTP enrollment secret');
  return `otpauth://totp/Aeris:${encodeURIComponent(username)}?secret=${secret}&issuer=Aeris&algorithm=SHA1&digits=6&period=30`;
}
async function importAesGcmKey(rawSecret, usages) {
  const bytes = unbase64url(String(rawSecret || '').trim());
  if (bytes.length !== 32) return null;
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, usages);
}
async function encryptionKey(env) {
  const key = await importAesGcmKey(env.WYJ_TASK27_TOTP_KEY, ['encrypt','decrypt']);
  if (!key) throw new Task12Error('验证器加密服务尚未配置', 503, 'task27_totp_key_unavailable');
  return key;
}
async function decryptionKeys(env) {
  const primary = await encryptionKey(env);
  const candidates = [primary];
  const fallbackRaw = String(env.WYJ_TASK27_TOTP_PREVIOUS_KEYS || '').trim();
  if (fallbackRaw) {
    for (const part of fallbackRaw.split(',')) {
      const key = await importAesGcmKey(part, ['decrypt']);
      if (key) candidates.push(key);
    }
  }
  return candidates;
}
export async function encryptTotp(env, userId, secret) {
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`aeris-task27:v1:${userId}`)}, await encryptionKey(env), encoder.encode(secret));
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(cipher))}`;
}
export async function decryptTotp(env, userId, encoded) {
  const [version, iv, ciphertext] = String(encoded).split('.');
  if (version !== 'v1' || !iv || !ciphertext) throw new Task12Error('验证器配置不可用', 503, 'task27_totp_key_unavailable');
  const keys = await decryptionKeys(env);
  const ivBytes = unbase64url(iv), cipherBytes = unbase64url(ciphertext);
  const additionalData = encoder.encode(`aeris-task27:v1:${userId}`);
  for (const key of keys) {
    try {
      return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:ivBytes,additionalData}, key, cipherBytes));
    } catch (_) { /* Try next configured rotation key before failing. */ }
  }
  throw new Task12Error('验证器配置不可用，请联系支持', 503, 'task27_totp_key_unavailable');
}
export async function totpAt(secret, step, digits = 6, hash = 'SHA-1') {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const key = await crypto.subtle.importKey('raw', unbase32(secret), {name:'HMAC',hash}, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = digest.at(-1) & 15;
  const binary = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
  return String(binary % (10 ** digits)).padStart(digits, '0');
}
export async function matchingTotpStep(secret, code, now = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return -1;
  const step = Math.floor(now / 30000);
  let match = -1;
  for (const candidate of [step - 1, step, step + 1]) if (equalText(await totpAt(secret, candidate), code)) match = candidate;
  return match;
}
