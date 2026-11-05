// Serve the actual compiled Pages worker directly with the pinned Miniflare.
// This avoids the long-lived Wrangler development proxy in the extended suite.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Miniflare} from 'miniflare';
const [runtime,state,portText]=process.argv.slice(2);
const root=path.resolve(import.meta.dirname,'../..');
assert.ok(path.resolve(runtime).startsWith(path.join(root,'.wrangler')+path.sep));
const config=JSON.parse(await fs.readFile(path.join(runtime,'wrangler.jsonc'),'utf8'));
assert.equal(config.vars.WORKERS_AI_ENABLED,'false');assert.equal(config.ai,undefined);
const secrets=Object.fromEntries((await fs.readFile(path.join(runtime,'.dev.vars'),'utf8')).trim().split(/\r?\n/).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
const manifest=JSON.parse(await fs.readFile(path.join(runtime,'qa-source-manifest.json'),'utf8'));
const allowed=new Set(Object.keys(manifest.files).filter(x=>!x.startsWith('functions/')));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.txt':'text/plain; charset=utf-8'};
const rules=[];let current;
for(const line of (await fs.readFile(path.join(runtime,'public/_headers'),'utf8')).split(/\r?\n/)){
 if(line.startsWith('/')){current={pattern:line.trim(),headers:{}};rules.push(current);}
 else if(current&&/^\s+\S/.test(line)){const at=line.indexOf(':');if(at>0)current.headers[line.slice(0,at).trim()]=line.slice(at+1).trim();}
}
// Wrangler --outfile is a multipart upload bundle, not raw JavaScript.
const packed=await fs.readFile(path.join(runtime,'pages-worker.mjs'));
const boundary=packed.subarray(0,packed.indexOf(10)).toString().trim().slice(2);
const parts=await new Response(packed,{headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`}}).formData();
const metadata=JSON.parse(parts.get('metadata'));
const modules=[];
for(const [name,file] of parts){if(name==='metadata')continue;
 assert.equal(path.basename(name),name);assert.equal(file.type,'application/javascript+module');
 modules.push({type:'ESModule',path:path.join(runtime,name),contents:await file.text()});}
modules.sort((a,b)=>Number(path.basename(b.path)===metadata.main_module)-Number(path.basename(a.path)===metadata.main_module));
assert.equal(path.basename(modules[0].path),metadata.main_module);
const mf=new Miniflare({modules,
 compatibilityDate:config.compatibility_date,host:'127.0.0.1',port:Number(portText),
 bindings:{...config.vars,...secrets},d1Databases:{WYJ_DB:'WYJ_DB'},r2Buckets:{WYJ_STORAGE:'aeris-p07-phase1-local'},
 resourcePersistencePath:path.join(state,'v3'),
 serviceBindings:{ASSETS:async(request)=>{
   let name;try{name=decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');}catch{return new Response('Bad path',{status:400});}
   if(!name)name='index.html';
   if(!allowed.has(name))name='index.html'; // Same application's SPA fallback.
   const bytes=await fs.readFile(path.join(runtime,'public',name));
   const headers={'Content-Type':mime[path.extname(name)]||'application/octet-stream'};
   for(const rule of rules)if(rule.pattern==='/*'||rule.pattern==='/'+name)Object.assign(headers,rule.headers);
   return new Response(request.method==='HEAD'?null:bytes,{headers});
 }}});
// Refuse a different/empty local DB rather than silently creating another tier.
const db=await mf.getD1Database('WYJ_DB');
const count=await db.prepare('SELECT count(*) AS n FROM task12_users').first();assert.equal(count.n,1);
await mf.ready;
console.log('READY: compiled Pages worker, existing isolated D1/R2, AI_OFF, loopback');
async function close(){await mf.dispose();process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);
