"""Sanitized integration evidence index; raw failures and backups remain ignored."""
from pathlib import Path
import collections, hashlib, json, re, subprocess, xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-safe-convergence'
OUT=ROOT/'docs/finance/evidence/safe-convergence';OUT.mkdir(parents=True,exist_ok=True)
def load(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def counts(rows):return dict(collections.Counter(x['status'] for x in rows))
def clean(value):
    if isinstance(value,dict):return {k:clean(v) for k,v in value.items() if k not in ['command','argv','source_before','source_after']}
    if isinstance(value,list):return [clean(x) for x in value]
    if isinstance(value,str):return re.sub(r'C:[\\/]+Users[\\/]+[^\\/\s]+','%USERPROFILE%',value,flags=re.I)
    return value
def junit(folder):
    totals={k:0 for k in ['tests','failures','errors','skipped']};suites=[]
    for file in sorted(folder.glob('TEST-*.xml')):
        s=ET.parse(file).getroot();row={'name':s.get('name'),**{k:int(s.get(k,0)) for k in totals}}
        for k in totals:totals[k]+=row[k]
        suites.append(row)
    return {'totals':totals,'suites':suites}
data={'date':'2026-11-04','timezone':'Asia/Hong_Kong','candidate_status':'FINANCE_P03_P06_INTEGRATION_CANDIDATE_READY',
 'production_release':'RELEASE_HELD','remote_ci':'Read exact-head Core CI on the resulting Draft PR; this is the local source-bound evidence snapshot',
 'lineage':{'pr112':'9ab3a5667b6230560b64531764720a754922b4c7','pr118':'fcc499ef4b33cd13d212c19523d82cd7966e2684',
 'p05_source':'2520d677ed1882f42092dd91d75fd589d958fe52','p05_final':'6c95d20dde951e12cf58f98d2d00ce2a51933daa',
 'product_candidate':'5f4965cc4d8ceeddf50bb4c9fdef7ba00f634f21','p07_readonly':'d26bbb8112e7d10a5dfede40af0fe19c4c447866'},
 'import':load(E/'p05-import.json'),'jvm':junit(E/'android-full-r1/junit'),
 'p05_replay':junit(E/'p05-replay-r1/junit'),'versioned_native':junit(E/'native-contracts-r1/junit'),
 'commands':{},'database':{},'interface':load(E/'interface-audit.json'),
 'remaining':{'P03':'PARTIAL','P04':'PARTIAL','P05':'PARTIAL','P06':'PARTIAL','Samsung':'NOT_TESTED',
   'real_model':'NOT_TESTED_QUOTA','real_screenshot_acceptance':'NOT_TESTED','production_migration':'NOT_EXECUTED / RELEASE_HELD'}}
for label in ['contracts-r1','p06-r2','build-r1','legacy-ai-r2']:
    data['commands'][label]=load(E/label/'commands.json')
P06=ROOT/'docs/migration-evidence/p06-ai-quality-lab/safe-convergence-p06-r2'
data['p06']={
 'evaluation':load(P06/'evaluation/evaluation.json'),
 'api':load(P06/'api/api.json'),
 'replay':load(P06/'replay/replay.json'),
 'roles':load(ROOT/'docs/migration-evidence/finance-p06/safe-convergence-legacy-ai-r2/roles/contracts.json'),
 'rich':load(ROOT/'docs/migration-evidence/finance-p06/safe-convergence-legacy-ai-r2/rich/contracts.json')}
for label,path in [
 ('p04',ROOT/'docs/migration-evidence/finance-p04/safe-convergence-migrations-r1/p04-migrations/migrations.json'),
 ('p04-review',ROOT/'docs/migration-evidence/finance-p04/safe-convergence-migrations-r1/p04-review-migrations/review-migrations.json'),
 ('p06',ROOT/'docs/migration-evidence/finance-p06/safe-convergence-migration-r2/result.json'),
 ('integrated',E/'integrated-db-r2/result.json')]:
    d=load(path);data['database'][label]={'counts':counts(d['rows']),'rows':d['rows']}
data['p05_comparison']=load(E/'p05-replay-r1/replay-comparison.json')
data['historical_failures']={
 'old_six_jvm':'Historical implicit-yen inputs remain original FAIL. PR112 changed positive fixture premises to explicit CNY and added rejection controls; current passing method names do not rewrite the old inputs.',
 'p03_original_26':'Historical 4 FAIL / 22 EXPECTED_RED retained; not rerun or relabelled by this integration.',
 'roles_2':'Current unchanged legacy suite remains 21 PASS / 2 FAIL: refund/income assertions lack matching phrases.',
 'provider_quality':'Historical Llama 2/6, Qwen3 3/6; literal portable replay only, no new calls.'}
data['retained_setup_failures']=[
 {'run':'p06-r1','type':'QA_OUTPUT_NAMESPACE_ERROR','disposition':'P06 guard preserved; p06-r2 uses its existing output namespace'},
 {'run':'migrations-r1/p06','type':'QA_MISSING_PARENT_DIRECTORY','disposition':'Original source/assertions unchanged; independent p06-migration-r2 passes 7'},
 {'run':'legacy-roles-r1','type':'QA_INPUT_PROVENANCE_SETUP_ERROR','disposition':'Legacy response envelope lacks synthetic_only; immutable envelope hash and source budget validated before actual replay'},
 {'run':'integrated-db-r1','type':'QA_WRONG_CONTIGUOUS_SEQUENCE_ASSUMPTION','disposition':'Baseline already lacks 0026; r2 checks exact immutable 33-file migration manifest. No migration added/renumbered.'}]
for label in ['android-full-r1','p05-replay-r1','native-contracts-r1']:
    record=load(E/label/'command.json');assert record['exit_code']==0 and record['source_stable']
assert data['jvm']['totals']=={'tests':893,'failures':0,'errors':0,'skipped':0}
assert data['p05_replay']['totals']['tests']==11 and data['versioned_native']['totals']['tests']==15
data['source_boundaries']={'existing_finance_product_files_changed':False,'default_roi_enabled':False,'ocr_auto_book_enabled':False,
 'whole_p05_history_merged':False,'P07_Task26_changed':False,'real_model_calls':0,'production_operations':0,'raw_root':'docs/migration-evidence/finance-safe-convergence'}
(OUT/'results.json').write_text(json.dumps(clean(data),ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('Published source-bound finance integration evidence; original failures retained')
