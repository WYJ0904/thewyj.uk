from pathlib import Path
import json,os,subprocess
ROOT=Path(__file__).resolve().parents[3];E=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout';OUT=E/'scale-probe-r1';OUT.mkdir(exist_ok=False)
SDK=Path.home()/'AppData/Local/Android/Sdk';ADB=SDK/'platform-tools/adb.exe'
env=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',ANDROID_ADB_SERVER_PORT='5041',ADB_SERVER_SOCKET='tcp:127.0.0.1:5041',ADB_MDNS_AUTO_CONNECT='0')
for key in list(env):
    if any(s in key.upper() for s in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']):env.pop(key)
base=[str(ADB),'-P','5041','-s','127.0.0.1:5585'];assert subprocess.check_output(base+['shell','getprop','ro.kernel.qemu'],env=env).strip()==b'1'
cmd=['cmd.exe','/d','/c',str(ROOT/'android/gradlew.bat'),'-p',str(ROOT/'android'),'-I',str(ROOT/'qa/finance-p05/closeout/emulator.init.gradle'),
    '-Dfinance.closeout.emulator.source='+str(ROOT/'qa/finance-p05/closeout/emulator'),':app:assembleDebugAndroidTest','--no-daemon','--max-workers=2','--console=plain','-PTHEWYJ_BASE_URL=https://isolated-finance.invalid']
with (OUT/'build.log').open('xb') as log:p=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
assert p.returncode==0
apk=ROOT/'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
p=subprocess.run(base+['install','-r','-t',str(apk)],env=env,capture_output=True);assert p.returncode==0
with (OUT/'instrumentation.log').open('xb') as log:p=subprocess.run(base+['shell','am','instrument','-w','-r','-e','class','uk.thewyj.app.task21.payment.CloseoutScaleProbeTest',
    'uk.thewyj.app.debug.test/androidx.test.runner.AndroidJUnitRunner'],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=120)
data=subprocess.check_output(base+['exec-out','run-as','uk.thewyj.app.debug','cat','files/closeout-scale-probe-r1/observations.ndjson'],env=env)
(OUT/'observations.ndjson').write_bytes(data);print(data.decode())
