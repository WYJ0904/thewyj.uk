"""Collect fresh originals and v2 without hiding failed environmental attempts."""
from common import *
import sys

ORIGIN=Path.home()/'.codex/worktrees/finance-p04-multicurrency/thewyj.uk'
BASE=E/'final-r3'
dest=E/'drivers/collector-current.py'
source=ROOT/'qa/finance-p06/collect.py';s=source.read_text()
replacements=[
 ('ROOT=Path(__file__).resolve().parents[2]',f'ROOT=Path({ROOT.as_posix()!r})\nORIGIN=Path({ORIGIN.as_posix()!r})'),
 ("HISTORY=ROOT/'docs/migration-evidence/finance-p03'","HISTORY=ORIGIN/'docs/migration-evidence/finance-p03'"),
 ('finance-p04/p06-validation/final-r3','aeris-finance-quality/final-r3'),
 ('finance-p04/p06-validation','aeris-finance-quality'),
 ('previousP05=read(ROOT/','previousP05=read(ORIGIN/'),
 ('beforeP05=read(ROOT/','beforeP05=read(ORIGIN/'),
 ("junit(ROOT/'docs/migration-evidence/finance-p04/cloud/final-20261022/android-current/junit')","junit(ORIGIN/'docs/migration-evidence/finance-p04/cloud/final-20261022/android-current/junit')"),
 ("source=ROOT/'docs/migration-evidence/finance-p03/final/compat-p03/kotlin/P03BridgeTest.kt'","source=ROOT/'docs/migration-evidence/aeris-finance-quality/fixtures/compat-p03/kotlin/P03BridgeTest.kt'"),
 ("expected={'prepare-backup',","expected={"),
]
for before,after in replacements:
    assert before in s,before;s=s.replace(before,after)
helpers='''
QUALITY=ROOT/'docs/migration-evidence/aeris-finance-quality'
PATH_SELECTION=[
 (BASE/'regression/aeris-dom',QUALITY/'node-repair-r2/regression/aeris-dom'),
 (BASE/'regression/p02-web',QUALITY/'node-repair-r1/regression/p02-web'),
 (BASE/'contract-input-drivers',QUALITY/'contract-repair-r1/contract-input-drivers'),
 (BASE/'declared-native-command',QUALITY/'contract-repair-r1/declared-native-command'),
 (BASE/'declared-native',QUALITY/'contract-repair-r1/declared-native'),
]
PATH_SELECTION += [(BASE/'regression'/name,QUALITY/'node-repair-r1/regression'/name) for name in ['contracts','default-currency','migrations','review-migrations','browser','live-fx','raw-transport','unit-review']]
def selected(path):
 path=Path(path).resolve()
 for original,repaired in PATH_SELECTION:
  if path.is_relative_to(original):return repaired/path.relative_to(original)
 return path
'''
s=s.replace('INPUTS=set()','INPUTS=set()\n'+helpers)
s=s.replace('path=Path(path).resolve(); INPUTS.add(path); return path','path=selected(Path(path).resolve()); INPUTS.add(path); return path')
old="def read(path):return json.loads(tracked(path).read_text(encoding='utf-8-sig'))"
new="""def rawread(path):return json.loads(tracked(path).read_text(encoding='utf-8-sig'))
def read(path):
 result=rawread(path)
 if Path(path).resolve()==(BASE/'regression/node-commands.json').resolve():
  by_name={row['name']:row for row in result}
  for manifest in [QUALITY/'node-repair-r1/commands.json',QUALITY/'node-repair-r2/commands.json']:
   for row in rawread(manifest):
    previous=by_name[row['name']]
    by_name[row['name']]=dict(row,original_attempt=previous,selection_disposition='PATH_ENVIRONMENT_REPAIR_NO_ORACLE_CHANGE')
  return list(by_name.values())
 return result"""
assert old in s;s=s.replace(old,new)
s=s.replace("def rel(path):return path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else path.as_posix()",
 "def rel(path):\n    path=selected(path)\n    return path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else path.as_posix()")
s=s.replace('for path in folder.glob(', 'for path in selected(folder).glob(')
s=s.replace('if not (BASE/name).is_file()', 'if not selected(BASE/name).is_file()')
s=s.replace("list((BASE/name).glob('TEST-*.xml'))", "list(selected(BASE/name).glob('TEST-*.xml'))")
s=s.replace("target=BASE/'contract-input-drivers'/('native/kotlin/FinanceP02MatrixTest.kt' if source.suffix=='.kt' else 'web-dom-declared-inputs.mjs')",
 "target=selected(BASE/'contract-input-drivers'/('native/kotlin/FinanceP02MatrixTest.kt' if source.suffix=='.kt' else 'web-dom-declared-inputs.mjs'))")
s=s.replace("'CURRENT' if path.is_relative_to(BASE) else 'HISTORICAL_IDENTITY_OR_SOURCE'", "'CURRENT' if path.is_relative_to(QUALITY) else 'HISTORICAL_IDENTITY_OR_SOURCE'")
dest=E/'drivers'/('collector-current-'+hashlib.sha256(s.encode()).hexdigest()[:12]+'.py')
compile(s,str(dest),'exec')
if dest.exists():assert dest.read_text()==s,'Preserve a changed collector; choose a new version'
else:dest.write_text(s,encoding='utf-8')
if '--check' not in sys.argv:
    assert not (E/'gradle.lock').exists(),'Wait for the one native pipeline to finish'
    assert json.loads((E/'node-repair-r1/result.json').read_text())['source_stable']
    assert json.loads((E/'node-repair-r2/result.json').read_text())['source_stable']
command=[sys.executable,str(dest)]+(['--check'] if '--check' in sys.argv else [])
attempts=E/'collection-attempts';attempts.mkdir(exist_ok=True)
attempt=attempts/('check-' if '--check' in sys.argv else 'collect-')
index=len(list(attempts.glob(attempt.name+'*.json')))+1
log=attempts/(attempt.name+str(index)+'.log')
started=utc()
with log.open('xb') as stream:
    p=subprocess.run(command,cwd=ROOT,env=environment(),stdout=stream,stderr=subprocess.STDOUT)
write(attempts/(attempt.name+str(index)+'.json'),dict(command=command,started_utc=started,finished_utc=utc(),exit_code=p.returncode,log=log.relative_to(ROOT).as_posix()))
print(log.read_text(encoding='utf-8',errors='replace'))
if p.returncode==0 and '--check' not in sys.argv:
    original=json.loads((BASE/'regression/node-commands.json').read_text())
    repairs=[json.loads((E/name/'commands.json').read_text()) for name in ['node-repair-r1','node-repair-r2','contract-repair-r1']]
    all_commands=[dict(row,attempt_group='original-node-34') for row in original]
    for label,rows in zip(['node-repair-r1','node-repair-r2','contract-repair-r1'],repairs):
        all_commands += [dict(row,attempt_group=label) for row in rows]
    write(BASE/'delivery-current/all-node-and-repair-command-attempts.json',all_commands)
    write(BASE/'delivery-current/path-selection-provenance.json',dict(
        collector_source=source.relative_to(ROOT).as_posix(),collector_source_sha256=sha(source),
        collector_sha256=sha(dest),replacements=[dict(before=a,after=b) for a,b in replacements],
        selection_disposition='Use latest completed execution for each unchanged test identity; all earlier environment failures remain raw and indexed',
        overlapping_counts_are_not_summed=True,original_oracles_modified=False))
raise SystemExit(p.returncode)
