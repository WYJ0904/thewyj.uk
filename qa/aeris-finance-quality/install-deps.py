"""Install only the repository lockfile dependencies in this owned checkout."""
from common import *
OUT=E/'dependencies-r1';OUT.mkdir(exist_ok=False)
before=sha(ROOT/'package-lock.json')
cmd=[str(NODE),'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js','ci','--ignore-scripts','--no-audit','--no-fund']
with (OUT/'npm-ci.log').open('xb') as log:
    p=subprocess.run(cmd,cwd=ROOT,env=environment(),stdout=log,stderr=subprocess.STDOUT)
record=dict(command=cmd,exit_code=p.returncode,lock_sha256_before=before,lock_sha256_after=sha(ROOT/'package-lock.json'),external_model_calls=0)
assert before==record['lock_sha256_after'];write(OUT/'result.json',record);print(json.dumps(record))
raise SystemExit(p.returncode)
