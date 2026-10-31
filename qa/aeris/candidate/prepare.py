"""Prepare the inherited fixed QA host for this frozen acceptance candidate."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'docs/migration-evidence/hotfix-phase4'
subprocess.run([sys.executable,str(ROOT/'qa/aeris/d01/prepare.py'),'--output',str(OUT)],check=True)
QA = OUT / 'qa-host-current'
for path in QA.rglob('*'):
    if path.is_file() and path.suffix in ['.kt','.xml','.gradle']:
        text = path.read_text(encoding='utf-8').replace('uk.thewyj.app.qa.d01','uk.thewyj.app.qa.hf4').replace("'.qa.d01'","'.qa.hf4'")
        path.write_text(text,encoding='utf-8')
manifest=QA/'AndroidManifest.xml'
manifest.write_text(manifest.read_text(encoding='utf-8').replace('Aeris D01 isolated QA','Aeris Hotfix candidate QA')
    .replace('</application>','<activity android:name="uk.thewyj.app.qa.D02MinimalActivity" android:exported="false"/></application>'),encoding='utf-8')
for source in [ROOT/'qa/aeris/d02/D02MinimalActivity.kt',HERE/'CandidateRoomRecoveryTest.kt']:
    dest = QA/('src/uk/thewyj/app/qa/' if source.name.startswith('D02') else 'test/uk/thewyj/app/qa/')/source.name
    dest.write_text(source.read_text(encoding='utf-8').replace('uk.thewyj.app.qa.d02','uk.thewyj.app.qa.hf4'),encoding='utf-8')
text=(ROOT/'qa/aeris/d02/D02ThreadTests.kt').read_text(encoding='utf-8')
fixed=(text[:text.index('class D02DefaultComposeMinimalTest')]
    +text[text.index('class D02StandardComposeMinimalTest'):text.index('class D02DefaultProductTest')]
    +text[text.index('class D02StandardProductTest'):])
(QA/'test/uk/thewyj/app/qa/D02ThreadTests.kt').write_text(fixed.replace('uk.thewyj.app.qa.d02','uk.thewyj.app.qa.hf4'),encoding='utf-8')
text=(ROOT/'qa/aeris/d02/legacy/StateDeviceAcceptanceTest.compose-attempt.kt.txt').read_text(encoding='utf-8')
text='@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)\n'+text.replace('class StateDeviceAcceptanceTest','class CandidateComposeAcceptanceTest')
text=text.replace('uk.thewyj.app.qa.stateacceptance','uk.thewyj.app.qa.hf4')
text=text.replace('createAndroidComposeRule<StateAcceptanceActivity>()','createAndroidComposeRule<StateAcceptanceActivity>(effectContext=kotlinx.coroutines.test.StandardTestDispatcher())')
text=text.replace('a.awaitJs(', 'awaitJs(').replace('    private fun web(id:String)',
    '    private fun awaitJs(condition:String,timeoutMs:Long=20_000) { compose.waitUntil(timeoutMs) { a.eval("Boolean($condition)")=="true" } }\n    private fun web(id:String)')
(QA/'test/uk/thewyj/app/qa/CandidateComposeAcceptanceTest.kt').write_text(text,encoding='utf-8')
commit=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD']).decode().strip()
identity=json.loads((OUT/'source-consistency.json').read_text(encoding='utf-8'))
init=QA/'qa.init.gradle'
text=init.read_text(encoding='utf-8').replace("dsl.defaultConfig.testInstrumentationRunner =",
    "dsl.defaultConfig.buildConfigField('String', 'HF_ACCEPTANCE_SOURCE', '\""+commit+"\"')\n                "
    +"dsl.defaultConfig.buildConfigField('String', 'HF_PRODUCT_SHA256', '\""+identity['productManifestSha256']+"\"')\n                dsl.defaultConfig.testInstrumentationRunner =")
init.write_text(text,encoding='utf-8')
probe=QA/'src/uk/thewyj/app/qa/D01Probe.kt'
text=probe.read_text(encoding='utf-8').replace('.put("hardwareAccelerationDisabled",false)',
    '.put("hardwareAccelerationDisabled",false).put("candidateSource",uk.thewyj.app.BuildConfig.HF_ACCEPTANCE_SOURCE).put("productManifestSha256",uk.thewyj.app.BuildConfig.HF_PRODUCT_SHA256)')
probe.write_text(text,encoding='utf-8')
print(QA)
