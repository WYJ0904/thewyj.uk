"""Describe repeat counts/latencies and sample limits, without causal guessing."""
from pathlib import Path
import collections,json,statistics
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/finish'
def nd(p):return [json.loads(s) for s in p.read_text(encoding='utf8').splitlines() if s.strip()]
tests=nd(OUT/'phone-evidence-before-cleanup/tests.ndjson');probe=nd(OUT/'phone-evidence-before-cleanup/finish-probe.ndjson')
groups={}
for prefix in ['DEVICE-MAIN-LIFECYCLE-','FINISH-MAIN-','FINISH-PLAIN-','FINISH-NORMAL-BACKGROUND-']:
    rows=[r for r in tests if r['case_id'].startswith(prefix)]
    elapsed=[r['details']['elapsed_ms'] for r in rows]
    assert all(r['details']['state']=='RESUMED' for r in rows)
    groups[prefix]={'recorded_rounds_including_repeats_and_both_QA_metadata_variants':len(rows),
        'min_ms':min(elapsed),'median_ms':statistics.median(elapsed),'max_ms':max(elapsed)}
samples=[r for r in probe if r['event']=='thread_sample']
result={'rounds':groups,'screen':[r for r in tests if r['case_id'].startswith('DEVICE-SCREEN-')],
    'probe_events':dict(collections.Counter(r['event'] for r in probe)),
    'samples':{'count':len(samples),'main_heartbeat_max_age_ms':max(r['main_heartbeat_age_ms'] for r in samples),
        'renderer_destroy_sample_count':sum(any('HardwareRenderer.nDestroy' in frame for t in r['threads'] for frame in t['stack']) for r in samples),
        'failure_time_stack_obtained':False,'reason':'Historical failure did not recur in these fresh lifecycle sequences. Healthy samples cannot prove its cause.'},
    'matrix':'continuous-thirty/summary.json','native_callback_failures_retained':'delivery-phone-final/failure-ledger.json',
    'historical_activity_failure':{'status':'UNRESOLVED','request':'RESUMED','actual':'STOPPED','original_elapsed_seconds':109.113,
        'evidence':'../device/device-final-native-suite.log','valid_failure_time_own_stack':False,
        'causal_product_fix':False,'d01_d02':'CLOSED; no direct new evidence reopens them'},
    'comparability_limits':['New unique QA package/user0, own-process probes and privacy gate',
        'Owner enabled Extended Unlock; historical lock/window conditions not identical',
        'No release install, real payment page, automatic OS LMK or private backup'],
    'product_android_source_modified':False,'qa_timeouts_extended':False,'assertions_removed':False}
file=OUT/'lifecycle-analysis.json';assert not file.exists();file.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(result,ensure_ascii=False))
