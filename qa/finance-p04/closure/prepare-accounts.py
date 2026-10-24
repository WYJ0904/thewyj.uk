"""Prepare fresh credentials for the newly owned remote QA database only."""
from pathlib import Path
import json
import secrets
import subprocess

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
private=OUT/'private'
credentials=[{'id':'synthetic-p04-closure-owner'+suffix,'username':'synthetic-p04-closure'+suffix,'secret':secrets.token_hex(24)} for suffix in ('','-b')]
with (private/'qa-accounts.json').open('x',encoding='utf8') as stream:json.dump(credentials,stream)
module=(ROOT/'functions/_lib/task12-crypto.mjs').as_uri()
script="""import fs from 'node:fs/promises';
import {hashSecret} from MODULE;
const privateDir=DIR;
const accounts=JSON.parse(await fs.readFile(privateDir+'/qa-accounts.json','utf8'));
const secrets=JSON.parse(await fs.readFile(privateDir+'/qa-secrets.json','utf8'));
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
let sql='';
for(const [index,account] of accounts.entries()){
 const hash=await hashSecret(account.secret,secrets.WYJ_TASK12_PASSWORD_PEPPER);
 const now=new Date().toISOString();
 sql+='INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES('+[account.id,account.username,account.username,hash,'pbkdf2_sha256',310000,index===0?'super_admin':'user',now,now,now,now].map(quote).join(',')+');\\n';
 if(index!==0)for(const entitlement of ['finance_access','notification_archive_access'])sql+='INSERT INTO task13_user_entitlement_overrides(user_id,entitlement_code,allowed,note,updated_by,updated_at) VALUES('+[account.id,entitlement,1,'isolated synthetic QA','synthetic-p04-closure-owner',now].map(quote).join(',')+');\\n';
}
await fs.writeFile(privateDir+'/qa-accounts.sql',sql,{flag:'wx'});
console.log(JSON.stringify({isolated_accounts:accounts.length,credentials_logged:false}));
""".replace('MODULE',json.dumps(module)).replace('DIR',json.dumps(str(private)))
path=private/'prepare-account-hashes.mjs'
with path.open('x',encoding='utf8') as stream:stream.write(script)
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
subprocess.run([str(node),str(path)],cwd=ROOT,check=True)
