"""Read/tap normal Samsung Settings only; never dump chat or payment windows."""
from pathlib import Path
import argparse
import datetime
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/migration-evidence/finance-p04/closure-current'
ADB = Path.home() / 'AppData/Local/Android/Sdk/platform-tools/adb.exe'
SERIAL = 'R5CY22MEHJN'
def adb(*args):
    result = subprocess.run([str(ADB), '-s', SERIAL, *args], capture_output=True, text=True,
                            encoding='utf8', errors='replace', timeout=30)
    assert result.returncode == 0, result.stderr
    return result.stdout

parser = argparse.ArgumentParser()
parser.add_argument('name')
parser.add_argument('--tap-text')
parser.add_argument('--tap-id')
args = parser.parse_args()
assert re.fullmatch('[a-z0-9-]+', args.name)
deadline=time.monotonic()+5
while True:
    focus = [s.strip() for s in adb('shell', 'dumpsys', 'window').splitlines() if 'mCurrentFocus=' in s]
    if focus and 'mCurrentFocus=null' not in focus[-1]:break
    assert time.monotonic()<deadline, 'Settings transition did not acquire a focused window'
    time.sleep(0.1)
assert focus and any(p in focus[-1] for p in ('com.android.settings/', 'com.samsung.accessibility/', 'com.android.systemui/')), focus
remote = '/data/local/tmp/finance-p04-' + args.name + '.xml'
local = OUT / (args.name + '.xml')
assert not local.exists(), 'Preserve prior snapshots'
adb('shell', 'uiautomator', 'dump', remote)
adb('pull', remote, str(local))
nodes = list(ET.parse(local).getroot().iter('node'))
assert all(n.get('package') in {'com.android.settings', 'com.samsung.accessibility', 'com.android.systemui', ''} for n in nodes)
if args.tap_text or args.tap_id:
    candidates = [n for n in nodes if
                  (args.tap_text and args.tap_text in (n.get('text'), n.get('content-desc'))) or
                  (args.tap_id and args.tap_id == n.get('resource-id'))]
    assert len(candidates) == 1, 'Need an unambiguous observed Settings target'
    match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', candidates[0].get('bounds', ''))
    assert match
    x1,y1,x2,y2 = map(int, match.groups())
    assert x2 > x1 and y2 > y1
    adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    print(json.dumps({'tapped': args.tap_text or args.tap_id, 'snapshot': str(local), 'normal_settings_only': True}, ensure_ascii=False))
else:
    print(json.dumps([{'text':n.get('text'), 'description':n.get('content-desc'),
                       'id':n.get('resource-id'), 'checked':n.get('checked'), 'bounds':n.get('bounds')}
                      for n in nodes if n.get('text') or n.get('content-desc') or n.get('checkable')=='true'], ensure_ascii=False))
with (OUT / 'execution.ndjson').open('a', encoding='utf8') as log:
    log.write(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'settings_snapshot':local.name,
                          'phone_temp':remote, 'tap':args.tap_text or args.tap_id})+'\n')
