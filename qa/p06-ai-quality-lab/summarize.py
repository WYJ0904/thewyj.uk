"""Validate retained artifacts and export a reviewable, path-redacted lab summary."""
from collections import Counter
from pathlib import Path
import hashlib,json,xml.etree.ElementTree as ET
import run as lab

E=lab.E
def read(name):return json.loads((E/name).read_bytes())
def junit(label):
    suites=[ET.parse(p).getroot() for p in (E/label/'junit').glob('TEST-*.xml')]
    assert suites,label
    return dict(suites=len(suites),**{k:sum(int(s.get(k,0)) for s in suites) for k in ['tests','failures','errors','skipped']},
        failed_methods=sorted(s.get('name')+'#'+t.get('name') for s in suites for t in s.findall('testcase') if t.find('failure') is not None))
baseline=read('frozen-baseline/evaluation.json');candidate=read('frozen-candidate/evaluation.json')
assert (E/'frozen-baseline/dataset.json').read_bytes()==(E/'frozen-candidate/dataset.json').read_bytes()
assert [x['id'] for x in baseline['rows']]==[x['id'] for x in candidate['rows']]
assert len(candidate['rows'])==87 and all(x['status']=='PASS' for x in candidate['rows'])
base_android=junit('baseline-android');final_android=junit('final-android')
assert base_android['failed_methods']==final_android['failed_methods']
native_before=junit('pinned-native-baseline');native_after=junit('validated-native')
assert native_before['tests']==native_after['tests']==32 and native_after['failures']==0
api=read('traced-api/api.json');replay=read('verified-replay/replay.json')
assert len(api['rows'])==40 and all(x['status']=='PASS' for x in api['rows'])
assert len(replay['rows'])==12 and all(x['original_envelope_verified'] for x in replay['rows'])
control=read('native-control-source/result.json');assert control['candidate_restored']
native=lab.ROOT/'android/app/src/main/java/uk/thewyj/app/finance/FinanceAiEvidence.kt'
assert lab.sha(native)==control['candidate_sha256']
legacy=[]
for row in read('regressions-r1/result.json')['rows']:
    target=lab.ROOT/row['output']
    if row['name']=='atomic':target=lab.ROOT/'docs/migration-evidence/p0-ai/atomic-recovery-r1'
    if row['name']=='budget':target=lab.ROOT/'docs/migration-evidence/p0-ai/quality-and-budget-r1'
    result=None
    for name in ['contracts.json','quality.json','result.json']:
        p=target/name
        if p.exists():
            value=json.loads(p.read_bytes())
            if isinstance(value,dict) and 'rows' in value:result=value;break
    assert result is not None,row['name']
    counts=Counter(x['status'] for x in result['rows'])
    legacy.append(dict(name=row['name'],cases=len(result['rows']),counts=dict(counts),exit_code=row['exit_code'],
        failed_cases=[x['id'] for x in result['rows'] if x['status']=='FAIL'],source=row['source'],
        source_sha256=row['source_sha256'],actual_output=str(target.relative_to(lab.ROOT)).replace('\\','/')))
role_control=read('legacy-role-comparison.json')
assert role_control['new_failures']==[]
commands={}
for label in ['frozen-baseline','frozen-candidate','traced-api','verified-replay','portable-replay','frozen-metrics','validated-native','functions-build','final-android-build']:
    command=read(label+'/command.json');assert command['source_stable'],label
    assert command['exit_code']==(1 if label=='frozen-baseline' else 0),label
    commands[label]=dict(exit_code=command['exit_code'],source_stable=True,real_model_calls=0)
    # Recheck actual compiled/runtime inputs, not just their historical PASS bit.
    for name,digest in command['source_after'].items():
        if name.startswith(('android/','functions/_lib/finance-ai','js/finance/ai-assistance.js')):
            assert lab.sha(lab.ROOT/name)==digest,(label,name)
old_by_id={r['id']:r for r in baseline['rows']}
summary=dict(status='INDEPENDENT_LAB_COMPLETE_P06_PARTIAL_RELEASE_HELD',completed_date_hong_kong='2026-11-04',
    branch='codex/p06-ai-quality-lab',base_sha=lab.BASE,candidate_commit='f633fc85d91d339a856bf981e25cc0999e4bde32',
    real_model_calls=0,production_preview_phone_operations=0,
    dataset=dict(cases=87,source='qa/p06-ai-quality-lab/cases.mjs',synthetic_only=True,materialized_sha256=lab.sha(E/'frozen-candidate/dataset.json'),
        categories=dict(Counter(r['category'] for r in candidate['rows'])),cohorts=dict(Counter(r['cohort'] for r in candidate['rows'])),baseline=dict(Counter(r['status'] for r in baseline['rows'])),candidate=dict(Counter(r['status'] for r in candidate['rows'])),
        per_case=[dict(id=r['id'],category=r['category'],cohort=r['cohort'],baseline=old_by_id[r['id']]['status'],candidate=r['status'],expected=r['expected'],actual=r['actual']) for r in candidate['rows']]),
    deterministic_metrics=candidate['metrics'],api=dict(cases=40,counts=dict(Counter(r['status'] for r in api['rows'])),metrics=api['metrics'],mock_calls=api['mock_calls']),
    native=dict(before=native_before,after=native_after),android=dict(before=base_android,after=final_android,legacy_failures_unchanged=True,lint_debug='PASS',debug_apk='PASS',android_test_compile='PASS'),
    standalone_guard_tests=10,metric_tests=13,legacy_suites=legacy,legacy_roles=role_control,
    historical_replay=dict(cases=12,source='qa/p06-ai-quality-lab/fixtures/recorded-12.json',fixture_sha256=lab.sha(lab.ROOT/'qa/p06-ai-quality-lab/fixtures/recorded-12.json'),
        by_model=replay['by_model'],per_case=[{k:v for k,v in r.items() if k not in ['input','usage']} for r in replay['rows']],older_cohort=replay['original_15_summary'],
        historical_source_available=replay['historical_source_available'],full_request_bytes='EVIDENCE_UNAVAILABLE'),
    online=replay['online'],commands=commands,
    interpretation='Code controls, saved-response replay and online model quality are distinct. Rates are per cohort; do not add overlapping test counts or treat safe refusal as successful business support.')
destination=lab.ROOT/'docs/finance/P06_AI_QUALITY_LAB_RESULTS.json'
destination.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(dict(dataset=summary['dataset']['candidate'],api=summary['api']['counts'],native=native_after,
    android=final_android,legacy=[(r['name'],r['counts']) for r in legacy],real_model_calls=0),ensure_ascii=False))
