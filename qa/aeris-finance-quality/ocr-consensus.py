"""Offline QA prototype. Exact independent agreement still needs exact source binding."""
from common import *
import re
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--attempt',default='r1');parser.add_argument('--sdk',default='r3');parser.add_argument('--latin',default='r1');args=parser.parse_args()
assert all(re.fullmatch('r[1-9][0-9]*',value) for value in [args.attempt,args.sdk,args.latin])
OUT=E/('ocr-consensus-'+args.attempt);OUT.mkdir(exist_ok=False)
chinese_original=json.loads((E/('sdk-'+args.sdk)/'original/views.json').read_text())
chinese_corpus=json.loads((E/('sdk-'+args.sdk)/'corpus/results.json').read_text())
latin=json.loads((E/('latin-'+args.latin)/'results.json').read_text())
token=re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{5,}')
def chinese_tokens(lines):
    values=[]
    for line in lines:
        match=re.search(r'交易号\s*([A-Za-z0-9_-]+)',line)
        if match:values.append(match[1])
    return list(dict.fromkeys(values))
def latin_tokens(lines):
    # No source/expected reference is accepted by this decoder function.
    return list(dict.fromkeys(line.strip() for line in lines if token.fullmatch(line.strip())))
def consensus(primary,independent):
    if len(primary)!=1 or len(independent)!=1:return None
    return primary[0] if primary[0]==independent[0] else None
expected={
    'letters':'ABCDEFGHJKLMNPQR','digits':'202610260123456789','mixed':'AB0O1I2LZ2026',
    'original-alpha':'SYNTH-P06-JOINT-123456','low-resolution':'AB0O1I2LZ2026',
    'blurred':'AB0O1I2LZ2026','occluded':'AB0O1I2LZ2026','duplicate-references':'202610260123456789'}
rows=[]
for row in latin:
    original=row['group']=='original-six';name=row['view']
    primary=next(item for item in (chinese_original if original else chinese_corpus) if item['view' if original else 'id']==name)
    lines=primary['lines' if original else 'sdk_lines']
    first=chinese_tokens(lines);second=latin_tokens(row.get('lines',[]));candidate=consensus(first,second)
    # Only after independent decoding is the immutable source compared exactly.
    source='SYNTH-P06-JOINT-123456' if original else expected[name]
    accepted=candidate==source
    rows.append(dict(group=row['group'],id=name,chinese_candidates=first,latin_candidates=second,
        consensus_candidate=candidate,exact_source_match=accepted,
        decision='EXACT_SOURCE_CANDIDATE_NO_WRITE' if accepted else 'MANUAL_REVIEW_NO_WRITE',
        ledger_writes=0,expected_reference_provided_to_decoder=False,
        input_sha256=row['input_sha256']))
original=[r for r in latin if r['group']=='original-six']
result=dict(rows=rows,original_latin_substring_seen=sum(any('SYNTH-P06-JOINT-123456' in line for line in row.get('lines',[])) for row in original),
    original_latin_whole_token_exact=sum(latin_tokens(row.get('lines',[]))==['SYNTH-P06-JOINT-123456'] for row in original),
    original_cross_model_exact_source=sum(r['exact_source_match'] for r in rows if r['group']=='original-six'),
    corpus_cross_model_agreements=sum(r['consensus_candidate'] is not None for r in rows if r['group']=='new-eight'),
    corpus_exact_source=sum(r['exact_source_match'] for r in rows if r['group']=='new-eight'),
    external_model_calls=0,ledger_writes=0,production_enabled=False,
    conclusion='Independent models can agree on the wrong token. Never replace exact source binding or enable this diagnostic as an accounting fallback.',
    inputs={str(p.relative_to(ROOT)):sha(p) for p in [E/('sdk-'+args.sdk)/'original/views.json',E/('sdk-'+args.sdk)/'corpus/results.json',E/('latin-'+args.latin)/'results.json']})
write(OUT/'result.json',result)
print(json.dumps({k:v for k,v in result.items() if k not in ['rows','inputs']}))
