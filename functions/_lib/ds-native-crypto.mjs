const encoder = new TextEncoder();

export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0));
}

export const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const unixTime = () => Math.floor(Date.now() / 1000);

export async function verifyBackchannel(request, client, body) {
  const timestamp = request.headers.get('X-DS-Time') || '';
  const nonce = request.headers.get('X-DS-Nonce') || '';
  const supplied = request.headers.get('X-DS-Proof') || '';
  if (request.headers.get('X-DS-Client') !== client.clientId || !/^\d{10}$/.test(timestamp)
    || Math.abs(unixTime() - Number(timestamp)) > 30 || !opaque(nonce) || !opaque(supplied)) return null;
  const key = await crypto.subtle.importKey('raw', encoder.encode(client.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const message = ['ds-native-v1', client.issuer, client.origin, client.clientId, timestamp, nonce, body].join('\n');
  return await crypto.subtle.verify('HMAC', key, decode(supplied), encoder.encode(message)) ? nonce : null;
}

export async function envelopeCipher(secret) {
  const key = await crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    async seal(kind, id, owner, value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aad = encoder.encode([kind, id, owner].join('\n'));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, encoder.encode(value));
      return base64url(iv) + '.' + base64url(new Uint8Array(data));
    },
    async open(kind, id, owner, value) {
      const [iv, encrypted] = value.split('.');
      const aad = encoder.encode([kind, id, owner].join('\n'));
      return new TextDecoder().decode(await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: decode(iv), additionalData: aad,
      }, key, decode(encrypted)));
    },
  };
}
