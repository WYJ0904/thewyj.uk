"""Preserve only selected receipt ciphertext; wrap its new QA key for this Windows user."""
from pathlib import Path
import argparse,base64,ctypes,hashlib,json,subprocess
from ctypes import wintypes
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
NODE=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
parser=argparse.ArgumentParser();parser.add_argument('case');args=parser.parse_args()
assert args.case.startswith(('wechat-main-receipt-','wechat-clone-receipt-',
                             'wechat-main-full-product-','wechat-clone-full-product-')) and all(c.isalnum() or c=='-' for c in args.case)
proof=json.loads((OUT/(args.case+'.json')).read_text(encoding='utf8'))['proof']
def own_read(name):return subprocess.check_output([str(ADB),'-s','R5CY22MEHJN','exec-out','run-as','uk.thewyj.app.qa.financep04navigator','cat','files/closure-proof/'+name])
key=own_read('receipt-key.bin');cipher=own_read(proof['encrypted_evidence'])
assert len(key)==32 and hashlib.sha256(cipher).hexdigest()==proof['cipher_sha256']
class Blob(ctypes.Structure):_fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_byte))]
def blob(value):
    backing=ctypes.create_string_buffer(value);return Blob(len(value),ctypes.cast(backing,ctypes.POINTER(ctypes.c_byte))),backing
crypt=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
source,source_keep=blob(key);entropy,entropy_keep=blob(b'thewyj.uk/FINANCE-P03-P04/receipt-evidence')
protected=Blob();assert crypt.CryptProtectData(ctypes.byref(source),'FINANCE QA receipt evidence',ctypes.byref(entropy),None,None,1,ctypes.byref(protected)),ctypes.get_last_error()
sealed=ctypes.string_at(protected.data,protected.size);kernel.LocalFree(protected.data)
wrapped,wrapped_keep=blob(sealed);opened=Blob()
assert crypt.CryptUnprotectData(ctypes.byref(wrapped),None,ctypes.byref(entropy),None,None,1,ctypes.byref(opened)),ctypes.get_last_error()
assert ctypes.string_at(opened.data,opened.size)==key;kernel.LocalFree(opened.data)
dest=OUT/'private/real-wechat';dest.mkdir(exist_ok=True)
for suffix,data in [('.aesgcm',cipher),('.key.dpapi',sealed)]:
    target=dest/(args.case+suffix)
    if target.exists():
        previous=target.read_bytes()
        if suffix=='.aesgcm':assert previous==cipher
        else:
            old,old_keep=blob(previous);decoded=Blob()
            assert crypt.CryptUnprotectData(ctypes.byref(old),None,ctypes.byref(entropy),None,None,1,ctypes.byref(decoded)),ctypes.get_last_error()
            assert ctypes.string_at(decoded.data,decoded.size)==key;kernel.LocalFree(decoded.data)
    else:
        with target.open('xb') as f:f.write(data)
program=r'''
const fs=require('node:fs'),crypto=require('node:crypto');
const value=JSON.parse(fs.readFileSync(0,'utf8')),key=Buffer.from(value.key,'base64'),buffer=Buffer.from(value.cipher,'base64');
const decipher=crypto.createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));decipher.setAuthTag(buffer.subarray(-16));
const clear=Buffer.concat([decipher.update(buffer.subarray(12,-16)),decipher.final()]);
if(crypto.createHash('sha256').update(clear).digest('hex')!==value.sha)throw Error('Receipt digest mismatch');
const page=JSON.parse(clear.toString('utf8')),text=page.text_lines.join(' ').replace(/\s+/g,'');
const result={raw_sha_verified:true,has_001:page.text_lines.some(line=>/(?<![0-9])0[.]01(?![0-9])/.test(line.replace(/\s+/g,''))),
 waiting_for_receipt:/待(?:你|您|对方)?收款|等待.{0,8}收款|待.{0,8}确认|待.{0,8}领取/.test(text),
 receipt_action_present:/确认收款|确认收钱|立即收款/.test(text),
 accepted:/已收款|已被.{0,32}领取|收款成功|已存入零钱/.test(text),
 transfer_started:/已转账|转账成功/.test(text),returned:/已退还|已退回|已撤销/.test(text),
 explicit_currency_cue:/人民币|RMB|CNY|￥|¥|元/.test(text),
 receipt_number_label_present:/转账单号|交易单号|交易订单号/.test(text),
 transaction_time_label_present:/转账时间|交易时间/.test(text),
 sensitive_text_exported:false,encrypted_raw_retained:true};
if(page.screenshot_png_base64)result.screenshot_sha_verified=crypto.createHash('sha256').update(Buffer.from(page.screenshot_png_base64,'base64')).digest('hex')===page.source.screenshot_sha256;
process.stdout.write(JSON.stringify(result));
'''
result=subprocess.run([str(NODE),'-e',program],input=json.dumps({'key':base64.b64encode(key).decode(),'cipher':base64.b64encode(cipher).decode(),'sha':proof['raw_sha256']}),text=True,capture_output=True,check=True)
facts=json.loads(result.stdout);assert facts['raw_sha_verified'] and facts['has_001']
facts.update(case=args.case,raw_sha256=proof['raw_sha256'],cipher_sha256=proof['cipher_sha256'],
             os_activity=proof['os_activity'],case_label_is_not_profile_proof=True,
             key_protection='Windows DPAPI CurrentUser + purpose entropy; round-trip checked',
             business_identity='Owner-declared existing transfer; no fabricated provider reference')
with (OUT/(args.case+'-facts.json')).open('x',encoding='utf8') as f:json.dump(facts,f,ensure_ascii=False,indent=2)
print(json.dumps(facts,ensure_ascii=False))
