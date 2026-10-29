"""Run the remaining inherited Node commands once; retain original return codes."""
from common import *
import ast
import sys

OUT=E/'v62-remaining-node-r3';OUT.mkdir(exist_ok=False)
driver=E/'drivers/node-r2.py'
tree=ast.parse(driver.read_text(encoding='utf-8'))
assign=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name)and t.id=='jobs'for t in n.targets))
jobs=ast.literal_eval(assign.value)
extra=next(n for n in tree.body if isinstance(n,ast.AugAssign) and isinstance(n.target,ast.Name)and n.target.id=='jobs')
# The fixed audited comprehension is a list of (name, fixed path) pairs.
assert isinstance(extra.value,ast.ListComp) and len(extra.value.generators)==1
names=ast.literal_eval(extra.value.generators[0].iter)
assert len(names)==11 and all(isinstance(n,str)for n in names)
jobs += [(name,'qa/finance-p04/'+name+'.mjs')for name in names]
completed={r['name'] for r in json.loads((E/'node-repair-r3/commands.json').read_text(encoding='utf-8'))}
assert len(jobs)==34 and len(completed)==12
assert (E/'v62-original/aeris-node.log').is_file()
completed.add('aeris-node')
remaining=[name for name,_ in jobs if name not in completed]
settings=json.loads((E/'preparation/environment.json').read_text(encoding='utf-8'))
env={**environment(),**settings,'FINANCE_REGRESSION_OUTPUT':str(OUT/'regression'),'FINANCE_NODE_WORKERS':'2'}
env['NODE_OPTIONS']='--import='+ (E/'node-repair-r3/drivers/register.mjs').as_uri()
command=[sys.executable,str(driver),'--only',','.join(remaining)]
write(OUT/'invocation.json',dict(command=command,expected_remaining=len(remaining),already_executed=sorted(completed),original_oracles_modified=False,external_ai_calls=0))
with (OUT/'run.log').open('xb') as stream:
    process=subprocess.run(command,cwd=ROOT,env=env,stdout=stream,stderr=subprocess.STDOUT)
write(OUT/'result.json',dict(exit_code=process.returncode,finished_utc=utc(),original_return_codes_preserved=True))
print(json.dumps(dict(exit_code=process.returncode,remaining_commands=len(remaining))))
raise SystemExit(process.returncode)
