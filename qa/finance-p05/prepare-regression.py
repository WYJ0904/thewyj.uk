"""Prepare new evidence paths and adapters; never overwrite a sealed phase's artifacts."""
from pathlib import Path
import argparse,json,os,re,subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--label',default='final');args=parser.parse_args()
assert re.fullmatch('final(?:-r[0-9]+)?',args.label)
BASE=ROOT/'docs/migration-evidence/finance-p04/continuation-p05'/args.label
BASE.mkdir(exist_ok=False)
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_HOME=str(Path.home()/'AppData/Local/Android/Sdk'),
         FINANCE_NODE=str(node),FINANCE_REGRESSION_OUTPUT=str(BASE/'regression'),FINANCE_P04_BASELINE_ROOT=str(BASE/'baseline-modules'),
         FINANCE_TRACE_ROOT=str(BASE/'trace-source'),FINANCE_CONTRACT_ROOT=str(BASE/'contract-input-drivers'),FINANCE_BACKUP_ROOT=str(BASE/'backup-proof-source'),
         FINANCE_PRIMARY_DOM=str(ROOT/'docs/migration-evidence/finance-p04/closure-current/final-current/regression/p02-web/web-dom.ndjson'),
         AERIS_TEST_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe',FINANCE_NODE_WORKERS='2')
env['PATH']=str(node.parent)+os.pathsep+env.get('PATH','')
for name,script in [('baseline','qa/finance-p04/prepare-baselines.py'),('trace','qa/finance-p04/prepare-trace.py'),('contract','qa/finance-p04/prepare-contract-drivers.py'),('backup','qa/finance-p04/prepare-backup-proof.py')]:
    with (BASE/(name+'-preparation.log')).open('x') as log:
        result=subprocess.run([sys.executable,script],cwd=ROOT,env=dict(env,FINANCE_P04_OUTPUT=str(BASE/(name+'-preparation'))),stdout=log,stderr=subprocess.STDOUT)
    assert result.returncode==0,name
# The backup implementation advances its declared current schema, never money/ID/receipt assertions.
for p in (BASE/'backup-proof-source/kotlin').glob('*.kt'):
    original=p.read_text();updated=original.replace('.put("room_version",16)','.put("room_version",NotificationDatabase.SCHEMA_VERSION)').replace('assertEquals(16,main.openHelper.writableDatabase.version)','assertEquals(NotificationDatabase.SCHEMA_VERSION,main.openHelper.writableDatabase.version)').replace('Room16 + FX1','Room current + FX1')
    p.with_suffix('.kt.before').write_text(original);p.write_text(updated)
(BASE/'environment-paths.json').write_text(json.dumps({k:v for k,v in env.items() if k.startswith('FINANCE_') or k in ['JAVA_HOME','ANDROID_HOME','AERIS_TEST_CHROME']},indent=2))
print(json.dumps({'base':str(BASE),'prepared':True,'no_device':True}))
