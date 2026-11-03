"""Post-hoc exact comparison. Expected strings are never fed to SDK or crops."""
from pathlib import Path
import argparse,hashlib,json,re
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/aeris-p0-ocr'
p=argparse.ArgumentParser();p.add_argument('--input',default='samsung-r1');p.add_argument('--label',default='analysis-r1');a=p.parse_args()
assert re.fullmatch('samsung-r[1-9][0-9]*',a.input)and re.fullmatch('analysis-r[1-9][0-9]*',a.label)
src=E/a.input;out=E/a.label;out.mkdir(exist_ok=False)
read=lambda rel:json.loads((src/rel).read_text(encoding='utf8'))
original=read('original-six/views.json');corpus=read('corpus/results.json');geometry=read('geometry/results.json');cold=read('cold-direct/results.json')
expected='SYNTH-P06-JOINT-123456'
label=re.compile(r'交易号\s*[:：]?\s*([A-Za-z0-9_-]+)')
opaque=re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{5,}')
def tokens(lines):
 values=[]
 for line in lines:
  found=label.search(line)
  if found:values.append(found[1])
  elif opaque.fullmatch(line.strip()):values.append(line.strip())
 return list(dict.fromkeys(values))
def evaluate(row):
 lines=[r['text']for r in row.get('lines',[])];values=tokens(lines)
 return dict(model=row['model'],view=row['view'],input_png_sha256=row['png_sha256'],input_rotation=row['input_rotation'],
  raw_candidates=values,whole_token_exact=values==[expected],substring_seen=any(expected in s for s in lines),
  observed_ms=row['elapsed_ms'],semantic_fields=row.get('semantic_fields'),sdk_status=row['status'])
rows=[evaluate(row)for row in geometry]
raw_exact=sum(tokens(r['lines'])==[expected]for r in original)
assert len(original)==6 and len(corpus)==8
raw_asset=ROOT/'qa/aeris-finance-quality/sdk/assets/reference-original.png'
assert hashlib.sha256(raw_asset.read_bytes()).hexdigest()=='46e6442173c53550e68f06bc8bbed7cb88557a751c8f244a9baa75100ff4c68f'
models={model:dict(executed=sum(r['model']==model and r['sdk_status']=='EXECUTED'for r in rows),
 whole_token_exact=sum(r['model']==model and r['whole_token_exact']for r in rows),
 correct_candidate_seen=sum(r['model']==model and r['substring_seen']for r in rows))for model in ['chinese','latin']}
before_after=read('result.json')
record=dict(original_six=dict(cases=6,whole_reference_exact=raw_exact,non_exact=6-raw_exact,input_and_methods_unchanged=True),
 original_eight=dict(cases=8,safety_pass=sum(r['status']=='PASS'for r in corpus),single_reference_exact=sum(r['decoder_exact']for r in corpus),
  exact_single_binding_not_equal_complete_ocr_accuracy=True),cold_direct=[evaluate(row)for row in cold],
 geometry=read('geometry/geometry.json'),additional_geometry_controls=rows,per_model=models,
 formal_state_unchanged=before_after['formal_state_unchanged'],all_new_packages_uninstalled=all(r['uninstalled']for r in before_after['cleanup']),
 production_code_changed=False,expected_reference_used_only_for_posthoc=True,automatic_booking_authorized=False,
 limitation='Any exact candidate is an observation, not a selected reliable decoder or financial/source/settlement acceptance')
(out/'result.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:record[k]for k in ['original_six','original_eight','per_model','formal_state_unchanged','all_new_packages_uninstalled']}))
