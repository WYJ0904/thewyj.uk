/** Redirect only frozen P02 evidence paths; never transform a test or its truth. */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';

const root=path.resolve(import.meta.dirname,'../../..');
const safe=path.join(root,'docs/migration-evidence/finance-p03/finish');
const original=path.resolve(process.env.P03_FROZEN_OUTPUT_PREFIX||path.join(root,'docs/migration-evidence/finance-p02/matrix'));
const target=path.resolve(process.env.FINANCE_P03_OUTPUT||'');
if(!process.env.FINANCE_P03_OUTPUT || path.relative(safe,target).startsWith('..'))throw Error('Use a new closeout evidence directory');
const defaultOriginal=path.join(root,'docs/migration-evidence/finance-p02/matrix');
if(original!==defaultOriginal && path.relative(safe,original).startsWith('..'))throw Error('Unexpected source prefix');
const written=new Set();
function redirect(value) {
  if(typeof value!=='string')return value;
  const absolute=path.resolve(value);const relative=path.relative(original,absolute);
  return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative))?path.join(target,relative):value;
}
for(const [owner,names] of [[fs,['mkdirSync','writeFileSync','appendFileSync','readFileSync','existsSync','statSync']],
  [fsp,['mkdir','writeFile','appendFile','readFile','access','stat']]]) {
  for(const name of names) {
    const originalFunction=owner[name].bind(owner);
    owner[name]=function(first,...rest) {
      const mapped=redirect(first);
      if(mapped!==first && ['writeFile','writeFileSync'].includes(name) && !written.has(mapped)) {
        if(fs.existsSync(mapped))throw Error('Preserve existing frozen replay evidence: '+mapped);
        written.add(mapped);
      }
      return originalFunction(mapped,...rest);
    };
  }
}
syncBuiltinESMExports();
