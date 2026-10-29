import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Local development only. The affected HTTP request still fails; no request,
// test result, application exception or Production Worker is rewritten.
// https://github.com/cloudflare/workers-sdk/issues/15317
export function transientLocalProxyDisconnect(event) {
  const cause = event?.cause?.cause;
  return event?.source === 'ProxyController' && event.reason === 'Error inside ProxyWorker' &&
    ['Error', 'TypeError'].includes(cause?.name) &&
    ['Network connection lost.', "Can't read from request stream because client disconnected."].includes(cause?.message);
}

export function localDevErrorMethods(source) {
  const methods = [];let offset = 0;
  while ((offset = source.indexOf('\n      handleErrorEvent(event) {', offset)) >= 0) {
    const end = source.indexOf('\n      async teardown()', offset);
    assert.ok(end > offset, 'Pinned Wrangler method boundary missing');
    const method = source.slice(offset, end);
    assert.ok(method.includes('event.cause.isUserError()') && method.includes('Failed to send message to'),
      'Unknown Wrangler error boundary; review instead of patching');
    methods.push(method);offset = end;
  }
  assert.ok(methods.length >= 1 && methods.length <= 2, 'Unknown Wrangler API/CLI method layout');
  return methods;
}

export function patchedLocalDevSource(source) {
  assert.ok(!source.includes('[wyj-local-ci-proxy-disconnect]'), 'Workaround already applied');
  for (const original of localDevErrorMethods(source)) {
    const logger = /\b(logger[0-9]*)\.debug\(/.exec(original)?.[1];
    assert.ok(['logger2', 'logger3'].includes(logger), 'Unknown pinned Wrangler logger');
    const marker = 'handleErrorEvent(event) {';
    const replacement = marker +
      '\n        if (!(event.cause instanceof miniflare.MiniflareCoreError && event.cause.isUserError()) && (' +
      transientLocalProxyDisconnect.toString() + ')(event)) {' +
      '\n          ' + logger + '.warn("[wyj-local-ci-proxy-disconnect] Affected request failed; local dev process continues.", event.cause);' +
      '\n          return;\n        }';
    source = source.replace(original, original.replace(marker, replacement));
  }
  return source;
}

async function main() {
  assert.equal(process.env.CI, 'true', 'This workaround is limited to ephemeral local-browser CI');
  const base = new URL(process.env.WYJ_TEST_BASE || '');
  assert.equal(base.protocol, 'http:');assert.equal(base.hostname, '127.0.0.1');assert.equal(base.port, '8894');
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('wrangler/package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(pkg.version, '4.118.0', 'Review/remove workaround when changing Wrangler');
  const cli = path.join(path.dirname(packagePath), 'wrangler-dist/cli.js');
  const before = fs.readFileSync(cli, 'utf8');
  const after = patchedLocalDevSource(before);
  assert.notEqual(before, after);
  fs.writeFileSync(cli, after);
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  const receipt = { workaround: 'wrangler-4.118-local-proxy-disconnect', version: pkg.version,
    scope: 'ephemeral localhost browser CI only', before_sha256: hash(before), after_sha256: hash(after),
    affected_request_still_fails: true, existing_error_handling_preserved: true,
    request_retries_added: 0, assertions_removed: 0, production_worker_changed: false,
    upstream: 'https://github.com/cloudflare/workers-sdk/issues/15317' };
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/wrangler-local-disconnect.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message);process.exitCode = 1; });
