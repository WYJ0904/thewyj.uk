"""One slow authorized launch; no payment, acceptance, message, or bill-list action."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,re,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06/device'
parser=argparse.ArgumentParser();parser.add_argument('--user',choices=['0','95'],default='0');parser.add_argument('--label',default='wechat-primary-r1');args=parser.parse_args();assert re.fullmatch(r'[a-z0-9-]+',args.label)
OUT=E/'ui'/args.label;OUT.mkdir(parents=True,exist_ok=False);private=OUT/'private';private.mkdir()
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe';BASE=[str(ADB),'-s','R5CY22MEHJN']
def adb(*parts,timeout=20):return subprocess.check_output(BASE+list(parts),timeout=timeout)
assert adb('shell','getprop','ro.product.model').decode().strip()=='SM-S9360'
assert 'uk.thewyj.app/uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService' not in adb('shell','settings','get','secure','enabled_accessibility_services').decode()
power=adb('shell','dumpsys','power').decode();policy=adb('shell','dumpsys','window','policy').decode()
if 'mWakefulness=Awake' not in power or re.search(r'\bshowing=true',policy):
    row={'status':'USER_PRESENCE_REQUIRED','screen_woken':False,'ui_actions':0}
else:
    adb('shell','am','start','--user',args.user,'-n','com.tencent.mm/com.tencent.mm.ui.LauncherUI','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER')
    time.sleep(10)
    xml=adb('exec-out','uiautomator','dump','/dev/tty',timeout=30);(private/'ui.txt').write_bytes(xml)
    image=adb('exec-out','screencap','-p');(private/'screen.png').write_bytes(image)
    row={'status':'OPENED_FOR_SCOPED_OBSERVATION','user':args.user,'ui_actions':1,'minimum_dwell_ms':10000,'no_payment_or_acceptance':True,'raw_navigation_private':True,'formal_accessibility_paused':True}
row['utc']=datetime.now(timezone.utc).isoformat();(OUT/'result.json').write_text(json.dumps(row,indent=2));print(json.dumps(row))
