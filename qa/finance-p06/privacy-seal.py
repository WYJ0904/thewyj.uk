"""Owner-DPAPI seal of this task's private evidence. Never deletes plaintext."""
from pathlib import Path
from datetime import datetime,timezone
from ctypes import wintypes
import argparse,ctypes,hashlib,json,re
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06'
parser=argparse.ArgumentParser();parser.add_argument('--label',default='r1');args=parser.parse_args();assert re.fullmatch('r[0-9]+',args.label)
OUT=E/('privacy-seal-'+args.label);OUT.mkdir(exist_ok=False);(OUT/'blobs').mkdir()
class Blob(ctypes.Structure):_fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_byte))]
def blob(value):
 keep=ctypes.create_string_buffer(value);return Blob(len(value),ctypes.cast(keep,ctypes.POINTER(ctypes.c_byte))),keep
crypt=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
crypt.CryptProtectData.argtypes=[ctypes.POINTER(Blob),wintypes.LPCWSTR,ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
crypt.CryptUnprotectData.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree.restype=ctypes.c_void_p
entropy,entropy_keep=blob(b'thewyj.uk/FINANCE-P06/evidence-v1')
def convert(value,protect):
 source,keep=blob(value);dest=Blob();ok=crypt.CryptProtectData(ctypes.byref(source),'FINANCE P06 private evidence',ctypes.byref(entropy),None,None,1,ctypes.byref(dest)) if protect else crypt.CryptUnprotectData(ctypes.byref(source),None,ctypes.byref(entropy),None,None,1,ctypes.byref(dest))
 assert ok,ctypes.get_last_error()
 try:return ctypes.string_at(dest.data,dest.size)
 finally:kernel.LocalFree(dest.data)
files=set()
for folder in [E/'device/ui',E/'device/privacy-lease/private',E/'provider/private',E/'recovered-private',*E.glob('phone-cleanup*/private')]:
 if folder.exists():files.update(p for p in folder.rglob('*') if p.is_file() and (folder.name in ['private','recovered-private'] or 'private' in p.relative_to(folder).parts))
for parent in [*E.glob('joint-r*'),*E.glob('emulator-joint-r*')]:
 for folder in [parent/'private',parent/'native/private']:
  if folder.exists():files.update(p for p in folder.rglob('*') if p.is_file() and p.suffix not in ['.apk'])
rows=[]
for p in sorted(files):
 assert p.resolve().is_relative_to(E.resolve()) and not p.is_symlink();raw=p.read_bytes();digest=hashlib.sha256(raw).hexdigest();cipher=OUT/'blobs'/(digest+'.dpapi')
 if not cipher.exists():cipher.write_bytes(convert(raw,True))
 sealed=cipher.read_bytes();assert convert(sealed,False)==raw
 rows.append({'source':p.relative_to(ROOT).as_posix(),'source_bytes':len(raw),'source_sha256':digest,'cipher':cipher.relative_to(ROOT).as_posix(),'cipher_bytes':len(sealed),'cipher_sha256':hashlib.sha256(sealed).hexdigest(),'round_trip_verified':True})
assert any(r['source'].endswith('/cold-owned.tar') for r in rows)
record={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS','protection':'Windows DPAPI CurrentUser + task purpose entropy; every blob round-trip checked','raw_values_exported':False,'plaintext_deletions':0,'files':rows}
(OUT/'manifest.json').write_text(json.dumps(record,indent=2));print(json.dumps({'status':'PASS','private_sources':len(rows),'unique_ciphertexts':len(list((OUT/'blobs').glob('*.dpapi'))),'plaintext_deleted':False}))
