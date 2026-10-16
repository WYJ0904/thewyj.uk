import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FILES=new Set(['_headers','app.js','changelog.js','design-system.css','favicon.ico','icon-192.png','icon-512.png','index.html','learning-sync.js','manifest.webmanifest','product-ui.css','public-experience.css','styles.css','sw.js','THIRD_PARTY_NOTICES.md','tools.js','workspace-experience.css','workflows.js']);
const DIRECTORIES=new Set(['assets','functions','js','vendor']);
export function assertPagesOutput(root=ROOT){
  const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  assert.equal(config.pages_build_output_dir,'.wrangler/pages-output','Pages must publish the existing allowlisted staging directory');
  const output=path.resolve(root,config.pages_build_output_dir);
  assert.equal(fs.lstatSync(output).isSymbolicLink(),false,'Pages output cannot be a link to another directory');
  assert.equal(fs.realpathSync(output),output,'Pages output must stay in its intended directory');
  for(const entry of fs.readdirSync(output,{withFileTypes:true})){
    assert.ok(entry.isFile()&&FILES.has(entry.name)||entry.isDirectory()&&DIRECTORIES.has(entry.name),'Unapproved resource in Pages output');
  }
  for(const name of ['index.html','app.js','sw.js'])assert.ok(fs.statSync(path.join(output,name)).isFile(),`Missing Pages shell resource: ${name}`);
  return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assertPagesOutput();console.log('Pages output gate passed: allowlisted staging only.');
}
