"""Bounded Wrangler calls: metadata reads or newly owned isolated resources only."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import json
import os
import subprocess
import time

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/migration-evidence/finance-p04/closure-current'
NODE = Path.home() / 'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
WRANGLER = ROOT / 'node_modules/wrangler/bin/wrangler.js'
parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['pages-list', 'create-db', 'create-pages', 'pages-deployments','verify-qa','remote-schema','remote-secrets','deploy','seed-accounts','seed-accounts-r2','preview-secrets','deploy-r2','qa-auth-audit','qa-auth-audit-r2','qa-ui-entry-audit','deploy-r3','old-preview-own-audit','qa-finance-proof','qa-export','qa-create-restore','qa-deployment-list','deploy-final'])
args = parser.parse_args()
commands = {
    'pages-list': ['pages', 'project', 'list', '--json'],
    'create-db': ['d1', 'create', 'finance-p03-p04-qa', '--location', 'apac', '--update-config=false'],
    'create-pages': ['pages', 'project', 'create', 'thewyj-finance-qa', '--production-branch', 'qa-hold'],
    'pages-deployments': ['pages', 'deployment', 'list', '--project-name', 'thewyj-uk', '--json'],
    'verify-qa': ['d1','list','--json'],
    'remote-schema': ['d1','execute','finance-p03-p04-qa','--remote','--file',str(OUT/'qa-schema.sql'),'--json','--cwd',str(ROOT/'.wrangler/pages-output')],
    'remote-secrets': ['pages','secret','bulk',str(OUT/'private/qa-secrets.json'),'--project-name','thewyj-finance-qa','--cwd',str(ROOT/'.wrangler/pages-output')],
    'deploy': ['pages','deploy',str(ROOT/'.wrangler/pages-output'),'--project-name','thewyj-finance-qa','--branch','finance-p03-p04-qa','--commit-dirty=true','--commit-hash','329aa0c8da33776d72bc778c9a3737865d26fd6f'],
    'seed-accounts': ['d1','execute','finance-p03-p04-qa','--remote','--file',str(OUT/'private/qa-accounts.sql'),'--json','--cwd',str(ROOT/'.wrangler/pages-output')],
    'seed-accounts-r2': ['d1','execute','finance-p03-p04-qa','--remote','--file',str(OUT/'private/qa-accounts-r2.sql'),'--json','--cwd',str(ROOT/'.wrangler/pages-output')],
    'preview-secrets': ['pages','secret','bulk',str(OUT/'private/qa-secrets.json'),'--project-name','thewyj-finance-qa','--env','preview','--cwd',str(ROOT/'.wrangler/pages-output')],
    'deploy-r2': ['pages','deploy',str(ROOT/'.wrangler/pages-output'),'--project-name','thewyj-finance-qa','--branch','finance-p03-p04-qa','--commit-dirty=true','--commit-hash','329aa0c8da33776d72bc778c9a3737865d26fd6f'],
    'qa-auth-audit': ['d1','execute','finance-p03-p04-qa','--remote','--command',"SELECT id,username,password_scheme,password_iterations,length(password_hash) AS verifier_length FROM task12_users; SELECT key,value FROM task16_metadata WHERE key='schema_version'; SELECT key,value FROM task21_metadata WHERE key='schema_version';",'--json','--cwd',str(ROOT/'.wrangler/pages-output')],
    'qa-auth-audit-r2': ['d1','execute','finance-p03-p04-qa','--remote','--command',"SELECT id,username,password_scheme,password_iterations,length(password_hash) AS verifier_length FROM task12_users; SELECT key,value FROM task16_metadata WHERE key='schema_version'; SELECT key,value FROM task21_metadata WHERE key='schema_version';",'--json','--cwd',str(ROOT/'.wrangler/pages-output')],
    'qa-ui-entry-audit': ['d1','execute','finance-p03-p04-qa','--remote','--command',"SELECT CASE WHEN username IN ('synthetic-p04-closure','synthetic-p04-closure-b') THEN 'expected_qa_user' WHEN username IN ('<redacted>','redacted') THEN 'placeholder' ELSE 'other_user_redacted' END AS input_scope,success,reason,COUNT(*) AS attempts FROM task12_login_audit_logs GROUP BY input_scope,success,reason;",'--json','--cwd',str(ROOT/'.wrangler/pages-output')],
    'deploy-r3': ['pages','deploy',str(ROOT/'.wrangler/pages-output'),'--project-name','thewyj-finance-qa','--branch','finance-p03-p04-qa','--commit-dirty=true','--commit-hash','329aa0c8da33776d72bc778c9a3737865d26fd6f','--cwd',str(ROOT/'.wrangler/pages-output')],
    'old-preview-own-audit': ['d1','execute','a3e6253b-689f-49f3-998b-7c5828ea255a','--remote','--command',"SELECT id,CASE WHEN username IN ('synthetic-p04-closure','synthetic-p04-closure-b') THEN 'expected_qa_user' ELSE 'placeholder' END AS input_scope,success,reason,created_at FROM task12_login_audit_logs WHERE username IN ('synthetic-p04-closure','synthetic-p04-closure-b','<redacted>','redacted') AND created_at>='2026-10-23T07:54:00Z' AND created_at<'2026-10-23T09:55:00Z';",'--json'],
    'qa-finance-proof': ['d1','execute','finance-p03-p04-qa','--remote','--command',"SELECT id,currency,amount_minor,amount_exponent,revision FROM task16_finance_transactions WHERE user_id='synthetic-p04-closure-owner' AND id LIKE 'synthetic-hosted-p04-%' ORDER BY id; SELECT COUNT(*) AS receipts FROM task16_finance_sync_operations WHERE user_id='synthetic-p04-closure-owner'; SELECT key,value FROM task16_metadata WHERE key='schema_version'; SELECT key,value FROM task21_metadata WHERE key='schema_version';",'--json','--cwd',str(ROOT/'.wrangler/pages-output')],
    'qa-export': ['d1','export','finance-p03-p04-qa','--remote','--output',str(OUT/'private/hosted-backup.sql'),'--cwd',str(ROOT/'.wrangler/pages-output')],
    'qa-create-restore': ['d1','create','finance-p03-p04-qa-restore','--location','apac','--update-config=false'],
    'qa-deployment-list': ['pages','deployment','list','--project-name','thewyj-finance-qa','--json','--cwd',str(ROOT/'.wrangler/pages-output')],
    'deploy-final': ['pages','deploy',str(ROOT/'.wrangler/pages-output'),'--project-name','thewyj-finance-qa','--branch','finance-p03-p04-qa','--commit-dirty=true','--commit-hash','73764f77fd02ada240e41c24734e523c5dad8805','--cwd',str(ROOT/'.wrangler/pages-output')],
}
if args.action in {'deploy','deploy-r2'}:
    commands[args.action]+= ['--cwd',str(ROOT/'.wrangler/pages-output')]
if args.action.startswith('deploy'):
    configuration=json.loads((ROOT/'.wrangler/pages-output/wrangler.jsonc').read_text(encoding='utf8'))
    assert configuration['name']=='thewyj-finance-qa'
    assert all(binding['database_id']=='c2eb978f-9f49-4e4c-8286-f6b398fae0de'
               for section in [configuration,configuration['env']['preview']] for binding in section['d1_databases'])
dest = OUT / ('cloud-' + args.action)
dest.mkdir(exist_ok=False)
env = dict(os.environ, CI='true', WRANGLER_SEND_METRICS='false', NO_COLOR='1')
env['PATH'] = str(NODE.parent) + os.pathsep + env.get('PATH', '')
argv = [str(NODE), str(WRANGLER), *commands[args.action]]
started = datetime.now(timezone.utc).isoformat()
begin = time.monotonic()
with (dest / 'stdout.log').open('xb') as stdout, (dest / 'stderr.log').open('xb') as stderr:
    process = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=stdout, stderr=stderr)
    try:
        code = process.wait(timeout=60)
        status = 'PASS' if code == 0 else 'FAIL'
    except subprocess.TimeoutExpired:
        process.kill()  # Only the specific Wrangler child this invocation started.
        code = process.wait()
        status = 'TIMEOUT'
record = {'argv': argv, 'pid': process.pid, 'started_utc': started,
          'finished_utc': datetime.now(timezone.utc).isoformat(), 'seconds': round(time.monotonic()-begin, 3),
          'exit_code': code, 'status': status, 'production_mutations': False,
          'scope': 'metadata reads or finance-p03-p04-qa / thewyj-finance-qa only'}
(dest / 'command.json').write_text(json.dumps(record, indent=2), encoding='utf8')
print(json.dumps(record))
raise SystemExit(int(status != 'PASS'))
