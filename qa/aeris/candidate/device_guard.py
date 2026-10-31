"""Read-only public package/permission baseline. No private app content is read."""
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys

ADB = pathlib.Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/platform-tools/adb.exe'
SERIAL = 'R5CY22MEHJN'
QA_PACKAGES = ['uk.thewyj.app.qa.d01', 'uk.thewyj.app.qa.d01.test',
               'uk.thewyj.app.qa.d01control', 'uk.thewyj.app.qa.d01control.test',
               'uk.thewyj.app.qa.d02','uk.thewyj.app.qa.d02.test',
               'uk.thewyj.app.qa.hf4','uk.thewyj.app.qa.hf4.test']


def adb(*args):
    return subprocess.check_output([str(ADB), '-s', SERIAL, *args], timeout=25).decode('utf-8', 'replace').strip()


def capture(destination):
    devices = subprocess.check_output([str(ADB), 'devices', '-l']).decode()
    online = [s for s in devices.splitlines()[1:] if re.search(r'\sdevice\s', s)]
    assert len(online) == 1 and online[0].split()[0] == SERIAL, 'Unique Samsung required'
    assert adb('shell', 'getprop', 'ro.product.model') == 'SM-S9360'
    assert adb('shell', 'getprop', 'ro.build.version.sdk') == '36'
    packages = {}
    for pkg in ['uk.thewyj.app', 'uk.thewyj.app.debug.test',
                'uk.thewyj.app.qa.stateacceptance', 'uk.thewyj.app.qa.stateacceptance.test', *QA_PACKAGES]:
        dump = adb('shell', 'dumpsys', 'package', pkg)
        meta = sorted(s.strip() for s in dump.splitlines() if re.match(
            r'\s*(versionCode=|versionName=|lastUpdateTime=|firstInstallTime=|pkgFlags=|dataDir=|User \d+:)', s))
        grants = sorted(s.strip() for s in dump.splitlines() if re.search(r'permission\.[^: ]+: granted=', s))
        packages[pkg] = {'metadata': meta, 'grants': grants}
    formal_path = adb('shell', 'pm', 'path', '--user', '0', 'uk.thewyj.app')
    assert formal_path.startswith('package:') and formal_path.endswith('base.apk') and '\n' not in formal_path
    formal_hash = adb('shell', 'sha256sum', formal_path[len('package:'):]).split()[0]
    assert re.fullmatch('[a-f0-9]{64}', formal_hash)
    accessibility = adb('shell', 'dumpsys', 'accessibility')
    bound = re.search(r'Bound services:\{([\s\S]*?)\n\s*Enabled services:', accessibility)
    formal_bound = bool(bound and 'id=uk.thewyj.app/.task21.payment.ThewyjPaymentAccessibilityService' in bound[1])
    result = {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'model': 'SM-S9360', 'sdk': 36, 'android': adb('shell', 'getprop', 'ro.build.version.release'),
              'buildFingerprint': adb('shell', 'getprop', 'ro.build.fingerprint'),
              'packages': packages, 'formalApkSha256': formal_hash, 'formalBound': formal_bound,
              'enabledAccessibility': adb('shell', 'settings', 'get', 'secure', 'enabled_accessibility_services'),
              'enabledNotificationListeners': adb('shell', 'settings', 'get', 'secure', 'enabled_notification_listeners'),
              'standbyBucket': adb('shell', 'am', 'get-standby-bucket', 'uk.thewyj.app'),
              'backgroundAppOp': adb('shell', 'cmd', 'appops', 'get', 'uk.thewyj.app', 'RUN_ANY_IN_BACKGROUND'),
              'reverse': adb('reverse', '--list'),
              'power': [s.strip() for s in adb('shell', 'dumpsys', 'power').splitlines() if re.match(r'\s*mWakefulness=', s)],
              'keyguard': [s.strip() for s in adb('shell', 'dumpsys', 'window', 'policy').splitlines() if 'mIsShowing=' in s],
              'privateDataRead': False}
    pathlib.Path(destination).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: result[k] for k in ['model', 'sdk', 'formalBound', 'formalApkSha256', 'reverse', 'power', 'keyguard']}))
    return result


if __name__ == '__main__':
    capture(sys.argv[1])
