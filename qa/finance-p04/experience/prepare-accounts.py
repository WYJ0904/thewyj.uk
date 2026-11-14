"""Create only fresh isolated Preview identities; no Production identity/material is copied."""
from pathlib import Path
from datetime import datetime,timezone
import json,secrets,subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/experience-channel-current'
private=OUT/'private';assert private.is_dir()
resources=json.loads((OUT/'resources.json').read_text())
assert resources['project_name']=='thewyj-finance-p04-preview' and resources['database_id']=='941b465f-185d-42a3-9a11-0c959c11aea4'
accounts=[dict(id='isolated-p04-'+scope,username=username,scope=scope,secret=secrets.token_hex(24),role='super_admin' if scope=='maintainer' else 'user')
          for scope,username in [('maintainer','p04-preview-maintainer'),('owner','p04-owner'),('validation','p04-validation')]]
for name,value in [('preview-accounts.json',accounts),('preview-secrets.json',{key:secrets.token_hex(32) for key in ['WYJ_TASK12_PASSWORD_PEPPER','WYJ_TASK20_DEVICE_SESSION_SECRET']})]:
    with (private/name).open('x',encoding='utf8') as stream:json.dump(value,stream)
module=(ROOT/'functions/_lib/task12-crypto.mjs').as_uri()
program="""import fs from 'node:fs/promises';import {hashSecret} from MODULE;
const dir=DIR,accounts=JSON.parse(await fs.readFile(dir+'/preview-accounts.json','utf8')),config=JSON.parse(await fs.readFile(dir+'/preview-secrets.json','utf8'));
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";let sql='';
for(const user of accounts){const hash=await hashSecret(user.secret,config.WYJ_TASK12_PASSWORD_PEPPER),now=new Date().toISOString();
sql+='INSERT INTO task12_users(id,username,username_normalized,password_hash,password_scheme,password_iterations,role,registered_at,created_at,updated_at,source_updated_at) VALUES('+[user.id,user.username,user.username,hash,'pbkdf2_sha256',310000,user.role,now,now,now,now].map(quote).join(',')+');\\n';
if(user.scope!=='maintainer')sql+='INSERT INTO task13_user_entitlement_overrides(user_id,entitlement_code,allowed,note,updated_by,updated_at) VALUES('+[user.id,'finance_access',1,'Isolated owner Preview only; not Production membership','isolated-p04-maintainer',now].map(quote).join(',')+');\\n';}
await fs.writeFile(dir+'/preview-accounts.sql',sql,{flag:'wx'});
""".replace('MODULE',json.dumps(module)).replace('DIR',json.dumps(str(private)))
target=private/'prepare-preview-hashes.mjs';target.write_text(program,encoding='utf8')
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
subprocess.run([str(node),str(target)],cwd=ROOT,check=True)
with (OUT/'schema.sql').open('x',encoding='utf8',newline='\n') as stream:
    for p in sorted((ROOT/'cloudflare/migrations').glob('[0-9][0-9][0-9][0-9]_*.sql')):
        stream.write('\n/* '+p.name+' */\n'+p.read_text(encoding='utf8')+'\n')
owner=next(row for row in accounts if row['scope']=='owner')
with (private/'OWNER_PREVIEW_ACCESS.txt').open('x',encoding='utf8') as stream:
    stream.write('独立 P04 Preview 登录：不是正式账户认证，不使用正式密码。\nURL: https://owner-p04-preview.thewyj-finance-p04-preview.pages.dev/finance\n用户名: '+owner['username']+'\n登录密钥: '+owner['secret']+'\n账本初始为空，验证数据属于另一个隔离账户。正式账目和会员权限没有复制。\n不要将本文件提交Git或分享。\n')
record={'prepared_utc':datetime.now(timezone.utc).isoformat(),'accounts':[{k:v for k,v in row.items() if k!='secret'} for row in accounts],
        'production_material_copied':False,'owner_ledger_seeded':False,'member_override_scope':'Fresh Preview database only','secrets_logged':False}
(OUT/'account-preparation.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
