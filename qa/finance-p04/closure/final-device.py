"""Final candidate's independent Samsung component reruns; no formal package action."""
from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,sys
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
target=OUT/'samsung-final-components.json';assert not target.exists()
adb=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
subprocess.run([str(adb),'-s','R5CY22MEHJN','reverse','tcp:19443','tcp:19443'],check=True,capture_output=True)
rows=[];authenticated=False
for name,klass,needs_login in [
 ('login','FinanceDeviceSetupTest',False),('smoke','FinanceDeviceSmokeTest',False),
 ('cold-ledger-restore','FinanceDeviceRestoreTest',True),('room-migrations','FinanceDeviceMigrationTest',False),
 ('six-currencies','FinanceP04MoneyDeviceTest',False),('main-surfaces','FinanceDeviceMainTest',True),
]:
    if needs_login and not authenticated:rows.append({'case':name,'status':'NOT_TESTED','reason':'Fresh login failed'});continue
    evidence='samsung-final-'+name+'-r1'
    result=subprocess.run([sys.executable,str(ROOT/'qa/finance-p04/closure/phone.py'),'run','--name',evidence,'--class-name','uk.thewyj.app.qa.finance.'+klass],cwd=ROOT,capture_output=True,text=True)
    data=json.loads((OUT/(evidence+'.json')).read_text());rows.append({'case':name,'status':data['status'],'counts':data.get('counts',{}),'evidence':evidence+'.json','seconds':data.get('seconds')})
    if name=='login':authenticated=result.returncode==0
    target.write_text(json.dumps({'updated':datetime.now(timezone.utc).isoformat(),'tested_product':'73764f77fd02ada240e41c24734e523c5dad8805','rows':rows,'formal_app_touched':False},indent=2))
    print(json.dumps(rows[-1]),flush=True)
assert len(rows)==6 and all(row['status']=='PASS' for row in rows)
