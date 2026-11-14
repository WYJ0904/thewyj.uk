"""Check OS focus stability; this does not authenticate the screenshot's profile."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,re,subprocess,sys
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe'
parser=argparse.ArgumentParser();parser.add_argument('--user',choices=['0','95'],required=True);parser.add_argument('--case',required=True);parser.add_argument('--focus-task',type=int);args=parser.parse_args()
assert re.fullmatch('wechat-(main|clone)-receipt-[a-z0-9-]+',args.case)
target=OUT/(args.case+'-source-window.json');assert not target.exists()
def adb(*parts):return subprocess.check_output([str(ADB),'-s','R5CY22MEHJN',*parts],text=True,encoding='utf8',errors='replace',timeout=30)
def focus():
    lines=[row.strip() for row in adb('shell','dumpsys','window').splitlines() if 'mCurrentFocus=' in row]
    assert len(lines)==1
    return lines[0]
record={'started':datetime.now(timezone.utc).isoformat(),'expected_os_user':int(args.user),'status':'NOT_TESTED','case_name_is_not_identity':True,'financial_action':False,
        'image_profile_binding':'NOT_TESTED','status_scope':'OS metadata stability only; not screenshot provenance or business acceptance'}
try:
    if args.focus_task is not None:
        assert args.focus_task>0
        task=adb('shell','dumpsys','activity','activities')
        assert re.search(r'ActivityRecord\{[^\n]*\bu'+args.user+r' com\.tencent\.mm/[^\n]*(?:RemittanceDetailUI|WalletOrderInfoNewUI)[^\n]*\bt'+str(args.focus_task)+r'\}',task)
        record['normal_task_focus']=adb('shell','am','task','focus',str(args.focus_task)).strip()
    before=focus();record['before_window']=before
    assert re.search(r'\bu'+args.user+r' com\.tencent\.mm/[^\s}]*(?:RemittanceDetailUI|WalletOrderInfoNewUI)',before),'Selected profile/detail must already be foreground'
    result=subprocess.run([sys.executable,str(ROOT/'qa/finance-p04/closure/navigator.py'),'receipt','--name',args.case],cwd=ROOT,capture_output=True,text=True,timeout=200)
    assert result.returncode==0,'Receipt observation failed; keep its independent evidence'
    after=focus();record['after_window']=after;assert before==after,'Foreground/profile changed across capture; cannot assign source'
    proof_path=OUT/(args.case+'.json');proof=json.loads(proof_path.read_text())['proof']
    assert re.search(r'\bu'+args.user+r' com\.tencent\.mm/',proof['os_activity'])
    record.update(status='PASS',raw_sha256=proof['raw_sha256'],receipt_proof_sha256=hashlib.sha256(proof_path.read_bytes()).hexdigest(),
                  source_binding='OS metadata unchanged before/after; UiAutomation image profile and provider identity remain unproven')
except Exception as error:record.update(status='BLOCKED',error=str(error));raise
finally:
    record['finished']=datetime.now(timezone.utc).isoformat()
    target.write_text(json.dumps(record,indent=2));print(json.dumps(record))
