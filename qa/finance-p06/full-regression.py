"""Fresh whole regression; one Gradle/archive owner and no output to old seals."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,shutil,subprocess,sys,uuid
ROOT=Path(__file__).resolve().parents[2];PARENT=ROOT/'docs/migration-evidence/finance-p04/p06-validation'
parser=argparse.ArgumentParser();parser.add_argument('--label',default='final-r1');parser.add_argument('--resume-interrupted-tail',action='store_true');args=parser.parse_args()
assert args.label.startswith('final-r') and args.label[7:].isdigit()
BASE=PARENT/args.label;PREP=PARENT/'preparation'
if args.resume_interrupted_tail:
    # The first native bridge invocation was interrupted before any JUnit or
    # result manifest existed. Keep the completed Node/full-Android evidence
    # and every failed command record; only restart this unfinished tail.
    assert BASE.is_dir() and not (BASE/'regression/jvm-commands.json').exists()
    assert not (BASE/'contract-input-drivers').exists()
    assert not (BASE/'extra-commands-resume-r1.json').exists()
    original=json.loads((BASE/'extra-commands.json').read_text())
    assert [r['name'] for r in original]==['node-full','android-full','android-test-build','jvm-regression','prepare-contract']
    assert original[2]['exit_code']==0 and original[3]['exit_code']!=0 and original[4]['exit_code']!=0
    record=json.loads((BASE/'android-current/command.json').read_text())
    assert record['source_stable'] and record['cases']
    for name,digest in record['source_after']['files'].items():
        assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,name
    trace=BASE/'regression/trace-five.log'
    assert trace.is_file() and not trace.is_symlink()
    assert not list((BASE/'regression').glob('*-junit'))
    archive=BASE/'interrupted-tail-r1';archive.mkdir(exist_ok=False)
    target=archive/trace.name
    assert trace.resolve().is_relative_to(BASE.resolve()) and target.resolve().is_relative_to(BASE.resolve())
    preserved={'original_path':str(trace.relative_to(ROOT)),'archive_path':str(target.relative_to(ROOT)),
        'bytes':trace.stat().st_size,'sha256':hashlib.sha256(trace.read_bytes()).hexdigest(),
        'reason':'Interrupted before bridge JUnit/result output. Original parent exit codes/logs retained; no assertion result inferred.'}
    trace.rename(target)
    (archive/'preserved.json').write_text(json.dumps(preserved,indent=2))
else:BASE.mkdir(exist_ok=False)
env=dict(os.environ,**json.loads((PREP/'environment.json').read_text()))
env['PATH']=str(Path(env['FINANCE_NODE']).parent)+os.pathsep+env['PATH'];env['FINANCE_REGRESSION_OUTPUT']=str(BASE/'regression')
for key in list(env):
    if any(x in key.upper() for x in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']):env.pop(key)
token=uuid.uuid4().hex;lock=PARENT/'android-validation.lock'
with lock.open('x') as stream:json.dump({'pid':os.getpid(),'token':token},stream)
rows=[];command_manifest=BASE/('extra-commands-resume-r1.json' if args.resume_interrupted_tail else 'extra-commands.json')
def run(name,argv,extra=None):
    started=datetime.now(timezone.utc).isoformat()
    log_name=('resume-r1-' if args.resume_interrupted_tail else '')+name+'.log'
    with (BASE/log_name).open('xb') as log:p=subprocess.run(argv,cwd=ROOT,env=dict(env,**(extra or {})),stdout=log,stderr=subprocess.STDOUT)
    row={'name':name,'command':argv,'started_utc':started,'finished_utc':datetime.now(timezone.utc).isoformat(),'exit_code':p.returncode,'status':'PASS' if p.returncode==0 else 'FAIL'}
    row['log']=str((BASE/log_name).relative_to(ROOT));rows.append(row);command_manifest.write_text(json.dumps(rows,indent=2));print(json.dumps(row),flush=True);return p.returncode==0
def android(name,source,output,patterns):
    return run(name,[sys.executable,'qa/finance-p04/android.py','--qa-root',str(source),'--qa-output',str(output),*[arg for pattern in patterns for arg in ['--tests',pattern]]],{'FINANCE_P04_OUTPUT':str(BASE/(name+'-command'))})
try:
    if not args.resume_interrupted_tail:
        run('node-full',[sys.executable,'qa/finance-p04/run-regression-node.py'])
        run('android-full',[sys.executable,'qa/finance-p04/android.py'],{'FINANCE_P04_OUTPUT':str(BASE/'android-current')})
    record=json.loads((BASE/'android-current/command.json').read_text());assert record['source_stable'] and record['cases']
    base_arg=next(a for a in record['command'] if a.startswith('-PTHEWYJ_BASE_URL='))
    if not args.resume_interrupted_tail:
        run('android-test-build',['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),':app:assembleDebugAndroidTest','--no-daemon','--max-workers=2','--console=plain',base_arg])
    run('jvm-regression',[sys.executable,'qa/finance-p04/run-regression-jvm.py'])
    contract=BASE/'contract-input-drivers'
    # Generate each run's absolute output path anew. Never copy prior result
    # ndjson files and never execute a driver still targeting a preparation dir.
    assert run('prepare-contract',[sys.executable,'qa/finance-p04/prepare-contract-drivers.py'],
        {'FINANCE_CONTRACT_ROOT':str(contract),'FINANCE_PRIMARY_DOM':str(BASE/'regression/p02-web/web-dom.ndjson')})
    android('declared-native',contract/'native',BASE/'declared-native',['*FinanceP02MatrixTest.D_parserCurrencyTarget'])
    run('declared-dom',[env['FINANCE_NODE'],str(contract/'web-dom-declared-inputs.mjs')],{'FINANCE_P03_OUTPUT':str(contract),'FINANCE_P04_OUTPUT':str(contract)})
    backup=PREP/'backup-proof-source'
    rows.append({'name':'prepare-backup','status':'PASS','scope':'Prepared current schema only; no original money/ID/receipt assertions changed','evidence':str((PREP/'backup.log').relative_to(ROOT))})
    command_manifest.write_text(json.dumps(rows,indent=2))
    if android('backup-seed',backup,BASE/'native-backup',['*CurrencyP04BackupSeedTest']):android('backup-restore',backup,BASE/'native-backup',['*CurrencyP04BackupRestoreTest'])
    explicit=BASE/'explicit-source';(explicit/'kotlin').mkdir(parents=True)
    shutil.copy2(ROOT/'qa/finance-p02/test.init.gradle',explicit/'test.init.gradle');shutil.copy2(ROOT/'qa/finance-p04/closure/kotlin/FinanceClosureContractTest.kt',explicit/'kotlin/FinanceClosureContractTest.kt')
    android('explicit-v2',explicit,BASE/'explicit-v2',['*FinanceClosureContractTest'])
    run('task21-capability3',[sys.executable,'qa/finance-p04/upgraded-legacy-http.py','task21'],{'FINANCE_P04_OUTPUT':str(BASE/'upgraded-task21')})
    run('current-projection',[env['FINANCE_NODE'],'--import',(ROOT/'qa/finance-p04/fresh-inputs.mjs').as_uri(),str(ROOT/'qa/finance-p03/finish/projections.mjs')],{'FINANCE_P03_OUTPUT':str(BASE/'regression/device-projections')})
    run('native-persistence',[env['FINANCE_NODE'],'qa/finance-p03/nonphone/native-persist.mjs'],{'FINANCE_P03_PERSIST_NAME':'native-persist-auto','FINANCE_D1_BRIDGE_INPUT':str(BASE/'regression/unified-bridge/d1-logical-snapshot.json')})
    run('explicit-currency-bridge',[sys.executable,'qa/finance-p04/run-regression-jvm.py','--bridge-only','legacy-bridge'],
        {'FINANCE_REGRESSION_OUTPUT':str(BASE/'derived-current-client'),'FINANCE_P03_COMPAT_ROOT':str(ROOT/'docs/migration-evidence/finance-p04/local/bridge-currency-context')})
    scan=BASE/'scan-process-source';(scan/'kotlin').mkdir(parents=True);shutil.copy2(ROOT/'qa/finance-p02/test.init.gradle',scan/'test.init.gradle');shutil.copy2(ROOT/'qa/finance-p05/kotlin/P05ScanProcessTest.kt',scan/'kotlin/P05ScanProcessTest.kt')
    if android('scan-process-seed',scan,BASE/'scan-process',['*P05ScanBudgetSeedTest']):android('scan-process-restore',scan,BASE/'scan-process',['*P05ScanBudgetRestoreTest'])
    assert all(r['cases'] for r in json.loads((BASE/'regression/jvm-commands.json').read_text()))
finally:
    command_manifest.write_text(json.dumps(rows,indent=2))
    if json.loads(lock.read_text())=={'pid':os.getpid(),'token':token}:lock.unlink()
