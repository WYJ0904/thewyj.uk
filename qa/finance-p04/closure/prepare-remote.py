"""Stage allowlisted product assets with bindings confined to newly owned QA D1."""
from pathlib import Path
import hashlib
import json
import secrets
import subprocess

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
stage=(ROOT/'.wrangler/pages-output').resolve()
assert stage.is_relative_to(ROOT/'.wrangler')
assert not stage.is_symlink() and not (ROOT/'.wrangler').is_symlink()
subprocess.run([str(NODE),str(ROOT/'scripts/stage_pages_deploy.mjs')],cwd=ROOT,check=True)
private=OUT/'private'
private.mkdir(exist_ok=False)
tokens={name:secrets.token_hex(32) for name in ('WYJ_TASK12_PASSWORD_PEPPER','WYJ_TASK20_DEVICE_SESSION_SECRET')}
(private/'qa-secrets.json').write_text(json.dumps(tokens),encoding='utf8')
vars={
 'WYJ_ENVIRONMENT':'preview','CLOUD_FOUNDATION_ENABLED':'true','CLOUD_STATUS_MODE':'cloud',
 'CLOUD_READS_ENABLED':'true','CLOUD_WRITES_ENABLED':'true','CLOUD_DEEP_HEALTH_CHECKS':'true',
 'TASK12_CLOUD_ACCOUNTS_ENABLED':'true','TASK13_CLOUD_READS_ENABLED':'true',
 'TASK15_CLOUD_ONLY_ENABLED':'true','TASK16_CLOUD_READS_ENABLED':'true','TASK16_CLOUD_WRITES_ENABLED':'true',
 'TASK20_ANDROID_APP_ENABLED':'true','TASK21_NOTIFICATION_READS_ENABLED':'true','TASK21_NOTIFICATION_WRITES_ENABLED':'true',
 'TASK25_FEATURE_FLAGS_ENABLED':'true','WORKERS_AI_ENABLED':'false','D1_RATE_LIMIT_ENABLED':'true',
 'CLOUD_RATE_LIMIT_REQUESTS':'120','CLOUD_RATE_LIMIT_WINDOW_SECONDS':'60',
 'ANDROID_LATEST_VERSION_CODE':'50','ANDROID_LATEST_VERSION_NAME':'1.3.37','ANDROID_MINIMUM_VERSION_CODE':'50'}
binding={'binding':'WYJ_DB','database_name':'finance-p03-p04-qa','database_id':'c2eb978f-9f49-4e4c-8286-f6b398fae0de',
         'migrations_dir':str(ROOT/'cloudflare/migrations'),'migrations_table':'wyj_d1_migrations'}
assert binding['database_id'] not in {'11c288d8-c584-409f-bb1f-7e7af11793e5','a3e6253b-689f-49f3-998b-7c5828ea255a'}
config={'name':'thewyj-finance-qa','pages_build_output_dir':'.','compatibility_date':'2026-08-06','send_metrics':False,
        'vars':vars,'d1_databases':[binding],'env':{'preview':{'vars':vars,'d1_databases':[binding]}}}
(stage/'wrangler.jsonc').write_text(json.dumps(config,indent=2),encoding='utf8')
(OUT/'qa-bindings.json').write_text(json.dumps(config,indent=2),encoding='utf8')
migrations=sorted((ROOT/'cloudflare/migrations').glob('[0-9][0-9][0-9][0-9]_*.sql'))
schema=OUT/'qa-schema.sql'
with schema.open('x',encoding='utf8',newline='\n') as target:
 for path in migrations:target.write('\n/* '+path.name+' */\n'+path.read_text(encoding='utf8')+'\n')
files={p.relative_to(stage).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in stage.rglob('*') if p.is_file()}
assert not any(name.startswith(('docs/','qa/','android/','node_modules/','.git/','_wyj-tools/')) or '\u8bbf\u95ee\u53e3\u4ee4' in name for name in files)
(OUT/'hosted-stage-manifest.json').write_text(json.dumps({'files':files,'migrations':[p.name for p in migrations],
 'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
 'isolated_d1':binding['database_id'],'production_changes':False},indent=2),encoding='utf8')
print(json.dumps({'stage_files':len(files),'migrations':len(migrations),'isolated_d1':binding['database_id'],'secrets_printed':False}))
