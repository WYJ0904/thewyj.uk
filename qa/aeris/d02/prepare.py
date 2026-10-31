"""Prepare a new D-02 QA identity, retaining D-01's same-process helper fix."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'docs/migration-evidence/d02/inputs'
parser = argparse.ArgumentParser()
parser.add_argument('--refresh-code', action='store_true', help='Refresh only own generated diagnostic classes after archiving the prior revision')
args = parser.parse_args()
if not args.refresh_code:
    subprocess.run([sys.executable, str(ROOT / 'qa/aeris/d01/prepare.py'), '--output', str(OUT)], check=True)
QA = OUT / 'qa-host-current'
if not args.refresh_code:
    for path in QA.rglob('*'):
        if path.is_file() and path.suffix in ['.kt', '.gradle', '.xml']:
            data = path.read_text(encoding='utf-8').replace('uk.thewyj.app.qa.d01', 'uk.thewyj.app.qa.d02')
            data = data.replace("'.qa.d01'", "'.qa.d02'")
            path.write_text(data, encoding='utf-8')
    manifest = QA / 'AndroidManifest.xml'
    data = manifest.read_text(encoding='utf-8').replace('Aeris D01 isolated QA', 'Aeris D02 synthetic QA')
    data = data.replace('</application>', '<activity android:name="uk.thewyj.app.qa.D02MinimalActivity" android:exported="false"/></application>')
    manifest.write_text(data, encoding='utf-8')
assert "applicationIdSuffix = '.qa.d02'" in (QA / 'qa.init.gradle').read_text(encoding='utf-8')
shutil.copy2(HERE / 'D02MinimalActivity.kt', QA / 'src/uk/thewyj/app/qa/D02MinimalActivity.kt')
shutil.copy2(HERE / 'D02ThreadTests.kt', QA / 'test/uk/thewyj/app/qa/D02ThreadTests.kt')
legacy = (HERE / 'legacy/StateDeviceAcceptanceTest.compose-attempt.kt.txt').read_text(encoding='utf-8')
for kind in ['Default', 'Standard', 'StandardPumped']:
    name = 'D02Original' + kind + 'ComposeTest'
    data = legacy.replace('class StateDeviceAcceptanceTest', 'class ' + name)
    data = data.replace('uk.thewyj.app.qa.stateacceptance', 'uk.thewyj.app.qa.d02')
    if kind.startswith('Standard'):
        data = '@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)\n' + data
        data = data.replace('createAndroidComposeRule<StateAcceptanceActivity>()',
                            'createAndroidComposeRule<StateAcceptanceActivity>(effectContext=kotlinx.coroutines.test.StandardTestDispatcher())')
    if kind == 'StandardPumped':
        data = data.replace('a.awaitJs(', 'awaitJs(')
        marker = '    private fun web(id:String)'
        helper = '''    // Advance the existing Compose UI test clock while actual IO/Chromium completes.
    // Same 20s default / explicit per-call budget as the original QA awaitJs.
    private fun awaitJs(condition:String,timeoutMs:Long=20_000) {
        compose.waitUntil(timeoutMs) { a.eval("Boolean($condition)")=="true" }
    }
'''
        assert marker in data
        data = data.replace(marker, helper + marker)
    (QA / ('test/uk/thewyj/app/qa/' + name + '.kt')).write_text(data, encoding='utf-8')
print(QA)
