"""Download only this run's QA project configuration into an owned empty folder."""
from pathlib import Path
import argparse,hashlib,json,os,re,shutil,subprocess,tempfile
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p04/closure-current'
parser=argparse.ArgumentParser();parser.add_argument('--after',action='store_true');parser.add_argument('--label');args=parser.parse_args()
assert args.label is None or re.fullmatch('[a-z0-9-]+',args.label)
DEST=OUT/(args.label or ('hosted-bindings-after-fix' if args.after else 'hosted-bindings-before-fix'));DEST.mkdir(exist_ok=False)
temporary=Path(tempfile.mkdtemp(prefix='finance-p04-cf-meta-'))
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
command=[str(node),str(ROOT/'node_modules/wrangler/bin/wrangler.js'),'pages','download','config','thewyj-finance-qa','--cwd',str(temporary)]
root_hash=hashlib.sha256((ROOT/'wrangler.jsonc').read_bytes()).hexdigest()
with (DEST/'command.log').open('xb') as stream:
 result=subprocess.run(command,cwd=temporary,env=dict(os.environ,CI='true',WRANGLER_SEND_METRICS='false'),stdout=stream,stderr=subprocess.STDOUT,timeout=60)
assert root_hash==hashlib.sha256((ROOT/'wrangler.jsonc').read_bytes()).hexdigest()
files=[p for p in temporary.iterdir() if p.name in {'wrangler.jsonc','wrangler.toml'}]
data={'exit_code':result.returncode,'owned_temp':str(temporary),'root_configuration_unchanged':True,'database_ids':[]}
for path in files:
 content=path.read_text(encoding='utf8');data['database_ids']+=re.findall(r'database_id["\s]*[:=]\s*"([a-f0-9-]+)"',content)
 shutil.copy2(path,DEST/path.name)
data['database_ids']=sorted(set(data['database_ids']))
if args.after:assert data['database_ids']==['c2eb978f-9f49-4e4c-8286-f6b398fae0de'],data
(DEST/'result.json').write_text(json.dumps(data,indent=2),encoding='utf8');print(json.dumps(data))
