from common import *
import argparse,xml.etree.ElementTree as ET
parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['before','after']);args=parser.parse_args()
OUT=E/('reference-normalization-'+args.phase);OUT.mkdir(exist_ok=False)
cmd=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),':app:testDebugUnitTest','--tests','*PaymentReferenceNormalizationTest','--no-daemon','--max-workers=2','--console=plain','--stacktrace']
start=utc();before=sha(ROOT/'android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentScreenshotVerifier.kt')
with (OUT/'gradle.log').open('xb') as log:p=subprocess.run(cmd,cwd=ROOT,env=environment(),stdout=log,stderr=subprocess.STDOUT,timeout=600)
cases=[]
for source in (ROOT/'android/app/build/test-results/testDebugUnitTest').glob('*PaymentReferenceNormalizationTest*.xml'):
    (OUT/source.name).write_bytes(source.read_bytes())
    for c in ET.parse(source).getroot().findall('testcase'):
        failure=c.find('failure');cases.append(dict(name=c.get('name'),status='PASS' if failure is None else 'FAIL',error='' if failure is None else ''.join(failure.itertext())))
write(OUT/'result.json',dict(command=cmd,exit_code=p.returncode,started=start,finished=utc(),cases=cases,source_sha256=before,source_stable=before==sha(ROOT/'android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentScreenshotVerifier.kt')))
print(json.dumps(dict(exit_code=p.returncode,tests=len(cases),PASS=sum(x['status']=='PASS' for x in cases),FAIL=sum(x['status']=='FAIL' for x in cases))))
raise SystemExit(p.returncode)
