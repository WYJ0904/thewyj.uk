import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const out=path.join(root,'.wrangler/preview-finance-evidence/hosted-assets');
await mkdir(out,{recursive:true});
const origin='https://6d3ca922.thewyj-uk.pages.dev';
const baseline='29bdbb9e3ae4cd88019b6c0046aabc6df574a942';
const sourceFile=file=>execFileSync('git',['show',baseline+':'+file],{windowsHide:true,maxBuffer:5*1024*1024});
const context={self:{addEventListener(){}}};
vm.runInNewContext(sourceFile('sw.js').toString()+';globalThis.meta={release:RELEASE,core:CORE_SHELL,required:REQUIRED_SHELL,publication:PUBLICATION_CACHE};',context);
const meta=JSON.parse(JSON.stringify(context.meta));
assert.equal(meta.core.length,81);assert.equal(meta.required.length,83);
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=b=>b.toString('utf8').replace(/\r\n?/g,'\n');
const assets=[...new Set(['/sw.js',...meta.required])];
const rows=[];let cursor=0;
async function worker(){while(cursor<assets.length){const asset=assets[cursor++],url=new URL(asset,origin);assert.ok(!url.pathname.startsWith('/api/'));
 const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
 try{let response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15_000)});const redirects=[];
 if([301,302,307,308].includes(response.status)){const target=new URL(response.headers.get('Location'),url);assert.equal(target.origin,origin);assert.ok(!target.pathname.startsWith('/api/'));redirects.push({status:response.status,target:target.pathname});response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(15_000)});}
 const bytes=Buffer.from(await response.arrayBuffer());const expected=sourceFile(file);
 const text=/\.(?:js|mjs|css|html|webmanifest)$/.test(file);
 const equal=text?canonical(bytes)===canonical(expected):bytes.equals(expected);
 rows.push({asset,status:response.status,redirects,mime:response.headers.get('Content-Type'),bytes:bytes.length,sha256:hash(bytes),canonical_equal_to_146:equal,
  ...(asset==='/'?{csp:response.headers.get('Content-Security-Policy')}:{})});
 if(['/sw.js','/index.html'].includes(asset))await writeFile(path.join(out,path.basename(file)),bytes);
 }catch(error){rows.push({asset,status:'ERROR',error:error.message})}
}}
await Promise.all(Array.from({length:4},worker));rows.sort((a,b)=>a.asset.localeCompare(b.asset));
const result={recorded_at:new Date().toISOString(),origin,baseline:'29bdbb9e3ae4cd88019b6c0046aabc6df574a942',release:meta.release,core_count:81,required_count:83,api_requests:0,
 status:rows.every(r=>r.status===200&&r.canonical_equal_to_146)?'PASS_STATIC_SOURCE_IDENTITY':'FAIL_OR_DRIFT',rows};
await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,requests:rows.length,matching:rows.filter(r=>r.status===200&&r.canonical_equal_to_146).length,api_requests:0,problems:rows.filter(r=>r.status!==200||!r.canonical_equal_to_146)},null,2));
if(result.status!=='PASS_STATIC_SOURCE_IDENTITY')process.exitCode=1;
