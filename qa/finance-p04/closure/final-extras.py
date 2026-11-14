"""Fresh versioned contracts, backup, legacy bridge and native persistence; independent failures continue."""
from pathlib import Path
from datetime import datetime,timezone
import json,os,subprocess,sys
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'docs/migration-evidence/finance-p04/closure-current/final-current'
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
REG=BASE/'regression'
dest=BASE/'extra-commands.json';assert not dest.exists()
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
environment=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_HOME=str(Path.home()/'AppData/Local/Android/Sdk'),FINANCE_NODE=str(node),FINANCE_REGRESSION_OUTPUT=str(REG),AERIS_TEST_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe')
environment['PATH']=str(node.parent)+os.pathsep+environment.get('PATH','')
rows=[]
def run(name,command,env=None):
    start=datetime.now(timezone.utc).isoformat()
    with (BASE/(name+'.log')).open('xb') as stream:result=subprocess.run(command,cwd=ROOT,env=dict(environment,**(env or {})),stdout=stream,stderr=subprocess.STDOUT)
    rows.append({'name':name,'command':command,'exit_code':result.returncode,'status':'PASS' if result.returncode==0 else 'FAIL','started':start,'finished':datetime.now(timezone.utc).isoformat()})
    dest.write_text(json.dumps(rows,indent=2));print(name+': '+rows[-1]['status'],flush=True)
    return result.returncode==0
run('prepare-backup',[sys.executable,str(ROOT/'qa/finance-p04/prepare-backup-proof.py')],{'FINANCE_BACKUP_ROOT':str(BASE/'backup-proof-source')})
for name,source,output,test in [
    ('declared-native',BASE/'contract-input-drivers/native',BASE/'declared-native','*FinanceP02MatrixTest.D_parserCurrencyTarget'),
    ('explicit-v2',OUT/'native-source-r3',BASE/'explicit-v2','*FinanceClosureContractTest'),
    ('backup-seed',BASE/'backup-proof-source',BASE/'native-backup','*CurrencyP04BackupSeedTest'),
    ('backup-restore',BASE/'backup-proof-source',BASE/'native-backup','*CurrencyP04BackupRestoreTest'),
]:
    if name=='backup-restore' and not next(r for r in rows if r['name']=='backup-seed')['status']=='PASS':
        rows.append({'name':name,'status':'NOT_TESTED','reason':'Seed failed; preserve failure'});continue
    run(name,[sys.executable,str(ROOT/'qa/finance-p04/android.py'),'--qa-root',str(source),'--qa-output',str(output),'--tests',test],{'FINANCE_P04_OUTPUT':str(BASE/(name+'-command'))})
run('declared-dom',[str(node),str(BASE/'contract-input-drivers/web-dom-declared-inputs.mjs')],{'FINANCE_P03_OUTPUT':str(BASE/'contract-input-drivers'),'FINANCE_P04_OUTPUT':str(BASE/'contract-input-drivers')})
run('task21-capability3',[sys.executable,str(ROOT/'qa/finance-p04/upgraded-legacy-http.py'),'task21'],{'FINANCE_P04_OUTPUT':str(BASE/'upgraded-task21')})
run('current-projection',[str(node),'--import',(ROOT/'qa/finance-p04/fresh-inputs.mjs').as_uri(),str(ROOT/'qa/finance-p03/finish/projections.mjs')],{'FINANCE_P03_OUTPUT':str(REG/'device-projections')})
run('native-persistence',[str(node),str(ROOT/'qa/finance-p03/nonphone/native-persist.mjs')],{'FINANCE_P03_PERSIST_NAME':'native-persist-auto','FINANCE_D1_BRIDGE_INPUT':str(REG/'unified-bridge/d1-logical-snapshot.json')})
run('explicit-currency-bridge',[sys.executable,str(ROOT/'qa/finance-p04/run-regression-jvm.py'),'--bridge-only','legacy-bridge'],{'FINANCE_REGRESSION_OUTPUT':str(BASE/'derived-current-client'),'FINANCE_P03_COMPAT_ROOT':str(ROOT/'docs/migration-evidence/finance-p04/local/bridge-currency-context')})
assert all(row['status']=='PASS' for row in rows)
