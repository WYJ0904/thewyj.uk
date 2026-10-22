"""Local serial nonphone suites. Original cases stay unchanged; new evidence only."""
from datetime import datetime, timezone
from pathlib import Path
import json
import hashlib
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(os.environ.get('FINANCE_REGRESSION_OUTPUT', ROOT / 'docs/migration-evidence/finance-p04/local/final/regression')).resolve()
if not BASE.is_relative_to(ROOT / 'docs/migration-evidence'):
    raise SystemExit('Use an ignored evidence directory.')
BASE.mkdir(parents=True, exist_ok=True)
def source_manifest():
    names=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=ROOT).decode().split('\0')
    files={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in sorted(set(names)) if name and (ROOT/name).is_file() and
           ((name.startswith(('functions/','js/','cloudflare/migrations/','qa/','local-backend/')) and name.endswith(('.mjs','.js','.sql','.json'))) or name in ['package.json','package-lock.json','sw.js'])}
    return dict(files=files,sha256=hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest())
before=source_manifest()
manifest = BASE / 'node-commands.json'
if manifest.exists():
    raise SystemExit('Preserve the previous execution; choose a new output directory.')
jobs = [
    ('aeris-node', 'local-backend/test_aeris_state_consistency.mjs'),
    ('aeris-dom', 'qa/finance-p04/legacy-browser-all.mjs'),
    ('task21', 'local-backend/test_task21_notification_js.mjs'),
    ('task16', 'local-backend/test_task16_d1_js.mjs'),
    ('task17', 'local-backend/test_task17_d1_js.mjs'),
    ('p03-server', 'qa/finance-p03/server.mjs'),
    ('p03-legacy', 'qa/finance-p03/legacy-raw.mjs'),
    ('p03-migration', 'qa/finance-p03/final/legacy-migration.mjs'),
    ('closeout-server', 'qa/finance-p03/closeout/clearing.mjs'),
    ('closeout-d1', 'qa/finance-p03/final/clearing-migration.mjs'),
    ('p02-web', 'qa/finance-p02/web-contracts.mjs'),
    ('p02-dom', 'qa/finance-p02/web-dom.mjs'),
    ('p02-d1', 'qa/finance-p02/ledger-d1.mjs'),
    ('device-reconciliation', 'qa/finance-p03/phase-a/reconciliation.mjs'),
    ('device-correction-migration', 'qa/finance-p03/final/correction-migration.mjs'),
    ('device-resolution', 'qa/finance-p03/final/resolution.mjs'),
    ('device-controls', 'qa/finance-p03/final/controls.mjs'),
    ('device-providers', 'qa/finance-p03/final/providers.mjs'),
    ('device-d1-migration', 'qa/finance-p03/final/migration.mjs'),
    ('device-local-sandbox', 'qa/finance-p03/final/local-sandbox.mjs'),
    ('legacy-projection-release', 'qa/finance-p03/finish/legacy-controls.mjs'),
    ('legacy-browser-release', 'qa/finance-p03/finish/legacy-browser.mjs'),
    ('provider-identity-final', 'qa/finance-p03/finish/provider-identity.mjs'),
]
jobs += [(name,'qa/finance-p04/'+name+'.mjs') for name in ['money','oracle','fx','contracts','default-currency','migrations','review-migrations','browser','live-fx']]
if '--p04-only' in sys.argv: jobs=[row for row in jobs if row[1].startswith('qa/finance-p04/') and row[0]!='aeris-dom']
if '--only' in sys.argv:
    selected=set(sys.argv[sys.argv.index('--only')+1].split(','))
    jobs=[row for row in jobs if row[0] in selected]
    assert {row[0] for row in jobs}==selected
results = []
for name, script in jobs:
    output = BASE / ('p02-web' if name.startswith('p02-') else name)
    environment = dict(os.environ, FINANCE_P03_OUTPUT=str(output), FINANCE_P04_OUTPUT=str(output))
    environment.pop('P03_FROZEN_OUTPUT_PREFIX', None)
    environment['FINANCE_OUTPUT_REDIRECT']='./qa/finance-p04/output-redirect.mjs'
    command = [os.environ.get('FINANCE_NODE','node')]
    if name.startswith('p02-'):
        command += ['--import', os.environ.get('FINANCE_OUTPUT_REDIRECT', './qa/finance-p04/output-redirect.mjs')]
    command += [script]
    started = datetime.now(timezone.utc).isoformat()
    log = BASE / f'{name}.log'
    with log.open('x') as stream:
        completed = subprocess.run(command, cwd=ROOT, env=environment, stdout=stream, stderr=subprocess.STDOUT)
    results.append(dict(name=name, command=command, output=str(output.relative_to(ROOT)),
                        started_utc=started, finished_utc=datetime.now(timezone.utc).isoformat(),
                        exit_code=completed.returncode, expected_red=name in {'p02-web', 'p02-dom'},
                        log=str(log.relative_to(ROOT))))
    manifest.write_text(json.dumps(results, indent=2) + '\n')
    print(f'{name}: exit {completed.returncode}', flush=True)
after=source_manifest()
(BASE/'node-source-lock.json').write_text(json.dumps(dict(before=before,after=after,source_stable=before==after,head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()),indent=2)+'\n')
sys.exit(int(before!=after or any(row['exit_code'] for row in results if not row['expected_red'])))
