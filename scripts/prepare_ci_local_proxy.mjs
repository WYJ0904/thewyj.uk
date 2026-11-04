import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Pinned Wrangler regression: a cancelled browser request reports this exact
// transport error as fatal. Keep its failed HTTP request and all test assertions;
// only keep the local CI dev server alive. Never retry a POST or patch deploys.
// https://github.com/cloudflare/workers-sdk/issues/15451
const ORIGINAL='case "error":\n            this.emitErrorEvent("Error inside ProxyWorker", message.error);';
const PATCHED='case "error":\n            // WYJ_LOCAL_PROXY_DISCONNECT\n            if (message.error?.name === "Error" && message.error?.message === "Network connection lost.") {\n              console.warn("[local-ci-proxy] Browser connection lost; request failed, dev server continues.");\n              break;\n            }\n            this.emitErrorEvent("Error inside ProxyWorker", message.error);';
export function patchLocalProxy(source){
  if(source.includes('WYJ_LOCAL_PROXY_DISCONNECT')){
    assert.equal(source.split(PATCHED).length-1,2,'Unexpected partial Wrangler patch');
    assert.equal(source.split(ORIGINAL).length-1,0,'Unexpected unpatched controller');
    return source;
  }
  assert.equal(source.split(ORIGINAL).length-1,2,'Pinned Wrangler controller changed; review workaround');
  return source.replaceAll(ORIGINAL,PATCHED);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.deepEqual(process.argv.slice(2),['--apply-ci-local']);
  assert.equal(process.env.CI,'true','This workaround is limited to the isolated CI dev server');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const packagePath=path.join(root,'node_modules/wrangler/package.json');
  assert.equal(JSON.parse(fs.readFileSync(packagePath,'utf8')).version,'4.118.0');
  const cli=path.join(root,'node_modules/wrangler/wrangler-dist/cli.js'),source=fs.readFileSync(cli,'utf8'),patched=patchLocalProxy(source);
  if(source!==patched)fs.writeFileSync(cli,patched);
  console.log('Pinned local CI proxy prepared; HTTP failures and all other fatal errors remain visible.');
}
