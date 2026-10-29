"""Read and cross-check Oct29 results; never run product tests or edit old evidence.

Historical files supply method identities only, never a current PASS. Command
exit codes, raw/v2 contracts and repetitions remain separate collections.
"""
from common import ROOT,E,utc,sha,write,git
from collections import Counter
import argparse,ast,json,re,xml.etree.ElementTree as ET

p=argparse.ArgumentParser();p.add_argument('--label',required=True);a=p.parse_args()
assert re.fullmatch('v62-evidence-summary-r[1-9][0-9]*',a.label)
out=E/a.label;out.mkdir(exist_ok=False)
inputs={}
def read(relative):
 path=E/relative;inputs[path.relative_to(ROOT).as_posix()]=sha(path)
 return json.loads(path.read_text(encoding='utf-8'))
def nd(relative):
 path=E/relative;inputs[path.relative_to(ROOT).as_posix()]=sha(path)
 return [json.loads(line)for line in path.read_text(encoding='utf-8').splitlines()if line.strip()]
def counts(rows):return dict(Counter(row['status']for row in rows))
def junit_ids(directory):
 result=set()
 for path in directory.glob('*.xml'):
  inputs[path.relative_to(ROOT).as_posix()if path.is_relative_to(ROOT)else str(path)]=sha(path)
  result.update((case.get('classname'),case.get('name'))for case in ET.parse(path).getroot().iter('testcase'))
 return result
native=read('v62-native/command.json');assert native['source_stable']
assert len(native['cases'])==833 and counts(native['cases'])=={'PASS':827,'FAIL':6}
current={(row['classname'],row['name']):row for row in native['cases']};assert len(current)==833
# OLD is the current prior-convergence checkout; the original method register
# belongs to the preserved finance-p04 origin and is read-only.
history=ROOT.parent.parent/'finance-p04-multicurrency/thewyj.uk/docs/migration-evidence/finance-p03/nonphone-entry/cloud-20261021'
protected=junit_ids(history/'standard-full-junit');assert len(protected)==681
subsets=[]
for size,prefix in [(63,'P03-JVM-'),(41,'CO-JVM-'),(99,'A-JVM-'),(79,'FINAL-JVM-')]:
 path=history/f'delivery-final/suite-{size}.json';inputs[str(path)]=sha(path)
 rows=json.loads(path.read_text(encoding='utf-8'))
 subsets.append({(r.get('class',r.get('classname')),r.get('method',r.get('name')))for r in rows if r.get('case_id','').startswith(prefix)})
assert [len(x)for x in subsets]==[26,18,31,18]
original=protected-set.union(*subsets);assert len(original)==588 and original<=current.keys()
jvm588=[current[k]for k in sorted(original)];assert counts(jvm588)=={'PASS':585,'FAIL':3}
browser6=nd('node-repair-r3/regression/aeris-dom/original-six.ndjson');assert len(browser6)==6 and counts(browser6)=={'FAIL':2,'PASS':4}
node_log=E/'v62-original/aeris-node.log';inputs[node_log.relative_to(ROOT).as_posix()]=sha(node_log)
tap=node_log.read_text(encoding='utf-8');assert re.search(r'^# tests 13$',tap,re.M)and re.search(r'^# pass 13$',tap,re.M)and re.search(r'^# fail 0$',tap,re.M)
raw=read('v62-original/frozen-608-reevaluated.json');v2=read('v62-original/contract-608-current.json')
assert len(raw['cases'])==len(v2['cases'])==608 and len({r['case_id']for r in raw['cases']})==608
assert counts(raw['cases'])==raw['counts']=={'PASS':552,'FAIL':5,'EXPECTED_RED':28,'NOT_TESTED':23}
assert counts(v2['cases'])==v2['counts']=={'PASS':558,'FAIL':5,'EXPECTED_RED':22,'NOT_TESTED':23}
v2byid={r['case_id']:r for r in v2['cases']};delta=[]
for row in raw['cases']:
 new=v2byid[row['case_id']]
 assert row.get('fixture')==new.get('fixture'),'Frozen fixture/oracle changed'
 assert row.get('expected')==new.get('expected'),'Frozen top-level expectation changed'
 if row['status']!=new['status']:delta.append(dict(case_id=row['case_id'],raw=row['status'],versioned=new['status'],reason=new.get('versioned_contract_reason',new.get('contract_reason',''))))
assert len(delta)==6 and all(r['raw']=='EXPECTED_RED'and r['versioned']=='PASS'for r in delta)
currency=v2['currency18'];assert len(currency)==18 and counts(currency)=={'PASS':18}
assert dict(Counter(r['raw_status']for r in currency))=={'EXPECTED_RED':6,'PASS':12}
red26=[r for r in raw['cases']if r['group']in ['A','C']and r['status']in ['FAIL','EXPECTED_RED']]
assert len(red26)==26 and counts(red26)=={'FAIL':4,'EXPECTED_RED':22}
first=read('node-repair-r3/commands.json');remaining=read('v62-remaining-node-r3/regression/node-commands.json')
assert len(first)==12 and len(remaining)==21
names=[r['name']for r in first+remaining]+['aeris-node'];assert len(names)==len(set(names))==34
command_counts=dict(Counter('EXIT_0'if r['exit_code']==0 else 'EXIT_1'for r in first+remaining));command_counts['EXIT_0']+=1
assert command_counts=={'EXIT_1':5,'EXIT_0':29}
retry=nd('v62-p03-server-startup-retry/result/server.ndjson');assert len(retry)==25 and counts(retry)=={'PASS':25}
task21=read('v62-upgraded-task21/result.json');assert task21['exit_code']==0 and task21['assertion_lines']==221
configured=read('v62-regression-configured/jvm-commands.json')
legacy_bridge=next(r for r in configured if r['name']=='legacy-bridge-seed');assert legacy_bridge['exit_code']==1
assert not any(r['name']=='legacy-bridge-restore'for r in configured)
p03rows=[current[k]for k in sorted(subsets[0])]+retry+nd('v62-remaining-node-r3/regression/p03-legacy/legacy-raw.ndjson')+read('v62-remaining-node-r3/regression/p03-migration/migration.json')
p03rows += [dict(case_id='P03-BRIDGE-SEED',status='FAIL'),dict(case_id='P03-BRIDGE-RESTORE',status='NOT_TESTED')]
assert len(p03rows)==63 and counts(p03rows)=={'PASS':58,'FAIL':4,'NOT_TESTED':1}
traces=next(r for r in configured if r['name']=='trace-five')['cases'];assert len(traces)==5 and counts(traces)=={'PASS':5}
new38=list(traces)
for folder,file,expected in [('legacy-projection-release','legacy-controls.ndjson',15),('legacy-browser-release','legacy-browser.ndjson',10),('provider-identity-final','provider-identity.ndjson',8)]:
 rows=nd(f'v62-remaining-node-r3/regression/{folder}/{file}');assert len(rows)==expected
 new38 += rows
assert len(new38)==38 and counts(new38)=={'PASS':38}
ai={}
for name,file in [('protocol','result.json'),('model-boundary','result.json'),('quality76','quality.json'),('rich','contracts.json'),('roles','contracts.json'),('recovery','result.json'),('migration','result.json'),('chrome','result.json')]:
 data=read(f'ai-r3/{name}/{file}');ai[name]=dict(counts=counts(data['rows']),failures=[r for r in data['rows']if r['status']!='PASS'])
assert ai['roles']['counts']=={'PASS':21,'FAIL':2}
semantic=read('v62-original/semantic-anchor.json');directions=read('v62-original/direction-controls.json')
assert counts(semantic['rows'])=={'PASS':78}and counts(directions['rows'])=={'PASS':6}
lock=read('v62-remaining-node-r3/regression/node-source-lock.json');assert lock['source_stable']
drift=[];source_count=0
for group,manifest in [('native',native['source_after']['files']),('node',lock['after']['files'])]:
 for name,digest in manifest.items():
  source_count+=1;path=ROOT/name
  if not path.is_file()or sha(path)!=digest:drift.append(dict(scope=group,path=name))
assert not drift,'Current product/test bytes differ from the tested manifest'
lint=Counter(issue.get('severity')for issue in ET.parse(E/'v62-native/lint-results-debug.xml').getroot().findall('issue'))
assert lint=={'Warning':90,'Hint':13}
for item in native['artifacts']:
 path=ROOT/item['path'];assert path.stat().st_size==item['bytes']and sha(path)==item['sha256']
 inputs[path.relative_to(ROOT).as_posix()]=sha(path)
for helper in ['v62-forwarded.py','v62-remaining.py']:
 path=ROOT/'qa/aeris-finance-quality'/helper;ast.parse(path.read_text(encoding='utf-8'));inputs[path.relative_to(ROOT).as_posix()]=sha(path)
result=dict(utc=utc(),head=git('rev-parse','HEAD'),scope='Read-only reconciliation of existing fresh Oct29 outputs; no new product test execution',
 standard833=counts(native['cases']),original607=dict(PASS=602,FAIL=5,JVM=counts(jvm588),Node=dict(PASS=13),Chrome=counts(browser6)),
 raw608=raw['counts'],versioned608=v2['counts'],versioned_fixture_equality=True,currency18=currency,versioned_status_delta=delta,
 identity26=dict(counts=counts(red26),ids=[r['case_id']for r in red26]),node34_command_exit_counts=command_counts,
 retained_node_command_failures=[dict(name=r['name'],exit_code=r['exit_code'])for r in first+remaining if r['exit_code']],
 original_p03_63=counts(p03rows),new38=counts(new38),new38_warning='Disjoint from each other; overlaps larger JVM/Node/matrix collections. Never add to those totals.',
 separate_p03_startup_retry=counts(retry),separate_task21_current_capability=task21,ai=ai,semantic=counts(semantic['rows']),directions=counts(directions['rows']),
 native_failures=[r for r in native['cases']if r['status']!='PASS'],lint=dict(lint),source_manifest_file_instances_verified=source_count,source_drift=drift,
 inputs=inputs,phone_operations=0,production_mutations=0,external_model_calls=0,status='AUDIT_PASS_PRODUCT_FAILURES_RETAINED')
write(out/'result.json',result)
write(out/'raw608-nonpass-ledger.json',[r for r in raw['cases']if r['status']!='PASS'])
write(out/'identity26-ledger.json',red26)
print(json.dumps({k:result[k]for k in ['status','head','standard833','original607','raw608','versioned608','node34_command_exit_counts','source_manifest_file_instances_verified','source_drift']}))
