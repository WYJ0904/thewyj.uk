"""Cold-export only owned QA data and verify every receipt cipher has a recoverable local key wrap."""
from pathlib import Path
from datetime import datetime,timezone
from ctypes import wintypes
import base64,ctypes,hashlib,io,json,re,subprocess,tarfile,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
PKG='uk.thewyj.app.qa.financep04closure';HELPER='uk.thewyj.app.qa.financep04navigator'
target=OUT/'phone-final-data-seal.json';assert not target.exists()
assert json.loads((OUT/'owned-phone-install.json').read_text())['package']==PKG
assert (OUT/'navigator-owned.json').exists()
def adb(*parts,data=None):
    p=subprocess.run([str(ADB),'-s','R5CY22MEHJN',*parts],input=data,capture_output=True,timeout=120)
    assert p.returncode==0,p.stderr.decode(errors='replace');return p.stdout
apk_path=adb('shell','pm','path',PKG).decode().strip().removeprefix('package:')
assert re.fullmatch('/data/app/[A-Za-z0-9_+=./~-]+/base.apk',apk_path)
apk_sha=adb('shell','sha256sum',apk_path).decode().split()[0]
assert apk_sha=='0bf2e0d86f54094bded40313527453cfbe628c34fd9f2bd8d408207ef0b25d4d'
names=adb('shell','run-as',HELPER,'find','files/closure-proof','-maxdepth','1','-name','*.aesgcm').decode().splitlines()
class Blob(ctypes.Structure):_fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_byte))]
def blob(value):
    keep=ctypes.create_string_buffer(value);return Blob(len(value),ctypes.cast(keep,ctypes.POINTER(ctypes.c_byte))),keep
crypt=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
checks=[];payload=[]
for name in names:
    case=Path(name).stem;assert re.fullmatch('wechat-[a-z0-9-]+',case)
    source=OUT/'private/real-wechat'/name.split('/')[-1]
    cipher=source.read_bytes();assert cipher==adb('exec-out','run-as',HELPER,'cat',name)
    proof=json.loads((OUT/(case+'.json')).read_text())['proof'];assert hashlib.sha256(cipher).hexdigest()==proof['cipher_sha256']
    wrapped=(source.parent/(case+'.key.dpapi')).read_bytes();item,keep=blob(wrapped);entropy,entropy_keep=blob(b'thewyj.uk/FINANCE-P03-P04/receipt-evidence');opened=Blob()
    assert crypt.CryptUnprotectData(ctypes.byref(item),None,ctypes.byref(entropy),None,None,1,ctypes.byref(opened))
    key=ctypes.string_at(opened.data,opened.size);kernel.LocalFree(opened.data)
    payload.append({'case':case,'key':base64.b64encode(key).decode(),'cipher':base64.b64encode(cipher).decode(),'sha':proof['raw_sha256']})
    checks.append({'case':case,'cipher_sha256':proof['cipher_sha256'],'raw_sha256':proof['raw_sha256'],'key_protection':'DPAPI CurrentUser; plaintext key is not exported'})
program="""const fs=require('node:fs'),crypto=require('node:crypto');const rows=JSON.parse(fs.readFileSync(0,'utf8'));for(const row of rows){const b=Buffer.from(row.cipher,'base64'),d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(row.key,'base64'),b.subarray(0,12));d.setAuthTag(b.subarray(-16));const clear=Buffer.concat([d.update(b.subarray(12,-16)),d.final()]);if(crypto.createHash('sha256').update(clear).digest('hex')!==row.sha)throw Error('Receipt recovery failed');}console.log(JSON.stringify({verified:rows.length,raw_text_exported:false}));"""
result=subprocess.run([str(NODE),'-e',program],input=json.dumps(payload).encode(),capture_output=True,check=True)
assert json.loads(result.stdout)['verified']==len(checks)>=8
adb('shell','am','force-stop','--user','0',PKG);adb('shell','am','force-stop','--user','0',HELPER)
raw=adb('exec-out','run-as',PKG,'tar','-cf','-','files','databases','shared_prefs')
archive=OUT/'private/phone-final-cold.tar';assert not archive.exists();archive.write_bytes(raw)
with tarfile.open(fileobj=io.BytesIO(raw)) as stream:
    members=stream.getmembers();assert all(not x.name.startswith('/') and '..' not in Path(x.name).parts and not x.issym() and not x.islnk() for x in members)
    manifest={m.name:{'bytes':m.size,'sha256':hashlib.sha256(stream.extractfile(m).read()).hexdigest()} for m in members if m.isfile()}
    assert 'files/finance-p04-closure/hosted-valid-reference/restored.json' in manifest
    assert 'files/finance-p04-closure/hosted/outbox.queue' in manifest  # Rejected old fixture retained.
    assert 'files/finance-p04-closure/cold-proof-final/backup-restore.json' in manifest
guard='shared_prefs/finance_p03_device_guard.xml';before=adb('exec-out','run-as',PKG,'cat',guard)
tree=ET.fromstring(before);switch=tree.find("boolean[@name='enabled']");assert switch is not None
backup=OUT/'private/qa-guard-before-cleanup.xml';assert not backup.exists();backup.write_bytes(before)
switch.set('value','false');after=ET.tostring(tree,encoding='utf-8',xml_declaration=True)
adb('shell','-T','run-as',PKG,'dd','of='+guard,data=after)
assert adb('exec-out','run-as',PKG,'cat',guard)==after
record={'sealed_utc':datetime.now(timezone.utc).isoformat(),'status':'PASS','product_apk_sha256':apk_sha,'owned_package':PKG,
        'archive_sha256':hashlib.sha256(raw).hexdigest(),'archive_bytes':len(raw),'files':manifest,'receipt_cipher_recovery':checks,
        'qa_capture_guard_disabled_for_cleanup':True,'fresh_install_default_not_claimed':True,'formal_app_data_exported':False,
        'scope':'Synthetic QA app cold data only; real selected receipt ciphertext separately verified; no plaintext receipt key is exported'}
target.write_text(json.dumps(record,indent=2));print(json.dumps({k:record[k] for k in ['status','product_apk_sha256','archive_sha256','archive_bytes','qa_capture_guard_disabled_for_cleanup','formal_app_data_exported']}))
