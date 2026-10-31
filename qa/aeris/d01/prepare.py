"""Copy the ignored phase-3 QA host; modify QA inputs only, preserving the original."""
import argparse
import os
import pathlib
import shutil
import subprocess

root=pathlib.Path(__file__).resolve().parents[3]
here=pathlib.Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=pathlib.Path,default=root/'docs/migration-evidence/d01')
args=parser.parse_args()
evidence=args.output.resolve()
allowed_output=(root/'docs/migration-evidence').resolve()
assert os.path.commonpath([str(evidence),str(allowed_output)])==str(allowed_output), 'QA output must stay in ignored evidence directory'
source=here/'host'
for name in ['qa-host-current','qa-host-control']:
    assert not (evidence/name).exists(), 'Do not overwrite earlier QA inputs'
evidence.mkdir(parents=True,exist_ok=True)
tls=evidence/'fixture-tls';tls.mkdir(exist_ok=False)
openssl=shutil.which('openssl') or str(pathlib.Path(os.environ.get('ProgramW6432',os.environ['ProgramFiles']))/'Git/usr/bin/openssl.exe')
assert pathlib.Path(openssl).is_file(), 'OpenSSL is required to generate an isolated loopback fixture key'
with (tls/'generation.log').open('wb') as log:
    subprocess.run([openssl,'req','-x509','-newkey','rsa:2048','-nodes','-days','7',
        '-keyout',str(tls/'qa-server-key.pem'),'-out',str(tls/'qa-ca.pem'),
        '-config',str(source/'tls/openssl.cnf')],stdout=log,stderr=subprocess.STDOUT,check=True)
for control in [False,True]:
    qa=evidence/('qa-host-control' if control else 'qa-host-current')
    assert not qa.exists(), 'Do not overwrite earlier QA inputs'
    shutil.copytree(source,qa)
    (qa/'res/raw').mkdir(parents=True,exist_ok=True)
    shutil.copy2(tls/'qa-ca.pem',qa/'res/raw/aeris_qa_ca.pem')
    shutil.copy2(tls/'qa-server-key.pem',qa/'tls/qa-server-key.pem')
    suffix='d01control' if control else 'd01'
    init=(qa/'qa.init.gradle').read_text(encoding='utf-8')
    init=init.replace('.qa.stateacceptance', '.qa.'+suffix)
    if control:
        init=init.replace("include '**/*.kt' })", "include '**/*.kt'; exclude '**/StateDeviceAcceptanceTest.kt'; exclude '**/D01RegressionTest.kt' })")
    (qa/'qa.init.gradle').write_text(init,encoding='utf-8')
    manifest=(qa/'AndroidManifest.xml').read_text(encoding='utf-8').replace('Aeris isolated state QA','Aeris D01 isolated QA')
    manifest=manifest.replace('</application>','<activity android:name="uk.thewyj.app.qa.D01PlainActivity" android:exported="false"/></application>')
    (qa/'AndroidManifest.xml').write_text(manifest,encoding='utf-8')
    activity=qa/'src/uk/thewyj/app/qa/StateAcceptanceActivity.kt'
    text=activity.read_text(encoding='utf-8')
    begin=text.index('class AcceptanceApplication')
    end=text.index('/** QA overlay only:')
    text=text[:begin]+'''class AcceptanceApplication : Application() {
    override fun onCreate() { super.onCreate(); AppGraph.initialize(this); D01Probe.start(this) }
}

'''+text[end:]
    text=text.replace('uk.thewyj.app.qa.stateacceptance','uk.thewyj.app.qa.'+suffix)
    if control:
        text=text.replace('state?.deactivate()', '// No deactivate method existed before 9ff7a7f.')
        text=text.replace('pendingRecords=pending,accountId=owner,','pendingRecords=pending,')
    # Preserve the original test implementation; only the isolated package changes.
    activity.write_text(text,encoding='utf-8')
    for test in (qa/'test').rglob('*.kt'):
        test.write_text(test.read_text(encoding='utf-8').replace('uk.thewyj.app.qa.stateacceptance','uk.thewyj.app.qa.'+suffix),encoding='utf-8')
    shutil.copy2(here/'D01Probe.kt',qa/'src/uk/thewyj/app/qa/D01Probe.kt')
    shutil.copy2(here/'D01LifecycleTest.kt',qa/'test/uk/thewyj/app/qa/D01LifecycleTest.kt')
    shutil.copy2(here/'D01RegressionTest.kt',qa/'test/uk/thewyj/app/qa/D01RegressionTest.kt')
    shutil.copy2(here/'D01ExternalTest.kt',qa/'test/uk/thewyj/app/qa/D01ExternalTest.kt')
    # Explicit repository root is required after the copied host changes depth.
    server=(qa/'server.cjs').read_text(encoding='utf-8').replace("root=path.resolve(qa,'../../../..')", "root=path.resolve(process.env.AERIS_D01_SOURCE_ROOT||'')")
    (qa/'server.cjs').write_text(server,encoding='utf-8')
    print(qa)
