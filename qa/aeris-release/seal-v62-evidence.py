"""Seal local evidence without publishing it or serializing credentials."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/aeris-p03-p07'
p=argparse.ArgumentParser();p.add_argument('--label',required=True);a=p.parse_args();assert re.fullmatch('v62-evidence-seal-[a-z0-9-]+',a.label)
OUT=E/a.label;OUT.mkdir(exist_ok=False)
def sha(path):
 h=hashlib.sha256()
 with path.open('rb')as stream:
  for b in iter(lambda:stream.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
files={};excluded=[]
for path in sorted(E.rglob('*')):
 if not path.is_file():continue
 rel=path.relative_to(E)
 if path.is_relative_to(OUT)or any(part=='private'or part.startswith('private-')or part.startswith('runtime')or part=='__pycache__'or part=='chrome-profile'for part in rel.parts)or path.name=='.dev.vars':
  excluded.append(rel.as_posix());continue
 assert not path.is_symlink()
 before=path.stat();digest=sha(path);after=path.stat();assert (before.st_size,before.st_mtime_ns)==(after.st_size,after.st_mtime_ns),'Evidence changed while sealing'
 files[rel.as_posix()]=dict(bytes=before.st_size,sha256=digest)
 if len(files)%300==0:print(json.dumps(dict(sealed=len(files))),flush=True)
names=set(subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=ROOT,text=True).splitlines()+subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines())
sources={}
for name in sorted(names):
 if name=='docs/release/AERIS_V62_EVIDENCE_SEAL.md':continue
 path=ROOT/name;assert path.is_file()and not path.is_symlink()
 sources[name]=dict(bytes=path.stat().st_size,sha256=sha(path))
record=dict(utc=datetime.now(timezone.utc).isoformat(),runtime_commit='80139a03b5b655b4f4d7ba4e865778c7654bb91d',
 source_parent_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
 scope='Local raw evidence and working source; not a public upload; live private/runtime credentials deliberately excluded',
 files=files,source_files=sources,excluded=excluded,excluded_seal_descriptor='docs/release/AERIS_V62_EVIDENCE_SEAL.md',
 sealed_file_count=len(files),source_file_count=len(sources),financial_writes=0,phone_operations=0,cloud_mutations=0)
dest=OUT/'manifest.json';dest.write_text(json.dumps(record,indent=2),encoding='utf8')
summary=dict(manifest=dest.relative_to(ROOT).as_posix(),manifest_sha256=sha(dest),sealed_file_count=len(files),source_file_count=len(sources),excluded_count=len(excluded))
(OUT/'result.json').write_text(json.dumps(summary,indent=2),encoding='utf8');print(json.dumps(summary))
