import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { localDevErrorMethods, patchedLocalDevSource } from './wrangler-local-disconnect.mjs';

const require = createRequire(import.meta.url);
const file = path.join(path.dirname(require.resolve('wrangler/package.json')), 'wrangler-dist/cli.js');
const original = fs.readFileSync(file, 'utf8');
const patched = patchedLocalDevSource(original);
function execute(method, event) {
  const warnings = [];
  class MiniflareCoreError extends Error { isUserError() { return true; } }
  if (event.userError) event = { ...event, cause: Object.assign(new MiniflareCoreError('bad configuration'), { cause: event.cause.cause }) };
  const logger = { debug() {}, warn(...args) { warnings.push(args); } };
  const Dev = vm.runInNewContext('(class { constructor(){this.errors=[]} emit(type,error){this.errors.push({type,error})}' + method + '})',
    { miniflare: { MiniflareCoreError }, UserError: Error, logger2: logger, logger3: logger });
  const dev = new Dev();dev.handleErrorEvent(event);return { errors: dev.errors, warnings };
}
const dropped = { source: 'ProxyController', reason: 'Error inside ProxyWorker',
  cause: { cause: { name: 'Error', message: 'Network connection lost.' } } };
const originals = localDevErrorMethods(original), patchedMethods = localDevErrorMethods(patched);
assert.equal(originals.length, patchedMethods.length);
for (let index = 0; index < originals.length; index++) {
assert.equal(execute(originals[index], dropped).errors.length, 1, 'reproduce the pinned SDK process-wide failure');
assert.equal(execute(patchedMethods[index], dropped).errors.length, 0);
assert.equal(execute(patchedMethods[index], dropped).warnings.length, 1, 'the original request error remains visible');
const abandoned = { ...dropped, cause: { cause: { name: 'TypeError', message: "Can't read from request stream because client disconnected." } } };
assert.equal(execute(originals[index], abandoned).errors.length, 1);
assert.equal(execute(patchedMethods[index], abandoned).warnings.length, 1);
for (const event of [
  { ...dropped, source: 'RuntimeController' },
  { ...dropped, reason: 'Worker configuration failed' },
  { ...dropped, cause: { cause: { name: 'Error', message: 'D1_ERROR: no such table' } } },
  { ...dropped, cause: { cause: { name: 'SyntaxError', message: 'Network connection lost.' } } },
  { ...dropped, cause: { message: 'Network connection lost.' } },
  { ...dropped, userError: true },
]) {
  assert.equal(execute(originals[index], event).errors.length, 1);
  assert.equal(execute(patchedMethods[index], event).errors.length, 1, 'unrelated/user/configuration failures must remain fatal');
}
}
assert.throws(() => patchedLocalDevSource('unexpected CLI source'));
assert.throws(() => patchedLocalDevSource(patched), 'a duplicate workaround must not silently stack');
console.log('Pinned local-dev proxy regression passed; request errors remain logged and all unexpected errors remain fatal.');
