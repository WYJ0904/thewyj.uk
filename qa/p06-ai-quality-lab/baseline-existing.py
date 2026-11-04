"""Verify legacy failures against immutable base code; only import URLs change."""
from pathlib import Path
import hashlib,json,re,subprocess
import run as lab

out=lab.E/'legacy-roles-baseline'
out.mkdir(exist_ok=False)
name='functions/_lib/finance-ai.mjs'
base=subprocess.check_output(['git','show',lab.BASE+':'+name],cwd=lab.ROOT).decode('utf8')
pattern=re.compile(r"(from\s+['\"])(\.[^'\"]+)(['\"])")
def rewrite(text,source,special=None):
    def replace(match):
        target=(source.parent/match[2].split('?')[0]).resolve()
        query=('?'+match[2].split('?',1)[1]) if '?' in match[2] else ''
        return match[1]+((special[1].as_uri() if special and target==special[0] else target.as_uri()+query))+match[3]
    return pattern.sub(replace,text)
basefile=out/'base-finance-ai.mjs'
basefile.write_text(rewrite(base,lab.ROOT/name),encoding='utf8')
source=lab.ROOT/'qa/finance-p06/ai-v2-contracts.mjs'
original=source.read_text(encoding='utf8');adapted=rewrite(original,source,(lab.ROOT/name,basefile))
# Removing import specifier strings yields byte-identical program text.
strip=lambda text:re.sub(r"(from\s+['\"])[^'\"]+(['\"])",r'\1SPECIFIER\2',text)
assert strip(original)==strip(adapted)
driver=out/'unchanged-assertions.mjs';driver.write_text(adapted,encoding='utf8')
destination=lab.ROOT/'docs/migration-evidence/finance-p06/p06-quality-lab-baseline/roles'
destination.parent.mkdir(parents=True,exist_ok=True);assert not destination.exists()
env=lab.environment();env['FINANCE_P06_OUTPUT']=str(destination)
with (out/'console.log').open('xb') as log:
    result=subprocess.run(['node',str(driver)],cwd=lab.ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
(out/'result.json').write_text(json.dumps(dict(base=lab.BASE,base_logic_sha256=hashlib.sha256(base.encode()).hexdigest(),
    original_test_sha256=lab.sha(source),test_logic_unchanged=True,exit_code=result.returncode,
    output=str(destination.relative_to(lab.ROOT)),real_model_calls=0),indent=2),encoding='utf8')
print(json.dumps(dict(exit_code=result.returncode,base=lab.BASE,test_logic_unchanged=True,real_model_calls=0)))
