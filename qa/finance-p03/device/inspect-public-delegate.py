"""Follow only the public Room delegate referenced by NotificationDatabase_Impl."""
from pathlib import Path
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/migration-evidence/finance-p03/device'
folder=OUT/'public-apk-schema'
source=(folder/'classes.dex.NotificationDatabase_Impl.txt').read_text(encoding='utf8')
method=source[source.index("name          : 'createOpenDelegate'"):]
delegate=re.search(r'new-instance v\d+, (L[^;]+;)',method).group(1)
tool=Path.home()/'AppData/Local/Android/Sdk/build-tools/36.1.0/dexdump.exe'
proc=subprocess.Popen([str(tool),'-d',str(folder/'classes.dex')],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
keep=False;lines=[]
for raw in proc.stdout:
    line=raw.decode('utf8',errors='replace')
    if line.startswith('Class #'):keep=False
    if 'Class descriptor' in line and "'"+delegate+"'" in line:keep=True
    if keep:lines.append(line)
error=proc.stderr.read();assert proc.wait()==0,error
text=''.join(lines);assert text
target=folder/'RoomOpenDelegate.txt';assert not target.exists();target.write_text(text,encoding='utf8')
hashes=sorted(set(re.findall(r'"([0-9a-f]{32})"',text)))
matches=[]
for p in (ROOT/'android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase').glob('*.json'):
    d=json.loads(p.read_text(encoding='utf8'))['database']
    if d['identityHash'] in hashes:matches.append({'version':d['version'],'identity_hash':d['identityHash'],'schema':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
assert len(matches)==1,matches
result={'public_apk_sha256':hashlib.sha256((OUT/'public-installed-formal.apk').read_bytes()).hexdigest(),'delegate_descriptor':delegate,'identity_hashes':hashes,'exact_repository_schema_match':matches[0],'compiled_version_evidence':[s.strip() for s in text.splitlines() if '#int 10' in s or 'invoke-direct' in s][:8],'delegate_dump':target.relative_to(ROOT).as_posix(),'private_database_read':False,'installed_private_version':'NOT TESTED','formal_in_place_upgrade':'NOT TESTED'}
dest=OUT/'public-apk-room-delegate.json';assert not dest.exists();dest.write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result))
