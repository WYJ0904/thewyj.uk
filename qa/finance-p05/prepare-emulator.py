"""Provision official SDK tooling/image only, with accepted licenses; never touch USB devices."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,subprocess,urllib.request,zipfile
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/migration-evidence/finance-p04/continuation-p05/emulator-preparation'
OUT.mkdir(exist_ok=False)
SDK=Path.home()/'AppData/Local/Android/Sdk'
URL='https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip'
EXPECTED='90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
record={'started_utc':datetime.now(timezone.utc).isoformat(),'official_source':'https://developer.android.com/studio#command-tools','url':URL,
        'real_phone_operations':False,'license_auto_accept':False,'status':'IN_PROGRESS'}
try:
    archive=OUT/'official-tools.zip'
    with urllib.request.urlopen(URL,timeout=30) as response,archive.open('xb') as target:
        while chunk:=response.read(1024*1024):target.write(chunk)
    actual=hashlib.sha256(archive.read_bytes()).hexdigest();assert actual==EXPECTED
    record['official_sha256_verified']=actual
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            name=Path(member.filename);assert not name.is_absolute() and '..' not in name.parts
            assert ((member.external_attr>>16)&0o170000)!=0o120000
        source.extractall(OUT/'tools')
    manager=OUT/'tools/cmdline-tools/bin/sdkmanager.bat';assert manager.is_file()
    environment=dict(os.environ,JAVA_HOME='C:/Program Files/Android/Android Studio/jbr')
    argv=['cmd.exe','/d','/c',str(manager),'--sdk_root='+str(SDK),'--install','system-images;android-36;google_apis;x86_64']
    record['install_argv']=argv
    with (OUT/'sdk-image-install.log').open('xb') as log:
        result=subprocess.run(argv,cwd=ROOT,env=environment,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,timeout=600)
    record.update(status='PASS' if result.returncode==0 else 'BLOCKED',exit_code=result.returncode,
                  system_image_present=(SDK/'system-images/android-36/google_apis/x86_64/package.xml').exists(),
                  sdkmanager=str(manager),avdmanager=str(manager.with_name('avdmanager.bat')))
except Exception as error:record.update(status='BLOCKED',error=type(error).__name__+': '+str(error))
finally:
    record['finished_utc']=datetime.now(timezone.utc).isoformat();(OUT/'result.json').write_text(json.dumps(record,indent=2));print(json.dumps(record))
