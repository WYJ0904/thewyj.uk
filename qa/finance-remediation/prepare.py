"""Prepare path-only adapters in a new evidence namespace; never rewrite old tests."""
from pathlib import Path
import difflib, hashlib, json, os, subprocess, sys

ROOT = Path(__file__).resolve().parents[2]
E = ROOT / 'docs/migration-evidence/finance-p04/remediation'
OUT = E / 'preparation'
OUT.mkdir(exist_ok=False)
node = Path.home() / 'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
env = dict(os.environ, JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',
    ANDROID_HOME=str(Path.home()/'AppData/Local/Android/Sdk'), FINANCE_NODE=str(node),
    FINANCE_REGRESSION_OUTPUT=str(E/'final-r1/regression'),
    FINANCE_P04_BASELINE_ROOT=str(OUT/'baseline-modules'), FINANCE_TRACE_ROOT=str(OUT/'trace-source'),
    FINANCE_BACKUP_ROOT=str(OUT/'backup-proof-source'), FINANCE_P03_COMPAT_ROOT=str(E/'fixtures/compat-p03'),
    AERIS_TEST_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe', FINANCE_NODE_WORKERS='2')
env['PATH'] = str(node.parent)+os.pathsep+env['PATH']
rows=[]
for name, script in [('baseline','prepare-baselines.py'), ('trace','prepare-trace.py'), ('backup','prepare-backup-proof.py')]:
    command=[sys.executable,'qa/finance-p04/'+script]
    with (OUT/(name+'.log')).open('xb') as log:
        p=subprocess.run(command,cwd=ROOT,env=dict(env,FINANCE_P04_OUTPUT=str(OUT/(name+'-artifacts'))),stdout=log,stderr=subprocess.STDOUT)
    rows.append(dict(command=command,exit_code=p.returncode))
    assert p.returncode==0,name
for source in (OUT/'backup-proof-source/kotlin').glob('*.kt'):
    original=source.read_text()
    modified=original.replace('.put("room_version",16)','.put("room_version",NotificationDatabase.SCHEMA_VERSION)').replace('assertEquals(16,main.openHelper.writableDatabase.version)','assertEquals(NotificationDatabase.SCHEMA_VERSION,main.openHelper.writableDatabase.version)').replace('Room16 + FX1','Room current + FX1')
    source.with_suffix('.kt.before').write_text(original)
    source.write_text(modified)
    source.with_suffix('.kt.diff').write_text(''.join(difflib.unified_diff(original.splitlines(True),modified.splitlines(True))))
explicit=OUT/'explicit-source'
(explicit/'kotlin').mkdir(parents=True)
for src,dst in [(ROOT/'qa/finance-p04/closure/test.init.gradle',explicit/'test.init.gradle'),
                (ROOT/'qa/finance-p04/closure/kotlin/FinanceClosureContractTest.kt',explicit/'kotlin/FinanceClosureContractTest.kt')]:
    dst.write_bytes(src.read_bytes())
    assert hashlib.sha256(src.read_bytes()).digest()==hashlib.sha256(dst.read_bytes()).digest()
(OUT/'environment.json').write_text(json.dumps({k:v for k,v in env.items() if k.startswith('FINANCE_') or k in ['JAVA_HOME','ANDROID_HOME','AERIS_TEST_CHROME']},indent=2))
(OUT/'commands.json').write_text(json.dumps(rows,indent=2))
print('Prepared fresh baseline modules, trace, explicit-v2, and current-schema backup drivers.')
