"""Concrete, public-artifact isolation checks before device installation."""
from pathlib import Path
import argparse,hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/device'
TOOL=Path.home()/'AppData/Local/Android/Sdk/build-tools/36.1.0'
def call(name,*args):return subprocess.check_output([str(TOOL/name),*map(str,args)],text=True,encoding='utf8',errors='replace')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
APK=OUT/'build/app/outputs/apk/debug/app-debug.apk';TEST=OUT/'build/app/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
parser=argparse.ArgumentParser();parser.add_argument('--name',default='apk-isolation');args=parser.parse_args();assert re.fullmatch('[a-z0-9-]+',args.name)
dest=OUT/(args.name+'.json');assert not dest.exists()
formal='2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03'
result={'baseline':'976eed4644556e70266fe0ef5e54b7c8e419d0ba','scope':'Privacy QA derivative; not a release candidate','formal_signature_unchanged':True,'artifacts':[]}
for p,pkg in [(APK,'uk.thewyj.app.debug'),(TEST,'uk.thewyj.app.debug.p03acceptance')]:
    badging=call('aapt2.exe','dump','badging',p);assert "package: name='"+pkg+"'" in badging
    cert=call('apksigner.bat','verify','--print-certs',p);digest=re.search(r'certificate SHA-256 digest: ([0-9a-f]+)',cert).group(1);assert digest!=formal
    manifest=call('aapt2.exe','dump','xmltree',p,'--file','AndroidManifest.xml');target=OUT/(args.name+'-'+p.name+'.manifest.txt');assert not target.exists();target.write_text(manifest,encoding='utf8')
    assert 'sharedUserId' not in manifest
    if p==APK:
        assert 'android:debuggable' in manifest and 'android:allowBackup' in manifest
        for forbidden in ['android.permission.RECEIVE_SMS','android.permission.READ_MEDIA_IMAGES','android.permission.READ_EXTERNAL_STORAGE','android.permission.REQUEST_INSTALL_PACKAGES']:assert forbidden not in manifest,forbidden
        authorities=[line.strip() for line in manifest.splitlines() if 'android:authorities' in line];assert authorities and all('uk.thewyj.app.debug' in line for line in authorities),authorities
        result['provider_authorities']=authorities
    else:assert 'targetPackage' in manifest and 'uk.thewyj.app.debug"' in manifest
    result['artifacts'].append({'package':pkg,'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p),'certificate_sha256':digest})
assert result['artifacts'][0]['certificate_sha256']==result['artifacts'][1]['certificate_sha256']
config=list((OUT/'build/app/generated/source/buildConfig/debug').rglob('BuildConfig.java'))
assert len(config)==1 and '"https://localhost:19443"' in config[0].read_text(encoding='utf8')
result['native_origin']='https://localhost:19443';result['tls']='app-specific QA CA; HTTP off; no system CA modification'
overlay=json.loads((OUT/'source-overlay.json').read_text(encoding='utf8'))
assert len(overlay['qa_only_changes'])==3
main='android/app/src/main/java/uk/thewyj/app/MainActivity.kt'
assert overlay['files'][main]['product_sha256']==overlay['files'][main]['qa_sha256']
result['main_activity_identical']=True;result['copied_sources']=len(overlay['files']);result['qa_only_source_deltas']=list(overlay['qa_only_changes'])
xml=call('aapt2.exe','dump','xmltree',APK,'--file','res/xml/thewyj_accessibility_service.xml');assert 'canTakeScreenshot' in xml and '0x0' in [s for s in xml.splitlines() if 'canTakeScreenshot' in s][0]
(OUT/(args.name+'-accessibility-resource.txt')).write_text(xml,encoding='utf8')
result['qa_screenshot_capability']=False
dest.write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result))
