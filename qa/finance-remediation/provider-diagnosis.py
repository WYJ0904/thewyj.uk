from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[2]
E=ROOT/'docs/migration-evidence/finance-p06/remediation/provider'
p=E/'live-r2/private/provider-error-1.json'
data=json.loads(p.read_text())
assert data['message']=="5025: This model doesn't support JSON Schema."
out=E/'live-r2/diagnosis.json';assert not out.exists()
out.write_text(json.dumps(dict(status='CONFIRMED_FOR_CURRENT_DIAGNOSTIC',model='@cf/meta/llama-3.1-8b-instruct-fp8',
    provider_error='5025: This model does not support JSON Schema.',original_error_sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
    structured_status_and_code_absent=True,automatic_retry=False,no_unvalidated_json_fallback=True,
    historical_three_exceptions='PROBABLE same incompatibility; original exception messages were not recorded, so exact retrospective confirmation is unavailable.'),indent=2))
print(out.name)
