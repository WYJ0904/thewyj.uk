"""Inspect public APK bytecode only. Never opens an installed private database."""
from pathlib import Path
import hashlib,json,re,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p03/device'
APK=OUT/'public-installed-formal.apk'
DEST=OUT/'public-apk-schema';DEST.mkdir(exist_ok=False)
DEXDUMP=Path.home()/'AppData/Local/Android/Sdk/build-tools/36.1.0/dexdump.exe'
selected=[]
with zipfile.ZipFile(APK) as archive:
    for name in archive.namelist():
        if not re.fullmatch(r'classes\d*\.dex',name):continue
        data=archive.read(name)
        if b'NotificationDatabase_Impl' not in data:continue
        dex=DEST/name;dex.write_bytes(data)
        proc=subprocess.Popen([str(DEXDUMP),'-d',str(dex)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        keep=False;lines=[]
        for raw in proc.stdout:
            line=raw.decode('utf8',errors='replace')
            if line.startswith('Class #'):keep=False
            if 'Class descriptor' in line and "Luk/thewyj/app/task21/store/NotificationDatabase_Impl;'" in line:keep=True
            if keep:lines.append(line)
        error=proc.stderr.read().decode(errors='replace');assert proc.wait()==0,error
        if lines:
            text=''.join(lines);target=DEST/(name+'.NotificationDatabase_Impl.txt');target.write_text(text,encoding='utf8')
            selected.append({'dex':name,'public_class_dump':target.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'identity_hashes':sorted(set(re.findall(r'"([0-9a-f]{32})"',text)))})
schemas=[]
for p in (ROOT/'android/app/schemas').rglob('*.json'):
    if 'NotificationDatabase' not in str(p):continue
    d=json.loads(p.read_text(encoding='utf8'));db=d.get('database',{})
    schemas.append({'path':p.relative_to(ROOT).as_posix(),'version':db.get('version'),'identity_hash':db.get('identityHash'),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
matches=[s for s in schemas if any(s['identity_hash'] in v['identity_hashes'] for v in selected)]
result={'public_apk_sha256':hashlib.sha256(APK.read_bytes()).hexdigest(),'classes':selected,'matching_repository_schemas':matches,'private_installed_database_version':'NOT TESTED; no private app data opened','scope':'Public compiled code compatibility only, not installed data or formal upgrade acceptance'}
assert len(selected)==1,selected
(OUT/'public-apk-room-analysis.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result))
