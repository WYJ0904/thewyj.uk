"""Prepare declared-input v2 replay from the actually executed original DOM rows."""
from common import *
import sys
OUT=E/'contract-repair-r1';OUT.mkdir(exist_ok=False)
primary=E/'node-repair-r1/regression/p02-web/web-dom.ndjson';assert primary.is_file()
command=[sys.executable,str(E/'drivers/contracts.py')]
row=dict(name='prepare-contract',command=command,started_utc=utc(),original_dom_sha256=sha(primary))
with (OUT/'prepare.log').open('xb') as log:
    p=subprocess.run(command,cwd=ROOT,env=dict(environment(),FINANCE_CONTRACT_ROOT=str(OUT/'contract-input-drivers'),FINANCE_PRIMARY_DOM=str(primary)),stdout=log,stderr=subprocess.STDOUT,timeout=30)
row.update(exit_code=p.returncode,finished_utc=utc());write(OUT/'commands.json',[row]);print(json.dumps(row))
raise SystemExit(p.returncode)
