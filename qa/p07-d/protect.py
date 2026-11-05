"""Read-only snapshots of expressly protected checkouts; no private file reads."""
import hashlib, json, os, pathlib, subprocess, sys
BASE=pathlib.Path(os.environ['USERPROFILE'])
TARGETS=['Desktop/编程/thewyj.uk',*[f'.codex/worktrees/{n}/thewyj.uk' for n in
    ['gemini-p07-d-business-workspaces','aeris-p07-phase1-argon','aeris-p07-phase1-handover',
     'finance-release-convergence','task26-safe-integration','p06-safe-integration']]]
def git(root,*args):
    return subprocess.check_output(['git','-C',str(root),*args]).decode('utf-8').strip()
rows=[]
for relative in TARGETS:
    root=BASE/relative
    if not root.exists():
        rows.append({'path':relative,'status':'UNAVAILABLE'});continue
    status=git(root,'status','--porcelain','-uno')
    changed=git(root,'diff','--name-only','HEAD').splitlines()
    hashes={}
    for name in changed:
        file=root/name
        if file.is_file() and not any(x in name.lower() for x in ['secret','访问口令','dev.vars','credential','keystore']):
            hashes[name]=hashlib.sha256(file.read_bytes()).hexdigest()
    rows.append({'path':relative,'head':git(root,'rev-parse','HEAD'),'branch':git(root,'branch','--show-current'),
                 'status':status,'changed_file_hashes':hashes})
target=pathlib.Path(sys.argv[1])
target.parent.mkdir(parents=True,exist_ok=True)
with target.open('x',encoding='utf-8') as handle:json.dump(rows,handle,ensure_ascii=False,indent=2)
print('Recorded',len(rows),'protected checkout snapshots')
