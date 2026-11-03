"""Serial JVM/Room/HTTP regression after the full current Android run has archived."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,os,re,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--label',default='final-r3');args=parser.parse_args();assert re.fullmatch('final-r[0-9]+',args.label)
BASE=ROOT/'docs/migration-evidence/finance-p04/continuation-p05'/args.label
PREP=ROOT/'docs/migration-evidence/finance-p04/continuation-p05/final-r2'
env=dict(os.environ,**json.loads((PREP/'environment-paths.json').read_text()))
env['PATH']=str(Path(env['FINANCE_NODE']).parent)+os.pathsep+env['PATH']
env['FINANCE_REGRESSION_OUTPUT']=str(BASE/'regression')
manifest=BASE/'additional-commands.json';assert not manifest.exists()
rows=[]
deadline=time.monotonic()+1800
while not (BASE/'android-current/command.json').exists():
    assert time.monotonic()<deadline,'Full Android run did not archive; do not overlap Gradle'
    time.sleep(2)
def run(name,argv,extra=None):
    started=datetime.now(timezone.utc).isoformat()
    with (BASE/(name+'.log')).open('x') as log:
        p=subprocess.run(argv,cwd=ROOT,env=dict(env,**(extra or {})),stdout=log,stderr=subprocess.STDOUT)
    rows.append({'name':name,'argv':argv,'started_utc':started,'finished_utc':datetime.now(timezone.utc).isoformat(),'exit_code':p.returncode})
    manifest.write_text(json.dumps(rows,indent=2));print(json.dumps(rows[-1]),flush=True)
run('jvm-regression',[sys.executable,'qa/finance-p04/run-regression-jvm.py'])
for name,source,output,pattern in [
    ('declared-native',PREP/'contract-input-drivers/native',BASE/'declared-native','*FinanceP02MatrixTest.D_parserCurrencyTarget'),
    ('backup-seed',PREP/'backup-proof-source',BASE/'native-backup','*CurrencyP04BackupSeedTest'),
    ('backup-restore',PREP/'backup-proof-source',BASE/'native-backup','*CurrencyP04BackupRestoreTest')]:
    if name=='backup-restore' and rows[-1]['exit_code']!=0:
        rows.append({'name':name,'status':'NOT_TESTED','reason':'Seed failed; original failure retained'});manifest.write_text(json.dumps(rows,indent=2));continue
    run(name,[sys.executable,'qa/finance-p04/android.py','--qa-root',str(source),'--qa-output',str(output),'--tests',pattern],{'FINANCE_P04_OUTPUT':str(BASE/(name+'-command'))})
run('declared-dom',[env['FINANCE_NODE'],str(PREP/'contract-input-drivers/web-dom-declared-inputs.mjs')],{'FINANCE_P03_OUTPUT':str(BASE/'declared-dom'),'FINANCE_P04_OUTPUT':str(BASE/'declared-dom')})
run('task21-capability3',[sys.executable,'qa/finance-p04/upgraded-legacy-http.py','task21'],{'FINANCE_P04_OUTPUT':str(BASE/'upgraded-task21')})
run('native-persistence',[env['FINANCE_NODE'],'qa/finance-p03/nonphone/native-persist.mjs'],{'FINANCE_P03_PERSIST_NAME':'native-persist-auto','FINANCE_D1_BRIDGE_INPUT':str(BASE/'regression/unified-bridge/d1-logical-snapshot.json')})
run('current-projection',[env['FINANCE_NODE'],'--import',(ROOT/'qa/finance-p04/fresh-inputs.mjs').as_uri(),'qa/finance-p03/finish/projections.mjs'],{'FINANCE_P03_OUTPUT':str(BASE/'regression/device-projections')})
