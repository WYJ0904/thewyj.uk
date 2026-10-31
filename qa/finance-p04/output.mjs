import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root=path.resolve(import.meta.dirname,'../..');
const evidence=path.join(root,'docs/migration-evidence/finance-p04');
export const out=path.resolve(process.env.FINANCE_P04_OUTPUT || path.join(evidence,'cloud',`run-${Date.now()}-${process.pid}`));
if(!out.startsWith(evidence+path.sep))throw Error('P04 evidence must stay in its ignored directory');
mkdirSync(out,{recursive:true});
export const outUrl=pathToFileURL(out+path.sep);
