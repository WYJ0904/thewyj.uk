"""One reviewed cache release for the current finance module graph."""
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[2]
NEW='20261031-aeris-p0-finance-r1'
old=['20261027-aeris-p07-ui-r1','20261014-aeris-task26-r9']
files=[ROOT/name for name in ['app.js','tools.js','workflows.js','changelog.js','learning-sync.js','index.html','sw.js']]+sorted((ROOT/'js').rglob('*.js'))
static=re.compile(r'''((?:from\s+|import\s+|import\s*\(\s*)["'])(\.{1,2}/[^"'?]+\.js)(?:\?[^"']*)?(["'])''')
changes=[];targets=set()
for p in files:
 before=p.read_text(encoding='utf8');text=before
 for value in old:text=text.replace(value,NEW)
 if p.suffix=='.js' and p.name!='sw.js':
  def version(m):
   target=(p.parent/m[2]).resolve();assert target.is_relative_to(ROOT)and target.is_file()
   targets.add('/'+target.relative_to(ROOT).as_posix()+'?v='+NEW)
   return m[1]+m[2]+'?v='+NEW+m[3]
  text=static.sub(version,text)
 if p.name=='sw.js':
  text,n=re.subn(r'^const CACHE = [^\r\n]+;',f'const CACHE = "wyj-shell-{NEW}-es-modules" + "-finance-money-v3";',text,count=1,flags=re.M);assert n==1
  text=re.sub(r'"(/js/[^"?]+\.js)"',lambda m:'"'+m[1]+'?v='+NEW+'"',text)
 if text!=before:p.write_text(text,encoding='utf8',newline='\n');changes.append(p.relative_to(ROOT).as_posix())
sw=ROOT/'sw.js';text=sw.read_text(encoding='utf8');missing=sorted(url for url in targets if '"'+url+'"'not in text)
if missing:
 marker='const OPTIONAL_BRAND_ASSETS =';assert text.count(marker)==1
 text=text.replace(marker,'CORE_SHELL.push('+','.join(json.dumps(url)for url in missing)+');\n'+marker)
 sw.write_text(text,encoding='utf8',newline='\n')
 if 'sw.js'not in changes:changes.append('sw.js')
print(json.dumps(dict(release=NEW,changed=changes,additional_shell_modules=missing)))
