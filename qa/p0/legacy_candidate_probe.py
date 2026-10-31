"""Diagnose the old Node DOM host without changing its inputs or assertions."""
from pathlib import Path
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2]
out=ROOT/'docs/migration-evidence/aeris-p0-closeout/legacy-candidate-host-r1';out.mkdir(parents=True,exist_ok=False)
source=ROOT/'local-backend/test_finance_candidates_js.mjs';text=source.read_text(encoding='utf8');before=text
needle='  globalThis.document = {';assert text.count(needle)==1
text=text.replace(needle,"  globalThis.CSS = {escape(value) { assert.match(String(value), /^[A-Za-z0-9:_-]+$/); return String(value).replaceAll(':', '\\\\:'); }};\n"+needle+'\n    querySelector() { return null; },')
old='"../js/finance/candidates.js"';assert text.count(old)==1;text=text.replace(old,json.dumps((ROOT/'js/finance/candidates.js').as_uri()))
assert [s for s in before.splitlines()if'assert.'in s]==[s for s in text.splitlines()if'assert.'in s and 'globalThis.CSS'not in s]
driver=out/'driver.mjs';driver.write_text(text,encoding='utf8')
node=Path.home()/'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
with (out/'probe.log').open('xb')as log:r=subprocess.run([str(node),str(driver)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
record=dict(original_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),driver_sha256=hashlib.sha256(driver.read_bytes()).hexdigest(),exit_code=r.returncode,
 changes='Only virtual CSS.escape and document.querySelector + moved import path. Original raw data and assertions unchanged.',original_assertions_unchanged=True)
(out/'result.json').write_text(json.dumps(record,indent=2),encoding='utf8');print(json.dumps(record))
raise SystemExit(r.returncode)
