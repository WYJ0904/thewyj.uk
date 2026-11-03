import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stage=path.join(root,'.wrangler','pages-output');
assert.ok(fs.existsSync(path.join(stage,'index.html')),'Run pages:stage before starting local Pages');
const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.local.jsonc'),'utf8'));
assert.ok(!config.ai && !config.env && !config.account_id,'Local development must not inherit cloud environments');
assert.ok(config.d1_databases.every(x=>x.database_name==='wyj-cloud-development' && !x.database_id && !x.remote));
assert.ok(config.r2_buckets.every(x=>x.bucket_name==='wyj-cloud-development' && !x.remote));
const base=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
assert.equal(base.vars.WYJ_ENVIRONMENT,'development');
assert.equal(base.vars.WORKERS_AI_ENABLED,'false');
assert.ok(!base.ai && !base.d1_databases?.length && !base.r2_buckets?.length,'Default config must stay local and require explicit bindings');
// The pinned local migration command uses the requested binding as its local
// database ID when no cloud database_id exists; use that same ID here.
const bindings=[...config.d1_databases.flatMap(x=>['--d1',x.binding]),
  ...config.r2_buckets.flatMap(x=>['--r2',x.binding+'='+x.bucket_name])];
// Pages rejects a custom --config. Keep the standard development defaults and
// explicitly bind local resources using the same names as local migrations.
const child=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'pages','dev',stage,
  '--persist-to',path.join(root,'.wrangler/state'),'--ip','127.0.0.1','--port','8788',...bindings],{
  cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'}
});
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>child.kill(signal));
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
process.exitCode=code??0;
