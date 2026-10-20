"""Preserve the completed P03 seal and every protected parallel workspace."""
import argparse,datetime,hashlib,importlib.util,json,subprocess,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p03/device'
BASELINE='976eed4644556e70266fe0ef5e54b7c8e419d0ba'
REPORT='docs/finance-p03/FINANCE_P03_FINAL_REPORT.md'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT).decode('utf8').strip()
def read(p):return json.loads(p.read_text(encoding='utf8-sig'))
def main():
 p=argparse.ArgumentParser();p.add_argument('name');p.add_argument('--before');a=p.parse_args()
 OUT.mkdir(parents=True,exist_ok=True);target=OUT/(a.name+'.json');assert not target.exists()
 spec=importlib.util.spec_from_file_location('protection',ROOT/'qa/finance-p03/protection.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 files={}
 for folder in ['docs/finance-p02','docs/finance-p03','qa/finance-p02','qa/finance-p03','docs/migration-evidence/finance-p03']:
  for f in (ROOT/folder).rglob('*'):
   if f.is_file() and 'device' not in f.relative_to(ROOT/folder).parts and '__pycache__' not in f.parts:files[f.relative_to(ROOT).as_posix()]=sha(f)
 data={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),'status':git('status','--porcelain=v1'),'history':files,'protected':m.snapshot()}
 assert data['branch']=='codex/finance-p03-identity-preauth'
 if not a.before:
  assert data['head']==BASELINE
  seal=read(ROOT/'docs/migration-evidence/finance-p03/final/provenance.json');errors=[]
  for group in ['source_report_sha256','raw_evidence_sha256','tested_inputs_sha256']:
   for name,d in seal[group].items():
    if not (ROOT/name).is_file() or sha(ROOT/name)!=d:errors.append(name)
  assert not errors,errors
  data['prior_seal_verified']={k:len(seal[k]) for k in ['source_report_sha256','raw_evidence_sha256','tested_inputs_sha256']}
  (OUT/'baseline-report.md').write_bytes((ROOT/REPORT).read_bytes())
 else:
  before=read(OUT/(a.before+'.json'));changes=[k for k,d in before['history'].items() if files.get(k)!=d]
  assert not [k for k in changes if k!=REPORT],changes
  comparison=m.compare(before['protected'],data['protected'])
  assert all(not r['added'] and not r['missing'] and not r['changed'] and all(v for k,v in r.items() if k.endswith('Same')) for r in comparison.values()),comparison
  data['comparison']={'history_changes':changes,'protected':comparison}
 target.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps({'head':data['head'],'history_files':len(files),'protected_groups':len(data['protected']),'prior_seal_verified':data.get('prior_seal_verified'),'comparison':data.get('comparison')},ensure_ascii=False))
if __name__=='__main__':main()
