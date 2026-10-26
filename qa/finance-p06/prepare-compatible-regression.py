"""Fresh adapters/paths only; old evidence and all frozen oracles stay untouched."""
from pathlib import Path
import json,os,subprocess,sys
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p04/p06-validation'
OUT=E/'preparation';OUT.mkdir(exist_ok=False)
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_HOME=str(Path.home()/'AppData/Local/Android/Sdk'),
    FINANCE_NODE=str(node),FINANCE_REGRESSION_OUTPUT=str(E/'final-r1/regression'),FINANCE_P04_BASELINE_ROOT=str(OUT/'baseline-modules'),
    FINANCE_TRACE_ROOT=str(OUT/'trace-source'),FINANCE_CONTRACT_ROOT=str(OUT/'contract-input-drivers'),FINANCE_BACKUP_ROOT=str(OUT/'backup-proof-source'),
    FINANCE_PRIMARY_DOM=str(ROOT/'docs/migration-evidence/finance-p04/closure-current/final-current/regression/p02-web/web-dom.ndjson'),
    AERIS_TEST_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe',FINANCE_NODE_WORKERS='2')
env['PATH']=str(node.parent)+os.pathsep+env['PATH']
for name,script in [('baseline','qa/finance-p04/prepare-baselines.py'),('trace','qa/finance-p04/prepare-trace.py'),('contract','qa/finance-p04/prepare-contract-drivers.py'),('backup','qa/finance-p04/prepare-backup-proof.py')]:
    with (OUT/(name+'.log')).open('xb') as log:p=subprocess.run([sys.executable,script],cwd=ROOT,env=dict(env,FINANCE_P04_OUTPUT=str(OUT/(name+'-artifacts'))),stdout=log,stderr=subprocess.STDOUT)
    assert p.returncode==0,name
for p in (OUT/'backup-proof-source/kotlin').glob('*.kt'):
    original=p.read_text();p.with_suffix('.kt.before').write_text(original)
    p.write_text(original.replace('.put("room_version",16)','.put("room_version",NotificationDatabase.SCHEMA_VERSION)').replace('assertEquals(16,main.openHelper.writableDatabase.version)','assertEquals(NotificationDatabase.SCHEMA_VERSION,main.openHelper.writableDatabase.version)').replace('Room16 + FX1','Room current + FX1'))
(OUT/'environment.json').write_text(json.dumps({k:v for k,v in env.items() if k.startswith('FINANCE_') or k in ['JAVA_HOME','ANDROID_HOME','AERIS_TEST_CHROME']},indent=2))
print('Prepared fresh isolated regression inputs:',OUT)
