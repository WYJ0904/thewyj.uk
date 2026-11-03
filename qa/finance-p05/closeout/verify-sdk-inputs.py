from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[3];E=ROOT/'docs/migration-evidence/finance-p04/non-device-closeout'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
first=E/'emulator-r1/native';cases=json.loads((first/'cases.json').read_text());rows=[]
for case in cases:
    name=case['id']+'.png';digests={label:sha(E/('emulator-'+label)/'native'/name) for label in ['r1','r2','r3']}
    rows.append({'id':case['id'],'sha256':digests,'identical':len(set(digests.values()))==1})
json_hash={label:sha(E/('emulator-'+label)/'native/cases.json') for label in ['r1','r2','r3']}
result={'status':'PASS' if all(r['identical'] for r in rows) and len(set(json_hash.values()))==1 else 'FAIL','vectors':len(rows),'inputs':rows,'case_json':json_hash}
target=E/'sdk-input-integrity.json';assert not target.exists();target.write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='inputs'}));assert result['status']=='PASS'
