"""Resume only the owner-interrupted Android/tail; verify the finished Node source."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,sys
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'docs/migration-evidence/finance-p04/p06-validation/final-r3'
old=json.loads((BASE/'extra-commands.json').read_text());assert [x['name'] for x in old]==['node-full','android-full'] and old[1]['exit_code']==1073807364
assert (BASE/'interrupted-android-r1/android.log').exists() and not (BASE/'android-current').exists()
assert not (BASE/'regression/jvm-commands.json').exists() and not (BASE/'extra-commands-resume-r1.json').exists()
node=json.loads((BASE/'regression/node-source-lock.json').read_text());assert node['source_stable']
commands=json.loads((BASE/'regression/node-commands.json').read_text());assert len(commands)==34
for name,digest in node['after']['files'].items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
source=ROOT/'qa/finance-p06/full-regression.py';text=source.read_text();before=hashlib.sha256(source.read_bytes()).hexdigest()
for original,replacement in [
 ('ROOT=Path(__file__).resolve().parents[2]',f'ROOT=Path({str(ROOT)!r})'),
 ('else:BASE.mkdir(exist_ok=False)','else:assert BASE.is_dir()'),
 ("else 'extra-commands.json')","else 'extra-commands-resume-r1.json')"),
 ("else '')+name+'.log'","else 'resume-r1-')+name+'.log'"),
 ("        run('node-full',[sys.executable,'qa/finance-p04/run-regression-node.py'])\n",''),
]:
 assert text.count(original)==1,original;text=text.replace(original,replacement)
driver=BASE/'resume-controller.py';assert not driver.exists();driver.write_text(text)
(BASE/'resume-preflight.json').write_text(json.dumps({'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS','finished_node_commands':34,'node_source_files_verified':len(node['after']['files']),'old_android_interruption_preserved':True,'original_controller_sha256':before,'new_controller_sha256':hashlib.sha256(driver.read_bytes()).hexdigest(),'scope':'Same test selections, assertions and deadlines; skip only the completed unchanged-source Node batch and use fresh logs/result paths'},indent=2))
raise SystemExit(subprocess.call([sys.executable,str(driver),'--label','final-r3'],cwd=ROOT))
