"""Independent original/v2 Node, local D1 and owned Chrome suites."""
from common import *
import sys

OUT=E/'final-r1';OUT.mkdir(exist_ok=False)
settings=json.loads((E/'preparation/environment.json').read_text())
env=dict(environment(),**settings)
env['FINANCE_REGRESSION_OUTPUT']=str(OUT/'regression')
cmd=[sys.executable,str(E/'drivers/node.py')]
record=dict(started_utc=utc(),command=cmd,external_model_calls=0,phone_operations=0)
with (OUT/'node-full.log').open('xb') as log:
    p=subprocess.run(cmd,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
record.update(exit_code=p.returncode,finished_utc=utc());write(OUT/'node-independent-command.json',record)
print(json.dumps(record));raise SystemExit(p.returncode)
