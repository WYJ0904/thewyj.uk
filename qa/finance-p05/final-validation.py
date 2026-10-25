"""One serial Android/archive owner, current Node byte binding and fresh end-to-end fixtures."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,shutil,subprocess,sys,uuid
ROOT=Path(__file__).resolve().parents[2]
PARENT=ROOT/'docs/migration-evidence/finance-p04/continuation-p05'
BASE=PARENT/'final-r5';BASE.mkdir(exist_ok=False)
PREP=PARENT/'final-r2'
env=dict(os.environ,**json.loads((PREP/'environment-paths.json').read_text()))
env['PATH']=str(Path(env['FINANCE_NODE']).parent)+os.pathsep+env['PATH']
env['FINANCE_REGRESSION_OUTPUT']=str(BASE/'regression')
for key in list(env):
    if any(part in key.upper() for part in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']):env.pop(key)
lock=PARENT/'android-validation.lock';token=uuid.uuid4().hex
with lock.open('x') as stream:json.dump({'pid':os.getpid(),'token':token,'root':str(ROOT)},stream)
rows=[];dest=BASE/'extra-commands.json'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(name,argv,extra=None):
    started=datetime.now(timezone.utc).isoformat()
    with (BASE/(name+'.log')).open('x') as log:
        result=subprocess.run(argv,cwd=ROOT,env=dict(env,**(extra or {})),stdout=log,stderr=subprocess.STDOUT)
    row={'name':name,'command':argv,'started_utc':started,'finished_utc':datetime.now(timezone.utc).isoformat(),
         'exit_code':result.returncode,'status':'PASS' if result.returncode==0 else 'FAIL'}
    rows.append(row);dest.write_text(json.dumps(rows,indent=2));print(json.dumps(row),flush=True)
    return result.returncode==0
def android(name,source,output,patterns):
    return run(name,[sys.executable,'qa/finance-p04/android.py','--qa-root',str(source),'--qa-output',str(output),
                     *[arg for pattern in patterns for arg in ['--tests',pattern]]],{'FINANCE_P04_OUTPUT':str(BASE/(name+'-command'))})
try:
    # These are this continuation's executions, not historical PASSes. No JS/SQL bytes changed since.
    source=PREP/'regression';node_lock=json.loads((source/'node-source-lock.json').read_text());assert node_lock['source_stable']
    for name,digest in node_lock['after']['files'].items():assert sha(ROOT/name)==digest,name
    copied={}
    for p in source.rglob('*'):
        relative=p.relative_to(source)
        if not p.is_file() or p.is_symlink() or any(part.startswith('owned-browser') or part in {'.wrangler','.cache','node_modules'} for part in relative.parts):continue
        q=BASE/'regression'/relative;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q);assert sha(q)==sha(p);copied[str(relative)]=sha(p)
    (BASE/'node-evidence-copy.json').write_text(json.dumps({'source':str(source.relative_to(ROOT)),'execution_head':node_lock['head'],
        'current_scoped_bytes_identical':True,'copied_current_run_files':copied},indent=2))
    run('android-full',[sys.executable,'qa/finance-p04/android.py'],{'FINANCE_P04_OUTPUT':str(BASE/'android-current')})
    assert (BASE/'android-current/command.json').exists(),'No full archive; do not borrow another run'
    record=json.loads((BASE/'android-current/command.json').read_text());assert record['source_stable']
    launcher=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat')]
    base_arg=next(x for x in record['command'] if x.startswith('-PTHEWYJ_BASE_URL='))
    run('android-test-build',launcher+['-p',str(ROOT/'android'),':app:assembleDebugAndroidTest','--no-daemon','--max-workers=2','--console=plain',base_arg])
    run('jvm-regression',[sys.executable,'qa/finance-p04/run-regression-jvm.py'])
    # Reconstruct only input adapters and current-schema metadata; frozen sources/oracles remain unchanged.
    contract=BASE/'contract-input-drivers';shutil.copytree(PREP/'contract-input-drivers',contract)
    android('declared-native',contract/'native',BASE/'declared-native',['*FinanceP02MatrixTest.D_parserCurrencyTarget'])
    run('declared-dom',[env['FINANCE_NODE'],str(contract/'web-dom-declared-inputs.mjs')],{'FINANCE_P03_OUTPUT':str(contract),'FINANCE_P04_OUTPUT':str(contract)})
    backup=PREP/'backup-proof-source'
    rows.append({'name':'prepare-backup','status':'PASS','scope':'Current-schema input prepared earlier this continuation; version resolved by product constant at execution','evidence':str((PREP/'backup-preparation.log').relative_to(ROOT))})
    dest.write_text(json.dumps(rows,indent=2))
    seed=android('backup-seed',backup,BASE/'native-backup',['*CurrencyP04BackupSeedTest'])
    if seed:android('backup-restore',backup,BASE/'native-backup',['*CurrencyP04BackupRestoreTest'])
    else:rows.append({'name':'backup-restore','status':'NOT_TESTED','reason':'Seed failed'});dest.write_text(json.dumps(rows,indent=2))
    explicit=BASE/'explicit-source';(explicit/'kotlin').mkdir(parents=True)
    shutil.copy2(ROOT/'qa/finance-p02/test.init.gradle',explicit/'test.init.gradle')
    shutil.copy2(ROOT/'qa/finance-p04/closure/kotlin/FinanceClosureContractTest.kt',explicit/'kotlin/FinanceClosureContractTest.kt')
    android('explicit-v2',explicit,BASE/'explicit-v2',['*FinanceClosureContractTest'])
    run('task21-capability3',[sys.executable,'qa/finance-p04/upgraded-legacy-http.py','task21'],{'FINANCE_P04_OUTPUT':str(BASE/'upgraded-task21')})
    run('current-projection',[env['FINANCE_NODE'],'--import',(ROOT/'qa/finance-p04/fresh-inputs.mjs').as_uri(),str(ROOT/'qa/finance-p03/finish/projections.mjs')],{'FINANCE_P03_OUTPUT':str(BASE/'regression/device-projections')})
    run('native-persistence',[env['FINANCE_NODE'],str(ROOT/'qa/finance-p03/nonphone/native-persist.mjs')],
        {'FINANCE_P03_PERSIST_NAME':'native-persist-auto','FINANCE_D1_BRIDGE_INPUT':str(BASE/'regression/unified-bridge/d1-logical-snapshot.json')})
    run('explicit-currency-bridge',[sys.executable,'qa/finance-p04/run-regression-jvm.py','--bridge-only','legacy-bridge'],
        {'FINANCE_REGRESSION_OUTPUT':str(BASE/'derived-current-client'),'FINANCE_P03_COMPAT_ROOT':str(ROOT/'docs/migration-evidence/finance-p04/local/bridge-currency-context')})
    scan=BASE/'scan-process-source';(scan/'kotlin').mkdir(parents=True)
    shutil.copy2(ROOT/'qa/finance-p02/test.init.gradle',scan/'test.init.gradle')
    shutil.copy2(ROOT/'qa/finance-p05/kotlin/P05ScanProcessTest.kt',scan/'kotlin/P05ScanProcessTest.kt')
    if android('scan-process-seed',scan,BASE/'scan-process',['*P05ScanBudgetSeedTest']):
        android('scan-process-restore',scan,BASE/'scan-process',['*P05ScanBudgetRestoreTest'])
    # Every batch archives its selected cases; reject any evidence from a different concurrent test.
    jvm=json.loads((BASE/'regression/jvm-commands.json').read_text())
    assert all(row['cases'] for row in jvm),'A JVM batch has no fresh test cases'
finally:
    dest.write_text(json.dumps(rows,indent=2))
    if json.loads(lock.read_text())=={'pid':os.getpid(),'token':token,'root':str(ROOT)}:lock.unlink()
