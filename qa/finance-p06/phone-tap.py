"""One observed read-only payment-navigation tap, followed by a ten-second dwell."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,re,subprocess,time
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06/device'
parser=argparse.ArgumentParser();parser.add_argument('--label',required=True);parser.add_argument('--x',type=int,required=True);parser.add_argument('--y',type=int,required=True);parser.add_argument('--anchor',required=True);parser.add_argument('--purpose',choices=['payment-chat-navigation','existing-transfer-detail','source-profile-navigation'],required=True);args=parser.parse_args()
assert re.fullmatch('[a-z0-9-]+',args.label) and 0<=args.x<1440 and 0<=args.y<3120
anchor=Path(args.anchor).resolve();assert anchor.is_relative_to((E/'ui').resolve()) and anchor.is_file()
OUT=E/'ui'/args.label;OUT.mkdir(exist_ok=False);private=OUT/'private';private.mkdir()
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe';BASE=[str(ADB),'-s','R5CY22MEHJN']
def adb(*parts,timeout=20):return subprocess.check_output(BASE+list(parts),timeout=timeout)
assert adb('shell','getprop','ro.product.model').decode().strip()=='SM-S9360'
assert 'uk.thewyj.app/uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService' not in adb('shell','settings','get','secure','enabled_accessibility_services').decode()
focus=adb('shell','dumpsys','window').decode(errors='replace');assert re.search(r'mCurrentFocus=.*com[.]tencent[.]mm/',focus)
pace=E/'ui/pacing.json';previous=json.loads(pace.read_text()) if pace.exists() else {'at':0};time.sleep(max(0,10-(time.time()-previous['at'])))
(OUT/'progress.json').write_text(json.dumps({'stage':'validated-before-single-tap','utc':datetime.now(timezone.utc).isoformat()}))
adb('shell','input','tap',str(args.x),str(args.y));pace.write_text(json.dumps({'at':time.time()}));time.sleep(10)
(private/'screen.png').write_bytes(adb('exec-out','screencap','-p'))
try:
    (private/'ui.txt').write_bytes(adb('exec-out','uiautomator','dump','/dev/tty',timeout=30))
except subprocess.SubprocessError as error:
    (OUT/'tree-unavailable.json').write_text(json.dumps({'kind':type(error).__name__,'no_retry':True}))
row=dict(utc=datetime.now(timezone.utc).isoformat(),purpose=args.purpose,observed_anchor_sha256=hashlib.sha256(anchor.read_bytes()).hexdigest(),tap=[args.x,args.y],dwell_ms=10000,
    payment_or_acceptance_action=False,formal_accessibility_paused=True,raw_data_private=True)
(OUT/'result.json').write_text(json.dumps(row,indent=2));print(json.dumps(row))
