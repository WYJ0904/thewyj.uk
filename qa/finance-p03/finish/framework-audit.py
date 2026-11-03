"""Inspect the exact cached AndroidX 1.7.0 binary used by the QA APK."""
from pathlib import Path
import hashlib,json,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p03/finish/framework'
OUT.mkdir(exist_ok=False)
cache=Path.home()/'.gradle/caches/modules-2/files-2.1/androidx.test/core/1.7.0'
aars=list(cache.rglob('core-1.7.0.aar'));assert len(aars)==1
aar=aars[0];jar=OUT/'classes.jar'
with zipfile.ZipFile(aar) as z:jar.write_bytes(z.read('classes.jar'))
javap=Path('C:/Program Files/Android/Android Studio/jbr/bin/javap.exe')
classes=['androidx.test.core.app.InstrumentationActivityInvoker',
    'androidx.test.core.app.InstrumentationActivityInvoker$EmptyActivity',
    'androidx.test.core.app.InstrumentationActivityInvoker$BootstrapActivity',
    'androidx.test.core.app.ActivityScenario']
for name in classes:
    p=subprocess.run([str(javap),'-classpath',str(jar),'-p','-c',name],capture_output=True,text=True)
    assert p.returncode==0,p.stderr
    (OUT/(name.split('.')[-1]+'.javap.txt')).write_text(p.stdout,encoding='utf8')
metadata={'library':'androidx.test:core:1.7.0','aar_sha256':hashlib.sha256(aar.read_bytes()).hexdigest(),
    'classes_jar_sha256':hashlib.sha256(jar.read_bytes()).hexdigest(),
    'observations':'Binary dependency inspection only; does not prove the historical STOPPED failure cause',
    'commands':[str(javap),'-classpath','classes.jar','-p','-c','<class>']}
(OUT/'metadata.json').write_text(json.dumps(metadata,indent=2))
print(json.dumps(metadata))
