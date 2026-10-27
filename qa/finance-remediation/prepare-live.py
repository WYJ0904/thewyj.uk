"""Path-only derivative of the original live oracle, with a new four-call hard cap."""
from pathlib import Path
import difflib,hashlib,json,re
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/migration-evidence/finance-p06/remediation/provider'
assert json.loads((OUT/'preflight.json').read_text())['authenticated']
source=ROOT/'qa/finance-p06/live-provider.mjs'
before=source.read_text()
after=before.replace("docs/migration-evidence/finance-p06/provider","docs/migration-evidence/finance-p06/remediation/provider")
after=after.replace("const validationCap=15; // Original12 retained; amendment01 permits one three-case model A/B.","const validationCap=4; // This round only: three primary cases and one alternate diagnostic, retries included.")
after=after.replace('translateOnlyRefund?2:6','selectedCases.length')
after=after.replace("budget_amendment:'provider/BUDGET_AMENDMENT_01.json'","budget_amendment:'remediation/provider/BUDGET.json'")
for match in list(re.finditer(r"from (['\"])(\.\.?/[^'\"]+)\1",after)):
    after=after.replace(match[0],'from '+json.dumps((source.parent/match[2]).resolve().as_uri()))
# Prove the original semantic oracles and fixture tuples stayed exactly the same.
for sentinel in ["const semantic=actual?.selected_candidate_id==='m0'", "['payment','CNY','expense',[9000,10000,1000]", "['refund','CNY','refund',[2500,5000]", "['jpy','JPY','expense',[900,1000,100]"]:
    assert sentinel in before and sentinel in after
(OUT/'driver.mjs').write_text(after)
(OUT/'driver.diff').write_text(''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True))))
(OUT/'adaptation.json').write_text(json.dumps(dict(source=str(source.relative_to(ROOT)),source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    derivative_sha256=hashlib.sha256(after.encode()).hexdigest(),changes=['Absolute import paths','New independent output namespace','Total hard cap four, per-run selected scenario count'],
    original_semantic_oracles_and_candidate_values_unchanged=True),indent=2))
print('Prepared original live semantic oracle with this round hard cap = 4.')
