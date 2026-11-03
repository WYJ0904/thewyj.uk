"""Run unchanged eight probes then unchanged six original-pixel views on one VM."""
from common import *
import argparse

parser=argparse.ArgumentParser();parser.add_argument('--label',default='sdk-r1');args=parser.parse_args()
assert args.label.startswith('sdk-r') and args.label[5:].isdigit()
OUT=E/args.label;OUT.mkdir(exist_ok=False)
record=dict(started_utc=utc(),status='IN_PROGRESS',phone_operations=0,external_model_calls=0,commands=[])
build=json.loads((E/'sdk-build-r1/result.json').read_text())
assert build['status']=='PASS'
def pull(remote,dest):
    raw=adb('exec-out','run-as',PKG,'cat','files/'+remote)
    digest=adb('shell','run-as',PKG,'sha256sum','files/'+remote).decode().split()[0]
    dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
    assert sha(dest)==digest
    return digest
try:
    emulator_guard()
    for item in build['artifacts']:
        apk=ROOT/item['path'];assert sha(apk)==item['sha256']
        assert b'Success' in adb('install','-r','-t',str(apk),timeout=120)
    for name,method,folder in [
        ('corpus','degradedReferencesNeverBypassExactSourceBinding','reference-corpus'),
        ('original','sourcePixelViewsWithoutExpectedReferenceHints','reference-probe-r2')]:
        emulator_guard()
        cmd=[str(SDK/'platform-tools/adb.exe'),'-P',PORT,'-s',SERIAL,'shell','am','instrument','-w','-r',
             '-e','class','uk.thewyj.app.task21.payment.ReferenceOcrProbeTest#'+method,
             PKG+'.test/androidx.test.runner.AndroidJUnitRunner']
        with (OUT/(name+'-instrument.log')).open('xb') as log:
            p=subprocess.run(cmd,env=environment(),stdout=log,stderr=subprocess.STDOUT,timeout=180)
        text=(OUT/(name+'-instrument.log')).read_text(errors='replace')
        result=dict(command=cmd,exit_code=p.returncode,junit_pass=p.returncode==0 and 'OK (1 test)' in text)
        record['commands'].append(result);write(OUT/'result.json',record)
        if name=='corpus':
            pull(folder+'/results.json',OUT/'corpus/results.json')
            rows=json.loads((OUT/'corpus/results.json').read_text());assert len(rows)==8
            for row in rows:pull(folder+'/'+row['id']+'.png',OUT/'corpus'/(row['id']+'.png'))
            record['corpus']=dict(specimens=len(rows),safety_pass=sum(r['status']=='PASS' for r in rows),
                decoder_exact=sum(r['decoder_exact'] for r in rows),
                decoder_non_exact=sum(not r['decoder_exact'] for r in rows),
                observer_captured=sum(r['observer_captured'] for r in rows),ledger_writes=0,
                caution='Safety acceptance is separate from exact OCR accuracy.')
        else:
            pull(folder+'/views.json',OUT/'original/views.json')
            rows=json.loads((OUT/'original/views.json').read_text());assert len(rows)==6
            for row in rows:pull(folder+'/'+row['view']+'.png',OUT/'original'/(row['view']+'.png'))
            assert sha(OUT/'original/original.png')==json.loads((E/'baseline.json').read_text())['original_pixels_sha256']
            expected='SYNTH-P06-JOINT-123456'
            record['original']=dict(views=len(rows),exact=sum(any(expected in line for line in row['lines']) for row in rows),
                original_pixels_sha256=sha(OUT/'original/original.png'),
                expected_reference_used_only_for_posthoc_comparison=True)
        assert result['junit_pass'],name+' instrumentation failed'
    record['status']='PASS'
except Exception as error:
    record.update(status='FAIL',error=str(error))
finally:
    record['finished_utc']=utc();write(OUT/'result.json',record);print(json.dumps(record))
raise SystemExit(0 if record['status']=='PASS' else 1)
