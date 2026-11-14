"""Separate current-protocol replay. Original HTTP source and failure remain intact."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import re
import subprocess

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('suite',choices=['task16','task21']);args=parser.parse_args()
OUT=Path(os.environ['FINANCE_P04_OUTPUT']).resolve();assert OUT.is_relative_to(ROOT/'docs/migration-evidence/finance-p04')
OUT.mkdir(exist_ok=False,parents=True)
source=ROOT/'local-backend'/('test_task21_notification_js.mjs' if args.suite=='task21' else 'test_task16_d1_js.mjs')
original=source.read_text(encoding='utf8');modified=original;replacements=[]
for match in list(re.finditer(r'from (["\'])(\.\.?/[^"\']+)\1',original)):
    before=match.group(0);after='from '+json.dumps((source.parent/match[2]).resolve().as_uri())
    if before not in [row[0] for row in replacements]:replacements.append((before,after))
replacements.append(('const ROOT = path.resolve(import.meta.dirname, "..");','const ROOT = '+json.dumps(str(ROOT).replace('\\','/'))+';'))
replacements.append(('const headers = new Headers(options.headers || {});','const headers = new Headers(options.headers || {});\n  headers.set("X-Finance-Money-Version", "3");'))
for before,after in replacements:
    assert before in modified,before
    modified=modified.replace(before,after)
reversed_source=modified
for before,after in reversed(replacements):reversed_source=reversed_source.replace(after,before)
assert reversed_source==original
assert [line for line in modified.splitlines() if 'assert.' in line]==[line for line in original.splitlines() if 'assert.' in line]
target=OUT/'derived-current-protocol.mjs';target.write_text(modified,encoding='utf8')
started=datetime.now(timezone.utc).isoformat()
with (OUT/'run.log').open('xb') as stream:
    result=subprocess.run([os.environ.get('FINANCE_NODE','node'),str(target)],cwd=ROOT,stdout=stream,stderr=subprocess.STDOUT)
record=dict(original=source.relative_to(ROOT).as_posix(),original_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),derived_sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
            changes='Only filesystem/import paths and capability3 request header. Original inputs and every assertion retained. Separate derived result cannot replace original protocol failure.',
            assertion_lines=sum('assert.' in line for line in original.splitlines()),started_utc=started,finished_utc=datetime.now(timezone.utc).isoformat(),exit_code=result.returncode,status='PASS' if result.returncode==0 else 'FAIL')
(OUT/'result.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record));raise SystemExit(result.returncode)
