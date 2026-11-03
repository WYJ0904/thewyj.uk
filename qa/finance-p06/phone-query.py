"""Only the owner's exact existing transfer amount in the observed WeChat search UI."""
from pathlib import Path
from datetime import datetime,timezone
import json,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06/device'
OUT=E/'ui/wechat-clone-search-amount-r1';OUT.mkdir(exist_ok=False);(OUT/'private').mkdir()
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe';BASE=[str(ADB),'-s','R5CY22MEHJN']
def adb(*parts):return subprocess.check_output(BASE+list(parts),timeout=20)
assert adb('shell','getprop','ro.product.model').decode().strip()=='SM-S9360'
focus=adb('shell','dumpsys','window').decode(errors='replace')
assert 'mCurrentFocus=' in focus and any('mCurrentFocus=' in line and 'com.tencent.mm' in line and 'FTS' in line for line in focus.splitlines())
assert 'uk.thewyj.app/uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService' not in adb('shell','settings','get','secure','enabled_accessibility_services').decode()
pace=E/'ui/pacing.json';old=json.loads(pace.read_text()) if pace.exists() else {'at':0};time.sleep(max(0,10-(time.time()-old['at'])))
adb('shell','input','text','0.01');pace.write_text(json.dumps({'at':time.time()}));time.sleep(10)
(OUT/'private/screen.png').write_bytes(adb('exec-out','screencap','-p'))
row={'utc':datetime.now(timezone.utc).isoformat(),'query':'0.01','search_only':True,'message_sent':False,'payment_or_acceptance_action':False,'dwell_ms':10000,'raw_results_private':True}
(OUT/'result.json').write_text(json.dumps(row,indent=2));print(json.dumps(row))
