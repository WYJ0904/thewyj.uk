"""New evidence roots only. Keep prior QA files and frozen oracles byte-for-byte."""
from pathlib import Path
import difflib,hashlib,json,os,subprocess,sys
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06'
OUT=E/'preparation';OUT.mkdir(exist_ok=False);DRIVERS=OUT/'drivers';DRIVERS.mkdir()
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_HOME=str(Path.home()/'AppData/Local/Android/Sdk'),
 FINANCE_NODE=str(node),FINANCE_REGRESSION_OUTPUT=str(E/'final-r1/regression'),FINANCE_P04_BASELINE_ROOT=str(OUT/'baseline-modules'),
 FINANCE_TRACE_ROOT=str(OUT/'trace-source'),FINANCE_CONTRACT_ROOT=str(OUT/'contract-input-drivers'),FINANCE_BACKUP_ROOT=str(OUT/'backup-proof-source'),
 FINANCE_PRIMARY_DOM=str(ROOT/'docs/migration-evidence/finance-p04/closure-current/final-current/regression/p02-web/web-dom.ndjson'),
 AERIS_TEST_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe',FINANCE_NODE_WORKERS='2')
env['PATH']=str(node.parent)+os.pathsep+env['PATH'];rows=[]
for name,filename in [('baseline','prepare-baselines.py'),('trace','prepare-trace.py'),('contract','prepare-contract-drivers.py'),('backup','prepare-backup-proof.py')]:
 source=ROOT/'qa/finance-p04'/filename;before=source.read_text();after=before.replace('ROOT=Path(__file__).resolve().parents[2]',f'ROOT=Path({str(ROOT)!r})').replace("ROOT/'docs/migration-evidence/finance-p04'","ROOT/'docs/migration-evidence/finance-p06'")
 target=DRIVERS/filename;target.write_text(after)
 (DRIVERS/(filename+'.diff')).write_text(''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile=source.as_posix(),tofile=target.as_posix())))
 with (OUT/(name+'.log')).open('xb') as log:p=subprocess.run([sys.executable,str(target)],cwd=ROOT,env=dict(env,FINANCE_P04_OUTPUT=str(OUT/(name+'-artifacts'))),stdout=log,stderr=subprocess.STDOUT)
 rows.append({'source':str(source.relative_to(ROOT)),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'driver':str(target.relative_to(ROOT)),'exit_code':p.returncode})
 assert p.returncode==0,name
for p in (OUT/'backup-proof-source/kotlin').glob('*.kt'):
 before=p.read_text();p.with_suffix('.kt.before').write_text(before)
 p.write_text(before.replace('.put("room_version",16)','.put("room_version",NotificationDatabase.SCHEMA_VERSION)').replace('assertEquals(16,main.openHelper.writableDatabase.version)','assertEquals(NotificationDatabase.SCHEMA_VERSION,main.openHelper.writableDatabase.version)').replace('Room16 + FX1','Room current + FX1'))
source=ROOT/'qa/finance-p04/upgraded-legacy-http.py'
(DRIVERS/source.name).write_text(source.read_text().replace('ROOT=Path(__file__).resolve().parents[2]',f'ROOT=Path({str(ROOT)!r})').replace("ROOT/'docs/migration-evidence/finance-p04'","ROOT/'docs/migration-evidence/finance-p06'"))
(OUT/'environment.json').write_text(json.dumps({k:v for k,v in env.items() if k.startswith('FINANCE_') or k in ['JAVA_HOME','ANDROID_HOME','AERIS_TEST_CHROME']},indent=2))
(OUT/'adaptations.json').write_text(json.dumps({'rows':rows,'scope':'Only absolute ROOT/output guards plus current final schema version in generated backup readers; original cases, money, IDs, receipt and safety assertions unchanged'},indent=2))
source=ROOT/'qa/finance-p05/closeout/final-validation.py';before=source.read_text();after=before.replace('ROOT=Path(__file__).resolve().parents[3]','ROOT=Path(__file__).resolve().parents[2]').replace("ROOT/'docs/migration-evidence/finance-p04/non-device-closeout'","ROOT/'docs/migration-evidence/finance-p06'").replace('qa/finance-p04/android.py','qa/finance-p06/android.py').replace('FINANCE_P04_OUTPUT\':str(BASE/','FINANCE_P06_OUTPUT\':str(BASE/').replace("[sys.executable,'qa/finance-p04/prepare-contract-drivers.py']","[sys.executable,str(PREP/'drivers/prepare-contract-drivers.py')]")
after=after.replace("[sys.executable,'qa/finance-p04/upgraded-legacy-http.py','task21'],{'FINANCE_P06_OUTPUT':str(BASE/'upgraded-task21')}","[sys.executable,str(PREP/'drivers/upgraded-legacy-http.py'),'task21'],{'FINANCE_P04_OUTPUT':str(BASE/'upgraded-task21')}")
target=ROOT/'qa/finance-p06/full-regression.py'
if target.exists():assert target.read_text()==after,'Keep an existing runner with different contents'
else:target.write_text(after)
(OUT/'full-regression-adaptation.diff').write_text(''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True))))
print('Prepared independent P06 evidence paths and unmodified old oracles')
