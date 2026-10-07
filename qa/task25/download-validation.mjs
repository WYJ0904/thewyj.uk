// Real isolated R2 fixtures: download integrity, outages and pointer caching.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { onRequest as dispatch } from '../../functions/api/[[path]].js';

const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("fixture"); } }',
  compatibilityDate: '2026-08-06', r2Buckets: ['WYJ_STORAGE'] });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from('isolated-stable-46-apk-fixture');
const key = 'app/android/thewyj-android-1.3.33.apk';
const clients = ['Mozilla/5.0 Chrome/147.0.0.0', 'Thewyj-Android/1.3.33 Android/36',
  'Mozilla/5.0 Android/16; wv Thewyj-Android/1.3.33'];
let groups = 0;
const pass = label => console.log(`PASS ${++groups}: ${label}`);

try {
  const storage = await mf.getR2Bucket('WYJ_STORAGE');
  await storage.put(key, bytes, { sha256: hash(bytes), httpMetadata: { contentType: 'application/vnd.android.package-archive' } });
  const env = { WYJ_STORAGE: storage, TASK20_ANDROID_APP_ENABLED: 'true', D1_RATE_LIMIT_ENABLED: 'false',
    ANDROID_LATEST_VERSION_NAME: '1.3.33', ANDROID_LATEST_VERSION_CODE: '46',
    ANDROID_APK_KEY: key, ANDROID_APK_FILE_NAME: 'thewyj-android-1.3.33.apk',
    ANDROID_APK_SHA256: hash(bytes), ANDROID_APK_SIZE_BYTES: String(bytes.length) };
  const request = (override = {}, method = 'GET', headers = {}, route = '/api/app/download') => dispatch({
    env: { ...env, ...override }, data: { requestId: crypto.randomUUID() },
    request: new Request('https://thewyj.uk' + route, { method, headers }) });
  const config = async override => (await (await request(override, 'GET', {}, '/api/app/config')).json()).app;
  const originalConfig = await config();
  for (const agent of clients) {
    const download = await request({}, 'GET', { 'User-Agent': agent });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('Content-Type'), 'application/vnd.android.package-archive');
    assert.equal(download.headers.get('Content-Length'), String(bytes.length));
    assert.equal(download.headers.get('X-Apk-Sha256'), hash(bytes));
    assert.equal(download.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(hash(Buffer.from(await download.arrayBuffer())), hash(bytes));
  }
  pass('browser/native/WebView HTTP agents receive identical configured bytes, type, length and hash');

  // HEAD must not load the APK stream; all integrity checks use R2 metadata.
  const headOnlyStorage = { head: k => storage.head(k), get() { throw new Error('HEAD must not fetch an APK body'); } };
  const head = await request({ WYJ_STORAGE: headOnlyStorage }, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), String(bytes.length));
  assert.equal(head.headers.get('X-Apk-Sha256'), hash(bytes));
  assert.equal(head.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  pass('HEAD independently validates object metadata without streaming or returning an APK body');

  const prior = await request();
  const oldEtag = prior.headers.get('ETag');
  await prior.arrayBuffer();
  const next = Buffer.from('isolated-signed-next-release-pointer-fixture');
  const nextKey = 'app/android/isolated-next-release.apk';
  await storage.put(nextKey, next, { sha256: hash(next) });
  const nextEnv = { ANDROID_APK_KEY: nextKey, ANDROID_APK_SHA256: hash(next), ANDROID_APK_SIZE_BYTES: String(next.length) };
  for (const headers of [{}, { 'If-None-Match': oldEtag }, { 'Cache-Control': 'no-cache', 'If-Modified-Since': new Date().toUTCString() }]) {
    const fresh = await request(nextEnv, 'GET', headers);
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers.get('Cache-Control'), 'private, no-store');
    assert.notEqual(fresh.headers.get('ETag'), oldEtag);
    assert.equal(hash(Buffer.from(await fresh.arrayBuffer())), hash(next));
  }
  assert.equal(hash(Buffer.from(await (await request()).arrayBuffer())), hash(bytes));
  pass('cache miss and stale validators return current pointer bytes; rolling back retains the old immutable object');

  const unavailable = [
    { WYJ_STORAGE: undefined }, { ANDROID_APK_KEY: 'app/android/missing-fixture.apk' },
    { WYJ_STORAGE: { get: async () => { throw new Error('isolated_r2_outage'); }, head: async () => { throw new Error('isolated_r2_outage'); } } },
  ];
  for (const failure of unavailable) {
    const response = await request(failure);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const payload = await response.json();
    assert.equal(payload.code, 'app_download_unavailable');
    assert.equal(payload.retryable, true);
    const head = await request(failure, 'HEAD');
    assert.equal(head.status, 503);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.deepEqual(await config(failure), originalConfig);
  }
  pass('missing binding/object and temporary R2 errors fail retryably without stale or cross-environment fallback');

  for (const mismatch of [{ ANDROID_APK_SIZE_BYTES: String(bytes.length + 1) }, { ANDROID_APK_SHA256: 'd'.repeat(64) }]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request(mismatch, method);
      assert.equal(response.status, 503, 'Never label mismatched object bytes as a valid published APK');
      if (method === 'GET') assert.equal((await response.json()).code, 'app_download_unavailable');
      else assert.equal((await response.arrayBuffer()).byteLength, 0);
    }
  }
  pass('configured size or available R2 SHA256 mismatch cannot advertise a successful download');

  // Old multipart objects may not expose SHA256. Preserve that compatibility;
  // full byte/hash/signature verification is still required at publish/readback.
  const checksumAbsent = {
    async get(k) { const object = await storage.get(k); return object && { body: object.body, size: object.size, httpEtag: object.httpEtag, checksums: {} }; },
    async head(k) { const object = await storage.head(k); return object && { size: object.size, httpEtag: object.httpEtag, checksums: {} }; },
  };
  const compatible = await request({ WYJ_STORAGE: checksumAbsent });
  assert.equal(compatible.status, 200);
  assert.equal(hash(Buffer.from(await compatible.arrayBuffer())), hash(bytes));
  assert.equal((await request({ WYJ_STORAGE: checksumAbsent }, 'HEAD')).status, 200);
  pass('legacy R2 objects without a stored SHA256 still stream with matching size; readback remains a separate release gate');
  console.log(`Task 25 APK distribution: ${groups} groups passed (isolated R2 only; hosted download acceptance is separate)`);
} finally { await mf.dispose(); }
