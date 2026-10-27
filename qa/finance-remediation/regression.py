"""Fresh complete non-phone regression; original assertions are delegated unchanged."""
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import argparse,hashlib,json,os,shutil,subprocess,sys

ROOT=Path(__file__).resolve().parents[2]
E=ROOT/'docs/migration-evidence/finance-p04/remediation'
parser=argparse.ArgumentParser();parser.add_argument('--label',default='final-r1');args=parser.parse_args()
assert args.label.startswith('final-r') and args.label[7:].isdigit()
BASE=E/args.label;BASE.mkdir(exist_ok=False)
PREP=E/'preparation'
env=dict(os.environ,**json.loads((PREP/'environment.json').read_text()))
env['FINANCE_REGRESSION_OUTPUT']=str(BASE/'regression')
env['PATH']=str(Path(env['FINANCE_NODE']).parent)+os.pathsep+env['PATH']
for key in list(env):
    if any(x in key.upper() for x in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']):env.pop(key)
lock=E/'gradle.lock'
with lock.open('x') as stream:json.dump({'pid':os.getpid(),'base':str(BASE)},stream)
rows=[]
def run(name,command,extra=None):
    started=datetime.now(timezone.utc).isoformat()
    with (BASE/(name+'.log')).open('xb') as log:
        p=subprocess.run(command,cwd=ROOT,env=dict(env,**(extra or {})),stdout=log,stderr=subprocess.STDOUT)
    row=dict(name=name,command=command,started_utc=started,finished_utc=datetime.now(timezone.utc).isoformat(),exit_code=p.returncode,log=str((BASE/(name+'.log')).relative_to(ROOT)))
    rows.append(row);(BASE/'extra-commands.json').write_text(json.dumps(rows,indent=2))
    print(json.dumps({k:v for k,v in row.items() if k!='command'}),flush=True)
    return p.returncode==0
def android(name,source,output,patterns):
    return run(name,[sys.executable,'qa/finance-p04/android.py','--qa-root',str(source),'--qa-output',str(output),*[a for p in patterns for a in ['--tests',p]]],{'FINANCE_P04_OUTPUT':str(BASE/(name+'-command'))})
try:
    # Independent Node/Chrome and JVM tasks may run concurrently; only one Gradle owner.
    with ThreadPoolExecutor(max_workers=1) as pool:
        node=pool.submit(run,'node-full',[sys.executable,'qa/finance-p04/run-regression-node.py'])
        run('android-full',[sys.executable,'qa/finance-p04/android.py'],{'FINANCE_P04_OUTPUT':str(BASE/'android-current')})
        run('jvm-regression',[sys.executable,'qa/finance-p04/run-regression-jvm.py'])
        android('explicit-v2',PREP/'explicit-source',BASE/'explicit-v2',['*FinanceClosureContractTest'])
        if android('backup-seed',PREP/'backup-proof-source',BASE/'native-backup',['*CurrencyP04BackupSeedTest']):
            android('backup-restore',PREP/'backup-proof-source',BASE/'native-backup',['*CurrencyP04BackupRestoreTest'])
        run('explicit-currency-bridge',[sys.executable,'qa/finance-p04/run-regression-jvm.py','--bridge-only','legacy-bridge'],
            {'FINANCE_REGRESSION_OUTPUT':str(BASE/'derived-current-client'),'FINANCE_P03_COMPAT_ROOT':str(E/'fixtures/explicit-currency-bridge')})
        scan=BASE/'scan-process-source';(scan/'kotlin').mkdir(parents=True)
        for src,dest in [(ROOT/'qa/finance-p02/test.init.gradle',scan/'test.init.gradle'),(ROOT/'qa/finance-p05/kotlin/P05ScanProcessTest.kt',scan/'kotlin/P05ScanProcessTest.kt')]:dest.write_bytes(src.read_bytes())
        if android('scan-process-seed',scan,BASE/'scan-process',['*P05ScanBudgetSeedTest']):
            android('scan-process-restore',scan,BASE/'scan-process',['*P05ScanBudgetRestoreTest'])
        node.result()
    contract=BASE/'contract-input-drivers'
    if run('prepare-contract',[sys.executable,'qa/finance-p04/prepare-contract-drivers.py'],{'FINANCE_CONTRACT_ROOT':str(contract),'FINANCE_PRIMARY_DOM':str(BASE/'regression/p02-web/web-dom.ndjson')}):
        android('declared-native',contract/'native',BASE/'declared-native',['*FinanceP02MatrixTest.D_parserCurrencyTarget'])
        run('declared-dom',[env['FINANCE_NODE'],str(contract/'web-dom-declared-inputs.mjs')],{'FINANCE_P03_OUTPUT':str(contract),'FINANCE_P04_OUTPUT':str(contract)})
    run('task21-capability3',[sys.executable,'qa/finance-p04/upgraded-legacy-http.py','task21'],{'FINANCE_P04_OUTPUT':str(BASE/'upgraded-task21')})
    run('current-projection',[env['FINANCE_NODE'],'--import',(ROOT/'qa/finance-p04/fresh-inputs.mjs').as_uri(),str(ROOT/'qa/finance-p03/finish/projections.mjs')],{'FINANCE_P03_OUTPUT':str(BASE/'regression/device-projections')})
    run('native-persistence',[env['FINANCE_NODE'],'qa/finance-p03/nonphone/native-persist.mjs'],{'FINANCE_P03_PERSIST_NAME':'native-persist-auto','FINANCE_D1_BRIDGE_INPUT':str(BASE/'regression/unified-bridge/d1-logical-snapshot.json')})
finally:
    (BASE/'extra-commands.json').write_text(json.dumps(rows,indent=2))
    if json.loads(lock.read_text())['pid']==os.getpid():lock.unlink()
print('Full command manifest retained, including every nonzero command. No summed overlapping count.',flush=True)
