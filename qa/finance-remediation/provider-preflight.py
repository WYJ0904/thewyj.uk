"""Read-only existing Cloudflare authentication; never expose whoami identity."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/migration-evidence/finance-p06/remediation/provider'
OUT.mkdir(parents=True,exist_ok=False)
(OUT/'private').mkdir()
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
cmd=[str(node),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),'whoami']
p=subprocess.run(cmd,cwd=ROOT,capture_output=True,timeout=60)
raw=p.stdout+b'\n'+p.stderr
(OUT/'private/whoami.log').write_bytes(raw)
text=raw.decode(errors='replace').lower()
auth=p.returncode==0 and 'not authenticated' not in text and ('logged in' in text or 'api token' in text)
row=dict(utc=datetime.now(timezone.utc).isoformat(),command=cmd,authenticated=auth,exit_code=p.returncode,
    raw_sha256=hashlib.sha256(raw).hexdigest(),ai_write_scope='ai (write)' in text,provider_calls=0,mutations=False)
(OUT/'preflight.json').write_text(json.dumps(row,indent=2))
(OUT/'BUDGET.json').write_text(json.dumps(dict(total_new_binding_invocations_maximum=4,primary_original_scenarios=3,alternate_diagnostic_scenarios=1,
    max_output_tokens_per_call=512,timeout_ms=10000,retries_within_same_total_cap=True,synthetic_only=True,
    source_authorization='Current remediation instruction: few real model diagnostics only with existing authentication, isolated resources and bounded budget.',
    no_subscription_or_paid_plan_changes=True,actual_billed_cost=None,formal_ai_stays_disabled=True),indent=2))
print(json.dumps(row))
