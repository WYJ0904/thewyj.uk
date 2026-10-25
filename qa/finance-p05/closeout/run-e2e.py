"""Two JVMs, actual SDK observations, real local API auth/D1 and isolated Chrome."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,secrets,shutil,subprocess,time,urllib.request
ROOT=Path(__file__).resolve().parents[3];E=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout'
parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r1');parser.add_argument('--sdk',default='r3');args=parser.parse_args()
assert args.attempt.startswith('r') and args.attempt[1:].isdigit() and args.sdk.startswith('r') and args.sdk[1:].isdigit()
OUT=E/('e2e-'+args.attempt);OUT.mkdir(exist_ok=False);private=OUT/'private';private.mkdir()
source=E/('emulator-'+args.sdk)/'native/results.ndjson'
pixels=[json.loads(s) for s in source.read_text().splitlines() if s]
assert next(r for r in pixels if r['id']=='cny-cent')['status']=='PASS'
(OUT/'sdk-inputs.json').write_text(json.dumps(pixels,indent=2))
config={'account_id':'synthetic-closeout-owner','device_id':'synthetic-closeout-device','session':secrets.token_urlsafe(32)}
(private/'context.json').write_text(json.dumps(config))
qa=OUT/'qa';(qa/'kotlin').mkdir(parents=True);shutil.copy2(ROOT/'qa/finance-p02/test.init.gradle',qa/'test.init.gradle')
shutil.copy2(ROOT/'qa/finance-p05/closeout/kotlin/CloseoutFlowTest.kt',qa/'kotlin/CloseoutFlowTest.kt')
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',FINANCE_E2E_OUTPUT=str(OUT),FINANCE_NODE=str(node),AERIS_TEST_CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe')
env['PATH']=str(node.parent)+os.pathsep+env['PATH']
for key in list(env):
    if any(s in key.upper() for s in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']):env.pop(key)
rows=[];server=None;port=None
def run(name,cmd,extra=None):
    started=datetime.now(timezone.utc).isoformat()
    with (OUT/(name+'.log')).open('xb') as log:p=subprocess.run(cmd,cwd=ROOT,env=dict(env,**(extra or {})),stdout=log,stderr=subprocess.STDOUT)
    row={'name':name,'command':cmd,'started_utc':started,'finished_utc':datetime.now(timezone.utc).isoformat(),'exit_code':p.returncode}
    rows.append(row);(OUT/'commands.json').write_text(json.dumps(rows,indent=2));print(json.dumps(row),flush=True);return p.returncode==0
def native(name,klass):return run(name,['python','qa/finance-p04/android.py','--qa-root',str(qa),'--qa-output',str(OUT/'native'),'--tests','*'+klass],{'FINANCE_P04_OUTPUT':str(OUT/(name+'-command'))})
record={'started_utc':datetime.now(timezone.utc).isoformat(),'status':'IN_PROGRESS','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'actual_sdk_source':str(source.relative_to(ROOT)),'sdk_source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
    'real_phone_operations':False,'production_or_preview_mutations':False,'synthetic_only':True}
try:
    assert native('seed','CloseoutFlowSeedTest'),'Seed failed; other cases remain independently runnable'
    log=(OUT/'server.log').open('xb');server=subprocess.Popen([str(node),'qa/finance-p05/closeout/e2e-server.mjs'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
    deadline=time.monotonic()+60
    while time.monotonic()<deadline:
        assert server.poll() is None,'Owned server exited before readiness'
        if (OUT/'port.json').exists():
            port=json.loads((OUT/'port.json').read_text());assert port['pid']==server.pid;break
        time.sleep(.2)
    else:raise TimeoutError('Owned local server readiness deadline')
    assert native('restore','CloseoutFlowRestoreTest'),'Restore assertions failed'
    assert run('browser',[str(node),'qa/finance-p05/closeout/e2e-browser.mjs']),'Browser assertions failed'
    record['status']='SYNTHETIC_E2E_PASS'
except Exception as error:record.update(status='FAIL',error=str(error))
finally:
    if server is not None and port is not None:
        try:
            req=urllib.request.Request('http://127.0.0.1:'+str(port['port'])+'/__test/stop',data=b'{}',headers={'X-Session-Token':config['session']})
            urllib.request.urlopen(req,timeout=10).close()
        except Exception as error:record['stop_error']=str(error)
        deadline=time.monotonic()+120
        while server.poll() is None and time.monotonic()<deadline:time.sleep(.2)
        record['server_exited']=server.poll() is not None
    record['finished_utc']=datetime.now(timezone.utc).isoformat();(OUT/'result.json').write_text(json.dumps(record,indent=2));print(json.dumps(record),flush=True)
