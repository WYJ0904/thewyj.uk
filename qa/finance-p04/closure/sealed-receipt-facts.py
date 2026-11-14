"""Derive only fixed status/role booleans from previously sealed selected receipts."""
from pathlib import Path
from ctypes import wintypes
import base64,ctypes,hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
class Blob(ctypes.Structure):_fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_byte))]
def blob(value):
    backing=ctypes.create_string_buffer(value);return Blob(len(value),ctypes.cast(backing,ctypes.POINTER(ctypes.c_byte))),backing
crypt=ctypes.WinDLL('crypt32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
program=r'''
const fs=require('node:fs'),crypto=require('node:crypto'),input=JSON.parse(fs.readFileSync(0,'utf8'));
const key=Buffer.from(input.key,'base64'),bytes=Buffer.from(input.cipher,'base64');const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));
const clear=Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]);if(crypto.createHash('sha256').update(clear).digest('hex')!==input.sha)throw Error('Digest mismatch');
const page=JSON.parse(clear),lines=page.text_lines.map(line=>line.replace(/\s+/g,'')),text=lines.join(' ');
const allowed=['已收款','收款成功','对方已收款','对方已领取','转账成功','已转账','已存入零钱','等待对方收款','待你收款','转账详情','轉賬詳情'];
const terms=['微信转账','转账详情','转账给','轉賬給','转给','向你转账','向你轉賬','已收款','收款成功','已存入零钱','已轉賬','已转账','转账成功','转出成功','付款成功','零钱已扣除','已被','领取','領取','對方','对方','收取','已接收','收款方','付款方','已完成','转账时间','轉賬時間'];
process.stdout.write(JSON.stringify({line_count:lines.length,exact_nonprivate_status:allowed.filter(status=>lines.includes(status)),
 fixed_nonprivate_terms_present:terms.filter(term=>text.includes(term)),
 other_party_received:/对方已收款|對方已收款|对方已领取|已被.{0,32}(?:领取|領取)/.test(text),
 explicit_you_paid:/你已(?:转账|轉賬|支付)|您已(?:转账|支付)|你已成功(?:转账|付款)/.test(text),
 payer_label:/付款方|付款人|转出方/.test(text),recipient_label:/收款方|收款人|转入方/.test(text),
 incoming_you:/向你(?:转账|轉賬|付款)|向您(?:转账|付款)|你已收款|您已收款/.test(text),
 raw_sha_verified:true,private_text_exported:false}));
'''
rows=[]
for case in ['wechat-main-receipt-final-r1','wechat-clone-receipt-final-r2']:
    private=OUT/'private/real-wechat';protected=(private/(case+'.key.dpapi')).read_bytes();encrypted=(private/(case+'.aesgcm')).read_bytes()
    source,keep=blob(protected);entropy,entropy_keep=blob(b'thewyj.uk/FINANCE-P03-P04/receipt-evidence');opened=Blob()
    assert crypt.CryptUnprotectData(ctypes.byref(source),None,ctypes.byref(entropy),None,None,1,ctypes.byref(opened)),ctypes.get_last_error()
    key=ctypes.string_at(opened.data,opened.size);kernel.LocalFree(opened.data)
    proof=json.loads((OUT/(case+'.json')).read_text())['proof']
    response=subprocess.run([str(Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'),'-e',program],input=json.dumps({'key':base64.b64encode(key).decode(),'cipher':base64.b64encode(encrypted).decode(),'sha':proof['raw_sha256']}),capture_output=True,text=True,check=True)
    rows.append(dict(case=case,os_activity=proof['os_activity'],facts=json.loads(response.stdout)))
target=OUT/'wechat-final-role-facts-r2.json';assert not target.exists();target.write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(rows,ensure_ascii=False))
