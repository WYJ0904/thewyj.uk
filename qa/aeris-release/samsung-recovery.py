"""Two paced, bounded lifecycle observations on the newly installed QA only."""
from pathlib import Path
import argparse,hashlib,json,os,re,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/aeris-p03-p07'
p=argparse.ArgumentParser();p.add_argument('--attempt',default='r2');a=p.parse_args();assert re.fullmatch('r[1-9][0-9]*',a.attempt)
OUT=E/('v62-samsung-recovery-'+a.attempt);OUT.mkdir(exist_ok=False)
serial=os.environ.get('AERIS_QA_SERIAL');assert serial and re.fullmatch('[A-Za-z0-9_-]+',serial)
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
base=['python',str(ROOT/'qa/aeris-release/samsung-preview.py')];rows=[]
def helper(action,label=None):
 args=base+[action,'--serial',serial]
 if label:args+=['--label',label,'--no-image']
 p=subprocess.run(args,cwd=ROOT,capture_output=True,timeout=40)
 (OUT/((label or action)+'.log')).write_bytes(p.stdout+p.stderr)
 assert p.returncode==0,action+' failed; diagnostic retained'
 return p
try:
 helper('home');time.sleep(8)
 for name,action in [('background-resume','launch'),('process-restart','restart')]:
  p=helper(action);start=time.monotonic();samples=[];ready=False
  while time.monotonic()-start<18:
   remaining=20-(time.monotonic()-start);label=name+'-'+a.attempt+'-s'+str(len(samples)+1)
   try:q=subprocess.run([str(node),str(ROOT/'qa/aeris-release/samsung-webview-readonly.mjs'),label],cwd=ROOT,capture_output=True,timeout=remaining)
   except subprocess.TimeoutExpired:
    samples.append(dict(elapsed_ms=round((time.monotonic()-start)*1000),status='OBSERVER_DEADLINE'));break
   (OUT/(label+'.log')).write_bytes(q.stdout+q.stderr)
   actual=json.loads((E/'v62-samsung-preview-r1'/(label+'.json')).read_text());value=actual.get('actual',{})
   elapsed=time.monotonic()-start
   ready=q.returncode==0 and elapsed<=20 and value.get('matchesValidationAccount')is True and value.get('readyState')=='complete' and value.get('path')=='/' and value.get('policy')=='enabled' and len([c for c in value.get('cards',[])if c['visible']])==3
   samples.append(dict(elapsed_ms=round(elapsed*1000),status='READY'if ready else 'NOT_READY',path=value.get('path'),policy=value.get('policy')))
   if ready:break
   time.sleep(min(1,max(0,20-(time.monotonic()-start))))
  (OUT/(name+'-samples.json')).write_text(json.dumps(samples,indent=2))
  assert ready,'20-second readiness contract not established; all observations preserved'
  helper('snapshot',name+'-native-state-'+a.attempt)
  rows.append(dict(id=name,status='PASS',observation_ms=round(elapsed*1000),deadline_ms=20000,
    actual_native_session=True,own_preview_document=True,three_cards_in_document=True,
    native_lifecycle='RESUMED',samples=samples,launch_output=p.stdout.decode('utf8','replace')))
except Exception as error:rows.append(dict(id='lifecycle-observation',status='FAIL',error_type=type(error).__name__,error=str(error)[:200]))
result=dict(device_serial_sha256=hashlib.sha256(serial.encode()).hexdigest(),rows=rows,
 pass_count=sum(r['status']=='PASS'for r in rows),fail_count=sum(r['status']=='FAIL'for r in rows),
 scope='Actual product MainActivity in independent Debug/Preview package; no screen-off, payment, notification or accessibility-service experiment',
 formal_app_stopped=False,minimum_ui_action_spacing_seconds=8)
(OUT/'result.json').write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result))
if result['fail_count']:raise SystemExit(1)
