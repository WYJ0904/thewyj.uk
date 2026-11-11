"""Classify all 28 original P03 red cases without changing a frozen oracle."""
from pathlib import Path
import collections,json
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/finish'
read=lambda p:json.loads(p.read_text(encoding='utf8-sig'))
current={r['case_id']:r for r in read(OUT/'delivery-final/frozen-608.json')}
old={r['case_id']:r for r in read(ROOT/'docs/migration-evidence/finance-p03/device/delivery-final/frozen-608.json')}
traces=read(OUT/'traces-final/A24-input-and-hook-traces.json');rows=[]
for trace in traces:
    key=trace['case_id'];r=current[key];f=r['fixture']
    assert r['fixture']==old[key]['fixture'] and r['status']==old[key]['status']
    assert trace['actual_hook_no_unproved_bookings']
    if r['status']=='FAIL':
        group='CONTRACT_CONFLICT_AND_INSUFFICIENT_IDENTITY'
        reason='Removal + same slot/body/postTime, with zero delay, contains no independent financial-operation proof. new_event_evidence is an oracle-only flag, not a product field.'
    elif f['kind']=='replay':
        group='INSUFFICIENT_IDENTITY_TO_MERGE'
        reason='Changed postTime after repost is notification delivery metadata, not proof of the same financial operation. Forcing one expense would merge potentially independent transactions.'
    else:
        group='INSUFFICIENT_IDENTITY_TO_SPLIT'
        reason='An unchanged active slot/body without message/reference/revision is observationally compatible with both an update and independent operations. Delay/restart cannot disambiguate.'
    rows.append({'case_id':key,'before':old[key]['status'],'after':r['status'],'classification':group,
        'reason':reason,'fixture':f,'frozen_actual':r['actual'],'frozen_error':r.get('error',''),
        'actual_hook_safety':{'unproved_bookings':0,'pending_candidates':len(trace['actual_hook']['payment_candidates']),
            'business_goal_satisfied':False},'evidence':'traces-final/A24-input-and-hook-traces.json',
        'recovery_condition':'Legitimate independent operation/message identity, or a proven predecessor and revision bound to the same account/provider/source; otherwise explicit owner review.'})
for key,reason in [('C005','The 80 and 90 captures share a family reference and revision zero. An independent operation, correction and redelivery cannot be reliably distinguished.'),
                   ('C007','No lifecycle reference exists. Authorization/capture/release correspondence cannot be reconstructed from amount or time.')]:
    r=current[key];trace=read(OUT/f'traces-final/{key}-trace.json')
    assert r['fixture']==old[key]['fixture'] and r['status']==old[key]['status']=='EXPECTED_RED'
    rows.append({'case_id':key,'before':old[key]['status'],'after':r['status'],
        'classification':'LEGITIMATE_EXTERNAL_PROOF_REQUIRED','reason':reason,'fixture':r['fixture'],
        'actual':r['actual'],'frozen_error':r.get('error',''),'evidence':f'traces-final/{key}-trace.json',
        'recovery_condition':'A real, legally obtained account/provider-scoped independent Capture reference or proven predecessor/revision; no fixture proof may be invented.'})
for key in ['CW-AUTH-POST-RELEASE','CW-HOLD-ONLY']:
    r=current[key];assert r['fixture']==old[key]['fixture'] and r['status']=='PASS' and old[key]['status']=='EXPECTED_RED'
    rows.append({'case_id':key,'before':'EXPECTED_RED','after':'PASS','classification':'CONFIRMED_PRODUCT_DEFECT_FIXED',
        'reason':'Explicit legacy control metadata was ignored by cash-spend projections. Preserve the original record and exclude the hold/release from posted cash totals; quarantine pending control writes.',
        'fixture':r['fixture'],'actual':r['actual'],'evidence':r['evidence'],
        'new_regressions':['legacy-projection-release/legacy-controls.ndjson','legacy-browser-release/legacy-browser.ndjson']})
assert len(rows)==28 and len({r['case_id'] for r in rows})==28
result={'original_count':28,'resolved_count':2,'unresolved_count':26,
    'final_statuses':dict(collections.Counter(r['after'] for r in rows)),
    'frozen_inputs_and_expected_values_changed':False,'rows':rows,
    'scope_decision':'Safety isolation is verified but is not full business support. Owner acceptance of a narrower contract is a separate explicit decision.'}
path=OUT/'case-analysis-28.json';assert not path.exists();path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:v for k,v in result.items() if k!='rows'},ensure_ascii=False))
