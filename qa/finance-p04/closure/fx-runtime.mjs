// Actual workerd Request API, without any upstream network request or database.
import {Miniflare} from 'miniflare';
import fs from 'node:fs/promises';
const mf=new Miniflare({modules:true,compatibilityDate:'2026-08-06',script:`export default {fetch(){
 const rows=[];for(const redirect of ['error','manual']){try{const request=new Request('https://api.frankfurter.dev/v2/rate/USD/CNY?date=2026-10-19',{redirect});rows.push({redirect,actual:request.redirect,status:'SUPPORTED'});}catch(error){rows.push({redirect,status:'UNSUPPORTED',error:error.message});}}
 return Response.json({runtime:'workerd',rows,upstream_requests:0});}}`});
try{const result=await(await mf.dispatchFetch('http://localhost/')).json();
 await fs.writeFile(new URL('../../../docs/migration-evidence/finance-p04/closure-current/fx-runtime-r1.json',import.meta.url),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));}
finally{await mf.dispose();}
