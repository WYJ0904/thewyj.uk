import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {stagePages} from './stage_pages_deploy.mjs';
const root=path.resolve(import.meta.dirname,'..'),release=process.argv[2];
assert.match(release||'',/^\d{8}-aeris-[a-z0-9-]+$/);
const config=await fs.readFile(path.join(root,'js/core/config.js'),'utf8');
const previous=config.match(/export const ASSET_RELEASE = "([^"]+)";/)[1];
const {files}=await stagePages({root}),changed=[];
for(const file of files.filter(f=>!f.startsWith('assets/')&&!f.startsWith('functions/')&&/\.(?:html|js|css|webmanifest)$/.test(f))){
  const full=path.join(root,file),text=await fs.readFile(full,'utf8');
  if(text.includes(previous)){await fs.writeFile(full,text.replaceAll(previous,release));changed.push(file);}
}
console.log(JSON.stringify({previous,release,changed,brandAssetBytesChanged:false},null,2));
