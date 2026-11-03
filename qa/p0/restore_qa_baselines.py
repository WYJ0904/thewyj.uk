"""Restore only missing, SHA-pinned historical synthetic migration test inputs."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[2]
OLD=Path.home()/'.codex/worktrees/aeris-finance-quality/thewyj.uk'
E=OLD/'docs/migration-evidence/aeris-finance-quality'
manifest=json.loads((E/'environment-repair/provenance.json').read_text())['copies']
out=ROOT/'docs/migration-evidence/aeris-p0-closeout/migration-inputs-r1';out.mkdir(parents=True,exist_ok=False)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
folders=['finance-p03/closeout/baseline-v3/functions/_lib','finance-p03/phase-a/baseline-v4/functions/_lib','finance-p03/final/baseline-source/functions/_lib']
rows=[]
for rel in folders:
 target=ROOT/'docs/migration-evidence'/rel;assert not target.exists(),'Never overwrite existing evidence'
 source=E/'historical-baselines'/rel
 for file in sorted(source.iterdir()):
  assert file.is_file()and file.suffix in ['.mjs','.js']
  key=file.relative_to(OLD).as_posix();expected=next(m['sha256']for m in manifest if m['dest']==key)
  assert sha(file)==expected
  dest=target/file.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,dest);assert sha(dest)==expected
  rows.append(dict(source=str(file),target=dest.relative_to(ROOT).as_posix(),sha256=expected))
(out/'result.json').write_text(json.dumps(dict(copies=rows,original_oracles_modified=False,original_missing_input_failures_retained=True),indent=2),encoding='utf8')
print(json.dumps(dict(status='PASS',copied=len(rows))))
