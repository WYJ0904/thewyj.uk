"""Local serial execution of inherited frozen JVM and separate-process HTTP bridges."""
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(os.environ.get('FINANCE_REGRESSION_OUTPUT', ROOT / 'docs/migration-evidence/finance-p04/local/final/regression')).resolve()
if not BASE.is_relative_to(ROOT / 'docs/migration-evidence'):
    raise SystemExit('Use an ignored evidence directory.')
BASE.mkdir(parents=True, exist_ok=True)
manifest = BASE / 'jvm-commands.json'
trace_only = '--trace-only' in sys.argv
if manifest.exists() and not trace_only:
    raise SystemExit('Preserve previous executions.')
results = json.loads(manifest.read_text()) if trace_only and manifest.exists() else []

def gradle(name, flavor, output, tests, trace=False):
    qa = ROOT / ('qa/finance-p02' if flavor == 'p02' else 'docs/migration-evidence/finance-p03/final/compat-p03')
    launcher=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat')] if os.name=='nt' else ['bash',str(ROOT/'android/gradlew')]
    command = launcher+['-p', 'android', '-I', str(qa / 'test.init.gradle'),
               f'-Dfinance.{flavor}.root={qa}', f'-Dfinance.{flavor}.output={BASE / output}']
    if trace:
        command += ['-I', str(ROOT / 'qa/finance-p03/finish/trace.init.gradle'),
                    f'-Dfinance.finish.trace.root={os.environ.get("FINANCE_TRACE_ROOT", ROOT / "qa/finance-p03/finish")}',
                    f'-Dfinance.finish.trace.output={BASE / output}']
    command += [':app:testDebugUnitTest', '--rerun']
    for test in tests:
        command += ['--tests', test]
    command += ['--no-daemon', '--max-workers=2', '--console=plain', '--stacktrace',
                '-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
    log = BASE / f'{name}.log'
    started = time.time()
    with log.open('x') as stream:
        completed = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
    archive = BASE / f'{name}-junit'
    archive.mkdir()
    cases = []
    for source in (ROOT / 'android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml'):
        if source.stat().st_mtime < started:
            continue
        shutil.copy2(source, archive / source.name)
        for case in ET.parse(source).getroot().iter('testcase'):
            status = 'FAIL' if case.find('failure') is not None or case.find('error') is not None else 'SKIP' if case.find('skipped') is not None else 'PASS'
            cases.append(dict(classname=case.get('classname'), name=case.get('name'), status=status))
    row = dict(name=name, command=command, exit_code=completed.returncode,
               started_utc=datetime.fromtimestamp(started, timezone.utc).isoformat(),
               finished_utc=datetime.now(timezone.utc).isoformat(), cases=cases)
    results.append(row)
    manifest.write_text(json.dumps(results, indent=2) + '\n')
    print(f'{name}: exit {completed.returncode}, {len(cases)} current test cases', flush=True)
    return completed.returncode

if trace_only:
    sys.exit(gradle('trace-five-corrected', 'p02', 'traces-corrected', ['*FinanceP03FinishTraceTest', '*FinanceP03FinishMigrationTest'], trace=True))

gradle('trace-five', 'p02', 'traces', ['*FinanceP03FinishTraceTest', '*FinanceP03FinishMigrationTest'], trace=True)
gradle('frozen-native', 'p02', 'frozen-native', ['*FinanceP02MatrixTest', '*FinanceP02TimingTest'])
gradle('process-seed', 'p02', 'frozen-process', ['*FinanceP02SeedTest'])
gradle('process-restore', 'p02', 'frozen-process', ['*FinanceP02RestoreTest'])

for name, profile, klass, server_script in [
    ('legacy-bridge', 'legacy', 'P03Bridge', 'qa/finance-p03/bridge-server.mjs'),
    ('clearing-bridge', 'closeout', 'P03CloseoutBridge', 'qa/finance-p03/bridge-server.mjs'),
    ('correction-bridge', 'phase-a', 'P03ABridge', 'qa/finance-p03/phase-a/bridge-server.mjs'),
    ('unified-bridge', 'phase-a', 'P03FinalBridge', 'qa/finance-p03/final/bridge-server.mjs'),
]:
    if gradle(name + '-seed', 'p03', name, ['*' + klass + 'SeedTest']):
        continue
    output = BASE / name
    environment = dict(os.environ, FINANCE_P03_OUTPUT=str(output), FINANCE_P03_BRIDGE_PROFILE=profile)
    port = None
    with (BASE / f'{name}-server.log').open('x') as stream:
        server = subprocess.Popen([os.environ.get('FINANCE_NODE','node'), server_script], cwd=ROOT, env=environment, stdout=stream, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 30
            while not (output / 'port.json').exists():
                if server.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Owned local bridge did not become ready')
                time.sleep(0.1)
            port = json.loads((output / 'port.json').read_text())
            assert port['pid'] == server.pid
            gradle(name + '-restore', 'p03', name, ['*' + klass + 'RestoreTest'])
        finally:
            if port and port['pid'] == server.pid:
                try:
                    request = urllib.request.Request(f'http://127.0.0.1:{port["port"]}/_p03_shutdown', data=b'', method='POST')
                    urllib.request.urlopen(request, timeout=10).close()
                finally:
                    server.wait(timeout=15)
            elif server.poll() is None:
                server.terminate()
                server.wait(timeout=15)
    summary = json.loads((output / 'server-final.json').read_text())
    print(f'{name}: {summary.get("status")}, {summary.get("requests")} local requests', flush=True)

sys.exit(int(any(row['exit_code'] for row in results if row['name'] != 'frozen-native')))
