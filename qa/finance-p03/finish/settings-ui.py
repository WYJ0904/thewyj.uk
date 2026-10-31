"""Normal Android Settings UI via the QA runner, never secure-settings writes.

Root access is gated in the native helper to Settings/permission controller.
Every helper invocation is maintenance, excluded from business acceptance.
"""
from pathlib import Path
import argparse,hashlib,json,re,shlex,subprocess,sys
sys.dont_write_bytecode=True
import phone
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['probe','nodes','click']);parser.add_argument('--name',required=True);parser.add_argument('--text');parser.add_argument('--resource');parser.add_argument('--index',type=int);a=parser.parse_args()
assert re.fullmatch('[a-z0-9-]+',a.name)
assert a.action!='click','Use settings-shell-ui.py for grant taps outside target instrumentation; the instrumented helper left an enabled-but-unbound service in this run'
dest=phone.OUT/'settings-ui';dest.mkdir(exist_ok=True);log=dest/(a.name+'.log');result=dest/(a.name+'.json');assert not log.exists() and not result.exists()
s=phone.device();owned=json.loads((phone.OUT/'owned-install.json').read_text());assert owned['package']==phone.PKG and owned['device_sha256']==hashlib.sha256(s.encode()).hexdigest()
assert not phone.state(s)['formal_nls_enabled']
args=['am','instrument','-w','-r','-e','class','uk.thewyj.app.qa.finance.FinanceFinishSettingsUiTest','-e','qa_ui_action',a.action]
for key,value in [('qa_ui_text',a.text),('qa_ui_id',a.resource),('qa_ui_index',a.index)]:
    if value is not None:args+=['-e',key,str(value)]
args+=[phone.TEST+'/'+phone.RUNNER]
p=subprocess.run([str(phone.ADB),'-s',s,'shell',shlex.join(args)],capture_output=True,timeout=45)
text=p.stdout.decode('utf8',errors='replace');log.write_text(text,encoding='utf8')
ok=p.returncode==0 and 'OK (1 test)' in text and 'FAILURES!!!' not in text
data={'status':'PASS' if ok else 'FAIL','maintenance_only':True,'action':a.action,'exit':p.returncode,'no_permission_database_writes':True,'log':log.relative_to(phone.ROOT).as_posix()}
if ok:
    r=subprocess.run([str(phone.ADB),'-s',s,'exec-out','run-as',phone.PKG,'cat','files/finance-p03-device/ui-helper.json'],capture_output=True,timeout=15);assert r.returncode==0
    data['observed']=json.loads(r.stdout)
result.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
printed=dict(data)
if 'observed' in printed:
    printed['observed']=dict(printed['observed'])
    if 'nodes' in printed['observed']:printed['observed']['nodes']=[r for r in printed['observed']['nodes'] if r['text'] or r['checkable']]
print(json.dumps(printed,ensure_ascii=False));assert ok
