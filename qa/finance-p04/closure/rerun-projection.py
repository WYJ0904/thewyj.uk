"""Correct only Windows --import URL syntax; original data and assertions stay intact."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,subprocess
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'docs/migration-evidence/finance-p04/closure-current/final-current';REG=BASE/'regression'
assert 'ERR_UNSUPPORTED_ESM_URL_SCHEME' in (BASE/'current-projection.log').read_text()
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
argv=[str(node),'--import',(ROOT/'qa/finance-p04/fresh-inputs.mjs').as_uri(),str(ROOT/'qa/finance-p03/finish/projections.mjs')]
started=datetime.now(timezone.utc).isoformat()
with (BASE/'current-projection-r2.log').open('xb') as output:result=subprocess.run(argv,cwd=ROOT,env=dict(os.environ,FINANCE_REGRESSION_OUTPUT=str(REG),FINANCE_P03_OUTPUT=str(REG/'device-projections')),stdout=output,stderr=subprocess.STDOUT)
record={'argv':argv,'started':started,'finished':datetime.now(timezone.utc).isoformat(),'exit_code':result.returncode,'status':'PASS' if result.returncode==0 else 'FAIL','changes':'Only Windows ESM --import flag uses file URI; source/inputs/assertions unchanged','test_source_sha256':hashlib.sha256((ROOT/'qa/finance-p03/finish/projections.mjs').read_bytes()).hexdigest()}
target=BASE/'current-projection-r2.json';assert not target.exists();target.write_text(json.dumps(record,indent=2));print(json.dumps(record));raise SystemExit(result.returncode)
