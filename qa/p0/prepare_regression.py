"""Copy sealed synthetic fixtures; do not reuse historical PASS as execution."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/migration-evidence/finance-p04/p0-preparation-r1'
OLD=Path.home()/'.codex/worktrees/finance-release-convergence/thewyj.uk'
E=OLD/'docs/migration-evidence/finance-p04/convergence'
manifest=json.loads((E/'FINAL_EVIDENCE_MANIFEST.json').read_text())['files']
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
OUT.mkdir(parents=True,exist_ok=False);rows=[]
for relative in ['preparation/baseline-modules','preparation/trace-source','preparation/backup-proof-source','preparation/explicit-source','fixtures/compat-p03','fixtures/explicit-currency-bridge']:
 for source in sorted((E/relative).rglob('*')):
  if not source.is_file():continue
  key=source.relative_to(OLD).as_posix();assert key in manifest and sha(source)==manifest[key]['sha256']
  target=OUT/source.relative_to(E);target.parent.mkdir(parents=True,exist_ok=True);assert not target.exists()
  shutil.copy2(source,target);assert sha(source)==sha(target)
  rows.append(dict(source=key,dest=target.relative_to(ROOT).as_posix(),sha256=sha(target)))
env=dict(JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_HOME=str(Path.home()/'AppData/Local/Android/Sdk'),
 FINANCE_NODE=str(Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'),
 FINANCE_P04_BASELINE_ROOT=str(OUT/'preparation/baseline-modules'),FINANCE_TRACE_ROOT=str(OUT/'preparation/trace-source'),
 FINANCE_BACKUP_ROOT=str(OUT/'preparation/backup-proof-source'),FINANCE_P03_COMPAT_ROOT=str(OUT/'fixtures/compat-p03'),
 AERIS_TEST_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe',FINANCE_NODE_WORKERS='2')
(OUT/'environment.json').write_text(json.dumps(env,indent=2),encoding='utf8')
(OUT/'manifest.json').write_text(json.dumps(dict(copies=rows,original_oracles_modified=False,historical_results_reused=False),indent=2),encoding='utf8')
print(json.dumps(dict(status='PASS',verified_fixture_copies=len(rows))))
