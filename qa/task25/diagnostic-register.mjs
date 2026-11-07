// Local-only observability for the unchanged original contract.
import {register} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.env.TASK25_DIAGNOSTIC_OUT;
if(!out)throw Error('TASK25_DIAGNOSTIC_OUT is required');
if(path.resolve(process.argv[1]||'')!==path.join(root,'local-backend/test_task25_d1_js.mjs'))throw Error('Diagnostics only support the original local Miniflare contract');
const original=fs.readFileSync(path.join(root,'local-backend/test_task25_d1_js.mjs'));
globalThis.__task25Diagnostic={root,out,events:[],originalSha256:createHash('sha256').update(original).digest('hex'),exception(error){const chain=[];for(let e=error;e&&chain.length<6;e=e.cause)chain.push({name:e.name,code:e.code,message:e.message});return chain;}};
process.on('exit',code=>{
  const state=globalThis.__task25Diagnostic;fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify({code,node:process.version,platform:process.platform,source:state.originalSha256,events:state.events},null,2));
});
register('./diagnostic-loader.mjs',import.meta.url);
