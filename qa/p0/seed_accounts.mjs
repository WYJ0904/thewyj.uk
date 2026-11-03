import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {hashSecret} from '../../functions/_lib/task12-crypto.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const base=path.join(root,'docs/migration-evidence/aeris-p0-closeout/cloud');
const resources=JSON.parse(await fs.readFile(path.join(base,'resources.json'),'utf8'));
assert.equal(resources.project_name,'aeris-p0-finance-rc');assert.equal(resources.created_by_this_run,true);
const privateDir=path.join(base,'private');
const pepper=JSON.parse(await fs.readFile(path.join(privateDir,'secrets.json'),'utf8')).WYJ_TASK12_PASSWORD_PEPPER;
const users=[{id:'synthetic-p0-admin',username:'p0qaadmin',role:'super_admin'},{id:'synthetic-p0-owner',username:'p0qaowner',role:'user'}];
const quote=s=>`'${String(s).replaceAll("'","''")}'`;
const now=new Date().toISOString();let sql='';
for(const user of users){
 user.secret=randomBytes(30).toString('base64url');
 const hashed=await hashSecret(user.secret,pepper);
 sql+=`INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES(${quote(user.id)},${quote(user.username)},${quote(user.username)},${quote(hashed)},'pbkdf2_sha256',310000,${quote(user.role)},${quote(now)},${quote(now)},${quote(now)},${quote(now)});\n`;
}
await fs.writeFile(path.join(privateDir,'accounts.json'),JSON.stringify({synthetic_only:true,users},null,2),{flag:'wx'});
await fs.writeFile(path.join(privateDir,'accounts.sql'),sql,{flag:'wx'});
console.log(JSON.stringify({status:'PASS',synthetic_accounts:users.length,passwords_or_hashes_logged:false,formal_identity_reused:false}));
