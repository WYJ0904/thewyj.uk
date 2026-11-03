"""Recover exactly one owner-DPAPI source to a new owned private path, or verify all."""
from pathlib import Path
from ctypes import wintypes
import argparse,ctypes,hashlib,json
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06'
parser=argparse.ArgumentParser();parser.add_argument('--source');parser.add_argument('--output');parser.add_argument('--verify-all',action='store_true');parser.add_argument('--label',default='r1');args=parser.parse_args();assert args.label.startswith('r') and args.label[1:].isdigit()
assert args.verify_all or (args.source and args.output)
seal=E/('privacy-seal-'+args.label);manifest=json.loads((seal/'manifest.json').read_text());assert manifest['status']=='PASS'
class Blob(ctypes.Structure):_fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_byte))]
def blob(value):
 keep=ctypes.create_string_buffer(value);return Blob(len(value),ctypes.cast(keep,ctypes.POINTER(ctypes.c_byte))),keep
crypt=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
crypt.CryptUnprotectData.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree.restype=ctypes.c_void_p
entropy,keep_entropy=blob(b'thewyj.uk/FINANCE-P06/evidence-v1');count=0
for row in manifest['files']:
 if not args.verify_all and row['source']!=args.source:continue
 p=(ROOT/row['cipher']).resolve();assert p.is_relative_to((seal/'blobs').resolve())
 sealed=p.read_bytes();assert hashlib.sha256(sealed).hexdigest()==row['cipher_sha256']
 source,keep=blob(sealed);dest=Blob();assert crypt.CryptUnprotectData(ctypes.byref(source),None,ctypes.byref(entropy),None,None,1,ctypes.byref(dest)),ctypes.get_last_error()
 try:raw=ctypes.string_at(dest.data,dest.size)
 finally:kernel.LocalFree(dest.data)
 assert len(raw)==row['source_bytes'] and hashlib.sha256(raw).hexdigest()==row['source_sha256'];count+=1
 if not args.verify_all:
  target=Path(args.output).resolve();assert target.is_relative_to((E/'recovered-private').resolve()) and not target.exists();target.parent.mkdir(parents=True,exist_ok=True)
  with target.open('xb') as stream:stream.write(raw)
assert count==(len(manifest['files']) if args.verify_all else 1)
print(json.dumps({'status':'PASS','verified_sources':count,'plaintext_written':not args.verify_all,'private_values_printed':False}))
