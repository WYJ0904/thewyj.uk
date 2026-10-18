"""Run only this task's D02 synthetic instrumentation; preserve every attempt."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/migration-evidence/d02'
spec = importlib.util.spec_from_file_location('d01_guard', ROOT / 'qa/aeris/d01/device_guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
guard.QA_PACKAGES += ['uk.thewyj.app.qa.d02', 'uk.thewyj.app.qa.d02.test']
OWNED = ['uk.thewyj.app.qa.d02', 'uk.thewyj.app.qa.d02.test']
CLASSES = {'ordinary': 'D02OrdinaryTest', 'default-minimal': 'D02DefaultComposeMinimalTest',
           'standard-minimal': 'D02StandardComposeMinimalTest', 'default-product': 'D02DefaultProductTest',
           'standard-product': 'D02StandardProductTest', 'original-t01': 'StateDeviceAcceptanceTest#T01_localEvidenceNativeAndWebNotCloudConfirmed',
           'legacy-default-t01': 'D02OriginalDefaultComposeTest#T01_localEvidenceNativeAndWebNotCloudConfirmed',
           'legacy-standard-t01': 'D02OriginalStandardComposeTest#T01_localEvidenceNativeAndWebNotCloudConfirmed',
           'legacy-pumped-t01': 'D02OriginalStandardPumpedComposeTest#T01_localEvidenceNativeAndWebNotCloudConfirmed',
           'original-full': 'StateDeviceAcceptanceTest'}


def raw(*args, timeout=25):
    return subprocess.check_output([str(guard.ADB), '-s', guard.SERIAL, *args], timeout=timeout).decode('utf-8', 'replace')


def stop_own():
    ledger = json.loads((EVIDENCE / 'owned-installed.json').read_text(encoding='utf-8-sig'))
    assert all(pkg in ledger for pkg in OWNED)
    for pkg in OWNED:
        raw('shell', 'am', 'force-stop', '--user', '0', pkg)


def own_entries(directory):
    command = [str(guard.ADB), '-s', guard.SERIAL, 'shell', 'ls', '-1',
               '/sdcard/Android/data/' + OWNED[0] + '/files/' + directory]
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25)
    return set(result.stdout.decode('utf-8', 'replace').splitlines()) if result.returncode == 0 else set()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=CLASSES)
    parser.add_argument('label')
    args = parser.parse_args()
    assert re.fullmatch('[a-zA-Z0-9_-]+', args.label)
    run = EVIDENCE / 'runs' / args.label
    run.mkdir(parents=True, exist_ok=False)
    before = guard.capture(run / 'device-before.json')
    assert before['formalBound']
    stop_own()
    previous = {name: own_entries(name) for name in ['d02-evidence', 'd01-evidence']}
    started = time.monotonic()
    classes = 'uk.thewyj.app.qa.' + CLASSES[args.mode]
    if args.mode == 'original-full':
        source = (EVIDENCE / 'inputs/qa-host-current/test/uk/thewyj/app/qa/StateDeviceAcceptanceTest.kt').read_text(encoding='utf-8')
        methods = re.findall(r'@Test fun (T\d\d_\w+)', source)
        assert len(methods) == 16
        classes = ','.join('uk.thewyj.app.qa.StateDeviceAcceptanceTest#' + name for name in methods)
    process = subprocess.Popen([str(guard.ADB), '-s', guard.SERIAL, 'shell', 'am', 'instrument', '-w', '-r',
        '-e', 'disableAnalytics', 'true', '-e', 'class', classes,
        OWNED[1] + '/uk.thewyj.app.qa.StateAcceptanceRunner'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    lines = []
    def read():
        with (run / 'instrumentation.log').open('wb') as out:
            for data in iter(process.stdout.readline, b''):
                out.write(data); out.flush(); lines.append(data.decode('utf-8', 'replace'))
    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    timed_out = False
    while process.poll() is None:
        # Full matrix includes the existing real 90s T12. Functional timeouts stay unchanged.
        if time.monotonic() - started > (240 if args.mode == 'original-full' else 100):
            timed_out = True
            pid = raw('shell', 'pidof', OWNED[0]).strip()
            diagnostic = {'pid': pid, 'elapsedSeconds': time.monotonic() - started}
            if pid.isdigit():
                diagnostic['mainWchan'] = raw('shell', 'run-as', OWNED[0], 'cat', '/proc/' + pid + '/wchan').strip()
            (run / 'watchdog.json').write_text(json.dumps(diagnostic, indent=2), encoding='utf-8')
            stop_own()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill()
            break
        time.sleep(0.5)
    reader.join(timeout=5)
    output = ''.join(lines)
    # Pull only the new QA package's own exported synthetic diagnostics.
    for directory in ['d02-evidence', 'd01-evidence', 'qa3-evidence']:
        remote = '/sdcard/Android/data/' + OWNED[0] + '/files/' + directory
        exists = subprocess.run([str(guard.ADB), '-s', guard.SERIAL, 'shell', 'ls', '-d', remote],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25)
        if exists.returncode == 0:
            if directory in previous:
                for entry in sorted(own_entries(directory) - previous[directory]):
                    assert re.fullmatch(r'[0-9TZ.:-]+', entry), 'Unexpected own evidence entry'
                    (run / directory).mkdir(exist_ok=True)
                    subprocess.run([str(guard.ADB), '-s', guard.SERIAL, 'pull', remote + '/' + entry,
                                    str(run / directory / entry)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25)
            else:
                subprocess.run([str(guard.ADB), '-s', guard.SERIAL, 'pull', remote, str(run / directory)],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25)
    after = guard.capture(run / 'device-after.json')
    result = {'mode': args.mode, 'seconds': time.monotonic() - started, 'watchdog': timed_out,
              'junitPass': bool(re.search(r'OK \(\d+ tests?\)', output)),
              'junitFailure': 'FAILURES!!!' in output,
              'junitSkipped': bool(re.search(r'INSTRUMENTATION_STATUS_CODE:\s*-[34]', output)),
              'formalBound': after['formalBound'],
              'qaServicesEnabled': any('.qa.d02/' in str(after[key]) for key in ['enabledAccessibility', 'enabledNotificationListeners'])}
    result['qualifiedPass'] = (result['junitPass'] and not timed_out and not result['junitSkipped']
                               and result['formalBound'] and not result['qaServicesEnabled'])
    (run / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
    print(output[-1800:])
    return 0 if result['qualifiedPass'] else 1


if __name__ == '__main__':
    sys.exit(main())
