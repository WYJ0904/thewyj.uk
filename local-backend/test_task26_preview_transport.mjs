import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercise the real Web session controller against the actual acceptance shell's UA.
const activity = fs.readFileSync(new URL('../android/task26-preview/src/main/java/uk/thewyj/task26preview/PreviewLearningActivity.kt', import.meta.url), 'utf8');
const build = fs.readFileSync(new URL('../android/task26-preview/build.gradle.kts', import.meta.url), 'utf8');
const template = activity.match(/userAgentString\s*=\s*"([^"]+)"/)?.[1];
const version = build.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
assert.ok(template && version, 'actual Preview user-agent template and version are required');
const previewUserAgent = template.replace('$userAgentString', 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36').replace('${BuildConfig.VERSION_NAME}', version);
class Storage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.localStorage = new Storage();
globalThis.sessionStorage = new Storage();
globalThis.window = { location: { href: 'https://preview.invalid/login' } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 thewyj-android/1.3.37' } });
const session = await import('../js/core/session.js');
assert.equal(session.isThewyjAndroidApp(), true, 'original native transport must still be recognized');
globalThis.navigator.userAgent = previewUserAgent;
assert.equal(session.isThewyjAndroidApp(), false, 'isolated Preview shell has no original native cookie/session bridge');
const fixtureSession = 'fixture-preview-web-session';
assert.equal(session.persistAccountSession(fixtureSession), true);
assert.equal(globalThis.localStorage.getItem(session.ACCOUNT_SESSION_KEY), fixtureSession);
assert.equal(session.restoreAccountSession(), fixtureSession, 'Preview reload restores its own normal Web session');
assert.deepEqual(session.accountSessionHeaders(session.restoreAccountSession()), { 'X-Session-Token': fixtureSession });
assert.equal(session.requestNativeSessionRefresh(), false);
assert.equal(session.requestNativeLogout(), false);
assert.equal(globalThis.window.location.href, 'https://preview.invalid/login', 'Preview must not request production native deep links');
console.log('PASS: isolated Preview UA persists/restores normal Web auth and never requests the original native bridge (1 group).');
