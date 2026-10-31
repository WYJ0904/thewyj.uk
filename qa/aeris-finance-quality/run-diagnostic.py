"""Record direct task failure/readiness, then pull all unchanged-oracle artifacts."""
from common import *
import argparse

parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r2');args=parser.parse_args()
assert args.attempt.startswith('r') and args.attempt[1:].isdigit()
OUT=E/('sdk-'+args.attempt);OUT.mkdir(exist_ok=False)
record=dict(status='IN_PROGRESS',started_utc=utc(),external_model_calls=0,phone_operations=0,
    product_timeout_changed=False,commands=[])
build=json.loads((E/('sdk-build-'+args.attempt)/'result.json').read_text());assert build['status']=='PASS'
def pull(remote,dest):
    raw=adb('exec-out','run-as',PKG,'cat','files/'+remote)
    digest=adb('shell','run-as',PKG,'sha256sum','files/'+remote).decode().split()[0]
    dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw);assert sha(dest)==digest
    return raw
try:
    emulator_guard()
    for artifact in build['artifacts']:
        apk=ROOT/artifact['path'];assert sha(apk)==artifact['sha256']
        assert b'Success' in adb('install','-r','-t',str(apk),timeout=120)
    cmd=[str(SDK/'platform-tools/adb.exe'),'-P',PORT,'-s',SERIAL,'shell','am','instrument','-w','-r',
         '-e','class','uk.thewyj.app.task21.payment.RawOcrDiagnosticTest#directSdkThenUnchangedOracles',
         PKG+'.test/androidx.test.runner.AndroidJUnitRunner']
    logcmd=[str(SDK/'platform-tools/adb.exe'),'-P',PORT,'-s',SERIAL,'logcat','-T','1','-v','threadtime']
    with (OUT/'logcat-live.txt').open('xb') as logcat:
        logger=subprocess.Popen(logcmd,env=environment(),stdout=logcat,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            with (OUT/'instrument.log').open('xb') as log:
                p=subprocess.run(cmd,env=environment(),stdout=log,stderr=subprocess.STDOUT,timeout=180)
        finally:logger.terminate();logger.wait(timeout=10)
    result=(OUT/'instrument.log').read_text(errors='replace')
    record['commands'].append(dict(command=cmd,exit_code=p.returncode,junit_pass=p.returncode==0 and 'OK (1 test)' in result))
    record['direct']=json.loads(pull('raw-sdk-diagnostic/direct.json',OUT/'direct.json'))
    for folder,name in [('reference-corpus','corpus'),('reference-probe-r2','original')]:
        try:
            rows=json.loads(pull(folder+('/results.json' if name=='corpus' else '/views.json'),OUT/name/('results.json' if name=='corpus' else 'views.json')))
            for row in rows:
                filename=(row['id'] if name=='corpus' else row['view'])+'.png'
                pull(folder+'/'+filename,OUT/name/filename)
            if name=='corpus':record['corpus']=dict(specimens=len(rows),safety_pass=sum(r['status']=='PASS' for r in rows),decoder_exact=sum(r['decoder_exact'] for r in rows),ledger_writes=0)
            else:
                assert sha(OUT/'original/original.png')==json.loads((E/'baseline.json').read_text())['original_pixels_sha256']
                record['original']=dict(completed_views=len(rows),all_six_completed=len(rows)==6,
                    decoder_exact=sum(any('SYNTH-P06-JOINT-123456' in line for line in r['lines']) for r in rows),
                    original_pixels_sha256=sha(OUT/'original/original.png'))
        except Exception as error:record[name+'_collection_error']=str(error)
    record['status']='PASS' if record['commands'][0]['junit_pass'] else 'FAIL'
except Exception as error:record.update(status='FAIL',error=str(error))
finally:
    record['finished_utc']=utc();write(OUT/'result.json',record);print(json.dumps(record))
raise SystemExit(0 if record['status']=='PASS' else 1)
