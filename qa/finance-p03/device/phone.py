"""Narrow ADB driver. No formal app mutation, private dump, permission or data reset."""
from pathlib import Path
import argparse,datetime,hashlib,json,re,subprocess,time
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/device'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
PKG='uk.thewyj.app.debug';TEST=PKG+'.p03acceptance'
FORMAL='uk.thewyj.app/uk.thewyj.app.task21.ThewyjNotificationListenerService'
RUNNER='uk.thewyj.app.qa.finance.FinanceDeviceRunner'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def run(*args,timeout=30):
    p=subprocess.run([str(ADB),*args],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=timeout)
    if p.returncode:raise RuntimeError('ADB operation failed: '+p.stderr[-1500:])
    return p.stdout
def device():
    rows=[s for s in run('devices','-l').splitlines() if re.match(r'^\S+\s+device\s+',s)]
    assert len(rows)==1 and 'model:SM_S9360 ' in rows[0]+' ', 'Exactly one authorized Samsung required'
    serial=rows[0].split()[0]
    assert run('-s',serial,'shell','getprop','ro.build.version.sdk').strip()=='36'
    assert run('-s',serial,'shell','am','get-current-user').strip()=='0'
    return serial
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def state(serial):
    n=run('-s',serial,'shell','settings','--user','0','get','secure','enabled_notification_listeners')
    a=run('-s',serial,'shell','settings','--user','0','get','secure','enabled_accessibility_services')
    return {'device_alias':'Samsung-P03','api':36,'model':'SM-S9360','user':0,'formal_nls_enabled':FORMAL in n,'qa_nls_enabled':PKG+'/' in n,'qa_a11y_enabled':PKG+'/' in a,
        'qa_installed':('package:'+PKG) in run('-s',serial,'shell','pm','list','packages','--user','0',PKG).splitlines(),'unique_test_installed':('package:'+TEST) in run('-s',serial,'shell','pm','list','packages','--user','0',TEST).splitlines()}
def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['audit','install','update','instrument','stop-own']);p.add_argument('--name',required=True);p.add_argument('--class-name');p.add_argument('--watchdog',type=int,default=180);args=p.parse_args()
    assert re.fullmatch('[a-z0-9-]+',args.name);dest=OUT/(args.name+'.json');assert not dest.exists(), 'Preserve prior attempt'
    serial=device();before=state(serial);result={'started_utc':now(),'action':args.action,'before':before,'status':'NOT TESTED'}
    try:
        if args.action!='audit':assert not before['formal_nls_enabled'],'Formal listener must be normally paused by owner; synthetic notifications must not enter formal data'
        if args.action in ['install','update']:
            if args.action=='install':assert not before['qa_installed'] and not before['unique_test_installed'],'Never overwrite an existing unowned QA package'
            else:
                owned=json.loads((OUT/'owned-install.json').read_text(encoding='utf8'));assert owned['package']==PKG and owned['device_sha256']==hashlib.sha256(serial.encode()).hexdigest()
                assert before['qa_installed'] and before['unique_test_installed'],'Only this turn installed packages may be updated'
            result['apks']=[]
            for relative in ['build/app/outputs/apk/debug/app-debug.apk','build/app/outputs/apk/androidTest/debug/app-debug-androidTest.apk']:
                apk=OUT/relative;assert apk.is_file()
                output=run('-s',serial,'install','--user','0',*(['-r'] if args.action=='update' else []),'-t',str(apk),timeout=120)
                assert 'Success' in output
                result['apks'].append({'path':apk.relative_to(ROOT).as_posix(),'sha256':sha(apk)})
            run('-s',serial,'reverse','tcp:19443','tcp:19443')
            result['status']='INSTALLED_ISOLATED_QA'
            if args.action=='install':(OUT/'owned-install.json').write_text(json.dumps({'package':PKG,'test_package':TEST,'apks':result['apks'],'device_sha256':hashlib.sha256(serial.encode()).hexdigest()}),encoding='utf8')
        elif args.action in ['instrument','stop-own']:
            owned=json.loads((OUT/'owned-install.json').read_text(encoding='utf8'));assert owned['package']==PKG and owned['device_sha256']==hashlib.sha256(serial.encode()).hexdigest()
            if args.action=='stop-own':
                run('-s',serial,'shell','am','force-stop','--user','0',PKG);result['status']='OWN_QA_STOPPED'
            else:
                assert args.class_name and args.class_name.startswith('uk.thewyj.app.qa.finance.FinanceDevice')
                cmd=['-s',serial,'shell','am','instrument','-w','-r','-e','class',args.class_name,TEST+'/'+RUNNER]
                log=OUT/(args.name+'.log');assert not log.exists()
                start=time.monotonic()
                try:
                    text=run(*cmd,timeout=args.watchdog);log.write_text(text,encoding='utf8')
                    result['elapsed_seconds']=round(time.monotonic()-start,3)
                    codes=[int(n) for n in re.findall(r'^INSTRUMENTATION_STATUS_CODE: (-?\d+)\s*$',text,re.M)]
                    result['counts']={'PASS':codes.count(0),'FAIL':codes.count(-1)+codes.count(-2),'SKIP':codes.count(-3)+codes.count(-4)}
                    result['status']='FAIL' if result['counts']['FAIL'] or 'FAILURES!!!' in text or not re.search(r'OK \(\d+ tests?\)',text) else 'SKIP' if result['counts']['SKIP'] else 'PASS'
                except subprocess.TimeoutExpired as e:
                    raw=e.stdout or b'';log.write_text(raw.decode('utf8',errors='replace') if isinstance(raw,bytes) else raw,encoding='utf8')
                    result['status']='WATCHDOG';result['elapsed_seconds']=round(time.monotonic()-start,3)
                    # Only the package this driver installed is stopped. No global logcat.
                    run('-s',serial,'shell','am','force-stop','--user','0',PKG)
                result['log']=log.relative_to(ROOT).as_posix()
        else:result['status']='READ_ONLY_AUDIT'
    except Exception as e:result.update(status='BLOCKED',reason=str(e));raise
    finally:
        result['finished_utc']=now();dest.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
