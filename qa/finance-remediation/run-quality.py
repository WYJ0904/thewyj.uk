"""Final audit run: preserve command/stdout/timestamps and exact source locks."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,subprocess
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/migration-evidence/finance-p04/remediation/ai-quality-final-command';OUT.mkdir(exist_ok=False)
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
files=['functions/_lib/finance-ai.mjs','functions/_lib/finance-ai-provider.mjs','qa/finance-remediation/ai-quality.mjs',
 'cloudflare/migrations/0034_finance_ai_assistance.sql']
def hashes():return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in files}
before=hashes();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
started=datetime.now(timezone.utc).isoformat();command=[str(node),'qa/finance-remediation/ai-quality.mjs']
with (OUT/'run.log').open('xb') as log:
    p=subprocess.run(command,cwd=ROOT,env=dict(os.environ,FINANCE_REMEDIATION_OUTPUT=str(OUT/'result')),stdout=log,stderr=subprocess.STDOUT)
after=hashes()
(OUT/'command.json').write_text(json.dumps(dict(command=command,exit_code=p.returncode,head=head,started_utc=started,finished_utc=datetime.now(timezone.utc).isoformat(),
    source_before=before,source_after=after,source_stable=before==after,real_provider_calls=0,
    repeat_reason='Final replay with durable command/stdout/timestamp/source-lock artifacts; prior exploratory results retained, the 76 identities counted once.'),indent=2))
print('Source-locked quality run exit =',p.returncode)
raise SystemExit(p.returncode or int(before!=after))
