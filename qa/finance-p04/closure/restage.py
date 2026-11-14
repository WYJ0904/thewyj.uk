"""Refresh allowlisted assets and reapply only the already verified QA binding."""
from pathlib import Path
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
stage=ROOT/'.wrangler/pages-output';dest=OUT/'hosted-stage-final-manifest.json';assert not dest.exists()
root_config=hashlib.sha256((ROOT/'wrangler.jsonc').read_bytes()).hexdigest()
assert not stage.is_symlink() and stage.resolve().is_relative_to(ROOT/'.wrangler')
subprocess.run([str(NODE),str(ROOT/'scripts/stage_pages_deploy.mjs')],cwd=ROOT,check=True)
config=json.loads((OUT/'qa-bindings.json').read_text())
assert config['name']=='thewyj-finance-qa'
for value in [config,config['env']['preview']]:assert {r['database_id'] for r in value['d1_databases']}=={'c2eb978f-9f49-4e4c-8286-f6b398fae0de'}
(stage/'wrangler.jsonc').write_text(json.dumps(config,indent=2),encoding='utf8')
files={p.relative_to(stage).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in stage.rglob('*') if p.is_file()}
assert files['functions/_lib/finance-fx.mjs']==hashlib.sha256((ROOT/'functions/_lib/finance-fx.mjs').read_bytes()).hexdigest()
assert not any(p.startswith(('docs/','qa/','android/','node_modules/','.git/','_wyj-tools/')) for p in files)
assert hashlib.sha256((ROOT/'wrangler.jsonc').read_bytes()).hexdigest()==root_config
dest.write_text(json.dumps({'files':files,'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'root_configuration_unchanged':True,'isolated_d1':'c2eb978f-9f49-4e4c-8286-f6b398fae0de'},indent=2))
print(json.dumps({'staged_files':len(files),'binding':'QA only','root_configuration_unchanged':True}))
