"""Bounded actual ML Kit probe on the owned API36 emulator, never USB devices."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2]
E=ROOT/'docs/migration-evidence/finance-p04/convergence'
parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r2');parser.add_argument('--serial',choices=['emulator-5576','emulator-5578'],default='emulator-5576');args=parser.parse_args();assert re.fullmatch('r[2-9][0-9]*',args.attempt)
OUT=E/('reference-corpus-'+args.attempt);OUT.mkdir(exist_ok=False)
SDK=Path.home()/'AppData/Local/Android/Sdk'
PKG='uk.thewyj.app.qa.financep06'
BASE=[str(SDK/'platform-tools/adb.exe'),'-P','5053','-s',args.serial]
record=dict(status='IN_PROGRESS',started=datetime.now(timezone.utc).isoformat(),physical_device=False,steps=[],previous_attempt='Unbounded getprop client was stopped before any specimen ran; preserve tool failure.')
def run(args,timeout=20):
    cmd=BASE+args
    r=subprocess.run(cmd,capture_output=True,timeout=timeout)
    record['steps'].append(dict(command=cmd,exit_code=r.returncode))
    assert r.returncode==0,r.stderr.decode(errors='replace')[:300]
    return r.stdout
try:
    assert run(['shell','getprop','ro.kernel.qemu']).strip()==b'1'
    assert run(['shell','getprop','ro.build.version.sdk']).strip()==b'36'
    for rel,package in [('debug/app-debug.apk',PKG),('androidTest/debug/app-debug-androidTest.apk',PKG+'.test')]:
        apk=ROOT/'android/app/build/outputs/apk'/rel
        desc=subprocess.check_output([str(SDK/'build-tools/36.0.0/aapt2.exe'),'dump','badging',str(apk)],timeout=20,text=True)
        assert "package: name='"+package+"'" in desc
        record.setdefault('apks',[]).append(dict(package=package,sha256=hashlib.sha256(apk.read_bytes()).hexdigest()))
        assert b'Success' in run(['install','-r','-t',str(apk)],120)
    cmd=BASE+['shell','am','instrument','-w','-r','-e','class','uk.thewyj.app.task21.payment.ReferenceOcrProbeTest#degradedReferencesNeverBypassExactSourceBinding',PKG+'.test/uk.thewyj.app.qa.financep06.FinanceP06Runner']
    record['instrument_command']=cmd
    with (OUT/'instrument.log').open('xb') as log:
        r=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=150)
    record['instrument_exit_code']=r.returncode
    assert r.returncode==0 and 'OK (1 test)' in (OUT/'instrument.log').read_text()
    raw=run(['exec-out','run-as',PKG,'cat','files/reference-corpus/results.json']);(OUT/'results.json').write_bytes(raw)
    rows=json.loads(raw);assert len(rows)==8
    for row in rows:
        name=row['id']+'.png';raw=run(['exec-out','run-as',PKG,'cat','files/reference-corpus/'+name])
        digest=run(['shell','run-as',PKG,'sha256sum','files/reference-corpus/'+name]).decode().split()[0]
        assert hashlib.sha256(raw).hexdigest()==digest
        (OUT/name).write_bytes(raw)
    record.update(status='PASS',safety_pass=sum(x['status']=='PASS' for x in rows),specimens=len(rows),decoder_exact=sum(x['decoder_exact'] for x in rows),note='Safety contract PASS is not OCR exact-decoder PASS; synthetic pixels, no financial writes.')
except Exception as error:
    record.update(status='FAIL',error=str(error))
    raise
finally:
    record['finished']=datetime.now(timezone.utc).isoformat()
    (OUT/'command.json').write_text(json.dumps(record,indent=2))
    print(json.dumps({k:v for k,v in record.items() if k not in ['steps','instrument_command','apks']}))
