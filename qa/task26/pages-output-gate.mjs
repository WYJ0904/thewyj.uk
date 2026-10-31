import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertPagesOutput} from '../../scripts/check_pages_output.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wyj-pages-output-')),output=path.join(root,'.wrangler/pages-output');
try{
  fs.mkdirSync(output,{recursive:true});
  for(const name of ['index.html','app.js','sw.js'])fs.writeFileSync(path.join(output,name),'isolated fixture');
  fs.writeFileSync(path.join(root,'wrangler.jsonc'),JSON.stringify({pages_build_output_dir:'.'}));
  assert.throws(()=>assertPagesOutput(root),/allowlisted/);
  fs.writeFileSync(path.join(root,'wrangler.jsonc'),JSON.stringify({pages_build_output_dir:'.wrangler/pages-output'}));
  assert.equal(assertPagesOutput(root),output);
  fs.writeFileSync(path.join(output,'package.json'),'{}');assert.throws(()=>assertPagesOutput(root),/Unapproved/);fs.unlinkSync(path.join(output,'package.json'));
  fs.mkdirSync(path.join(output,'_wyj-tools'));assert.throws(()=>assertPagesOutput(root),/Unapproved/);
  console.log('PASS Pages output: safe staging accepted; workspace root, developer package and local tooling rejected');
}finally{
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('wyj-pages-output-'));
  fs.rmSync(root,{recursive:true,force:true});
}
