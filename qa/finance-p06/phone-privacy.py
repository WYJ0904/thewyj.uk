"""Temporary, owner-authorized formal accessibility pause; preserve every other service."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/migration-evidence/finance-p06/device/privacy-lease'
TARGET='uk.thewyj.app/uk.thewyj.app.task21.payment.ThewyjPaymentAccessibilityService'
ADB=Path.home()/'AppData/Local/Android/Sdk/platform-tools/adb.exe';BASE=[str(ADB),'-s','R5CY22MEHJN']
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['pause','restore']);args=parser.parse_args()
def shell(*parts):return subprocess.check_output(BASE+['shell',*parts],timeout=20).decode().strip()
assert shell('getprop','ro.product.model')=='SM-S9360' and shell('am','get-current-user')=='0'
def services():
    value=shell('settings','get','secure','enabled_accessibility_services');assert re.fullmatch(r'[A-Za-z0-9_.:/-]*',value)
    return [] if value in ('','null') else value.split(':')
if args.action=='pause':
    OUT.mkdir(exist_ok=False);(OUT/'private').mkdir();before=services()
    (OUT/'private/before.json').write_text(json.dumps(before));after=[x for x in before if x!=TARGET]
    if after!=before:shell('settings','put','secure','enabled_accessibility_services',':'.join(after))
    actual=services();assert actual==after
    row=dict(utc=datetime.now(timezone.utc).isoformat(),status='PAUSED',was_enabled=TARGET in before,
        other_services_unchanged=True,formal_app_storage_modified=False,notification_permissions_modified=False,
        authorization='Prior direct owner authorization to temporarily disable formal accessibility and restore it; persists for this finance task')
    (OUT/'state.json').write_text(json.dumps(row,indent=2));print(json.dumps(row))
else:
    before=json.loads((OUT/'private/before.json').read_text());now=services();expected=[x for x in before if x!=TARGET]
    if TARGET in before and TARGET not in now:
        if now==expected:now=before
        else:now.insert(min(before.index(TARGET),len(now)),TARGET)
        shell('settings','put','secure','enabled_accessibility_services',':'.join(now))
    actual=services();assert (TARGET in actual)==(TARGET in before)
    row=dict(utc=datetime.now(timezone.utc).isoformat(),status='RESTORED',formal_service_enabled=TARGET in actual,
        original_list_exact=actual==before,other_service_changes_not_overwritten=actual!=before,formal_app_storage_modified=False)
    path=OUT/'restore.json';assert not path.exists();path.write_text(json.dumps(row,indent=2));print(json.dumps(row))
