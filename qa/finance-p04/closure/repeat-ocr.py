"""Thirty identical, bounded installed-product OCR matrices, retaining every attempt."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,re,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
parser=argparse.ArgumentParser();parser.add_argument('--series',required=True);args=parser.parse_args();assert re.fullmatch('r[0-9]+',args.series)
target=OUT/('samsung-ocr-series-'+args.series+'.json');assert not target.exists()
rows=[];started=datetime.now(timezone.utc).isoformat()
for index in range(1,31):
    name=f'samsung-ocr-{args.series}-round-{index:02d}'
    command=[sys.executable,str(ROOT/'qa/finance-p04/closure/navigator.py'),'qa-ocr-money','--name',name]
    start=time.monotonic();result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,timeout=200)
    detail=json.loads((OUT/(name+'.json')).read_text())
    rows.append({'round':index,'status':detail['status'],'seconds':round(time.monotonic()-start,3),'cases':detail.get('proof',{}).get('count',0),'failures':detail.get('proof',{}).get('failures'), 'evidence':str((OUT/(name+'.json')).relative_to(ROOT))})
    target.write_text(json.dumps({'started':started,'updated':datetime.now(timezone.utc).isoformat(),'rows':rows,'unique_fixture_cases':7,'repetitions_are_not_unique_cases':True,'scope':'Generated bitmap evidence through installed production OCR engine; no real payment'},indent=2))
    print(json.dumps(rows[-1]),flush=True)
    if result.returncode or detail['status']!='PASS':break
assert len(rows)==30 and all(row['status']=='PASS' and row['cases']==7 and row['failures']==0 for row in rows)
