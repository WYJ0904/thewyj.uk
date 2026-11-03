"""Compare a separate script model on byte-identical saved specimens, no hints."""
from common import *
import argparse,re
parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r1');parser.add_argument('--build',default='r4');parser.add_argument('--input-sdk',default='r3');args=parser.parse_args()
assert all(re.fullmatch('r[1-9][0-9]*',value) for value in [args.attempt,args.build,args.input_sdk])
OUT=E/('latin-'+args.attempt);OUT.mkdir(exist_ok=False)
record=dict(started_utc=utc(),status='IN_PROGRESS',external_model_calls=0,ledger_writes=0,phone_operations=0,
    production_ocr_changed=False,original_chinese_results_replaced=False)
try:
    emulator_guard();build=json.loads((E/('sdk-build-'+args.build)/'result.json').read_text());assert build['status']=='PASS'
    record['build_manifest_sha256']=sha(E/('sdk-build-'+args.build)/'result.json')
    for artifact in build['artifacts']:
        apk=ROOT/artifact['path'];assert sha(apk)==artifact['sha256']
        assert b'Success' in adb('install','-r','-t',str(apk),timeout=120)
    cmd=[str(SDK/'platform-tools/adb.exe'),'-P',PORT,'-s',SERIAL,'shell','am','instrument','-w','-r',
         '-e','class','uk.thewyj.app.task21.payment.LatinReferenceDiagnosticTest#samePixelsWithIndependentLatinRecognizer',
         PKG+'.test/androidx.test.runner.AndroidJUnitRunner']
    with (OUT/'instrument.log').open('xb') as log:
        p=subprocess.run(cmd,env=environment(),stdout=log,stderr=subprocess.STDOUT,timeout=180)
    record.update(command=cmd,exit_code=p.returncode)
    log=(OUT/'instrument.log').read_text(errors='replace');assert p.returncode==0 and 'OK (1 test)' in log
    raw=adb('exec-out','run-as',PKG,'cat','files/latin-diagnostic/results.json')
    (OUT/'results.json').write_bytes(raw);rows=json.loads(raw);assert len(rows)==14
    assert all(row['status']=='EXECUTED' for row in rows),'Instrumentation completion alone is not SDK execution success'
    for row in rows:
        base='original' if row['group']=='original-six' else 'corpus'
        assert row['input_sha256']==sha(E/('sdk-'+args.input_sdk)/base/(row['view']+'.png'))
    original=[row for row in rows if row['group']=='original-six']
    record.update(status='PASS',rows=len(rows),original_views=6,
        original_exact_text_seen=sum(any('SYNTH-P06-JOINT-123456' in line for line in row.get('lines',[])) for row in original),
        note='Model-comparison text recovery only. Original Chinese 0/6 retained; no product fallback was enabled.')
except Exception as error:record.update(status='FAIL',error=str(error))
finally:
    record['finished_utc']=utc();write(OUT/'result.json',record);print(json.dumps(record))
raise SystemExit(0 if record['status']=='PASS' else 1)
