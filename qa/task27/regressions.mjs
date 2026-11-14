import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'.wrangler/task27-regressions');await mkdir(out,{recursive:true});
const scripts=[
  'local-backend/test_task12_d1_js.mjs','local-backend/test_task13_d1_js.mjs','local-backend/test_task15_d1_js.mjs',
  'local-backend/test_task18_d1_js.mjs','local-backend/test_task20_d1_js.mjs','local-backend/test_task16_d1_js.mjs','local-backend/test_task17_d1_js.mjs',
  'local-backend/test_finance_js.mjs','local-backend/test_email_js.mjs','local-backend/test_core_js.mjs',
  'local-backend/test_browser_harness_registration_js.mjs','scripts/check_js_module_graph.mjs','scripts/check_storage_contract.mjs','scripts/check_task15_cloud_only.mjs',
];
const results=[];
for(const script of scripts){const started=Date.now(),run=spawnSync(process.execPath,[script],{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:20000000});const row={script,status:run.status===0?'PASS':'FAIL',exit_code:run.status,elapsed_ms:Date.now()-started,log:path.basename(script)+'.log'};await writeFile(path.join(out,row.log),(run.stdout || '')+(run.stderr || ''));results.push(row);await writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(row.status+' '+script);if(run.status!==0)process.exitCode=1;}
