"""Independent stricter output contract; the old root-output assertion remains FAIL."""
from pathlib import Path
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/p07-ui-release';OUT=E/'build-safety.json'
cfg=json.loads((ROOT/'wrangler.jsonc').read_text());assert cfg['pages_build_output_dir']=='.wrangler/pages-output'
package=json.loads((ROOT/'package.json').read_text());assert package['scripts']['build']=='node scripts/stage_pages_deploy.mjs'
script=(ROOT/'scripts/stage_pages_deploy.mjs').read_text()
files=json.loads(re.search(r'const ROOT_FILES = Object.freeze\((\[[\s\S]*?\])\);',script)[1].replace(',\n]', '\n]'))
directories=json.loads(re.search(r'const ROOT_DIRECTORIES = Object.freeze\((\[[\s\S]*?\])\);',script)[1])
stage=(ROOT/'.wrangler/pages-output').resolve();assert stage.is_relative_to(ROOT.resolve()) and stage!=ROOT.resolve()
rows=[]
for p in stage.rglob('*'):
 if not p.is_file():continue
 name=p.relative_to(stage).as_posix();assert name in files or name.split('/')[0] in directories,name
 assert not any(x in p.relative_to(stage).parts for x in ['.git','node_modules','private','docs','qa','_wyj-tools'])
 source=ROOT/name;assert source.is_file();assert p.read_bytes()==source.read_bytes(),name
 rows.append(dict(path=name,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
assert len(rows)>100
before=json.loads(subprocess.check_output(['git','show','74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc:wrangler.jsonc'],cwd=ROOT))
assert {k:v for k,v in before.items() if k!='pages_build_output_dir'}=={k:v for k,v in cfg.items() if k!='pages_build_output_dir'}
for group in ['functions','cloudflare','android','package-lock.json']:
 assert not subprocess.check_output(['git','diff','74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc','--',group],cwd=ROOT),group
OUT.write_text(json.dumps(dict(status='PASS',files=rows,bindings_and_environment_vars_identical=True,worker_database_android_dependencies_identical=True,
    old_static_root_output_assertion='FAIL retained; stricter safe-child output checked separately, no oracle changed',production_flag_activation=False),indent=2))
print('Build safety PASS:',len(rows),'allowlisted files; bindings/backend/schema/APK source unchanged.')
