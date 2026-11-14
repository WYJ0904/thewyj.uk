"""Read/export the two owned QA databases; verify the final SQL locally before cleanup.

No remote imports, mutations, tokens, or financial descriptions are emitted.
The full SQL is private because synthetic account verifiers are part of a backup.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, os, sqlite3, subprocess, time

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/migration-evidence/finance-p04/closure-current'
parser = argparse.ArgumentParser()
parser.add_argument('--attempt', choices=['r1','r2','r3'], default='r1')
args = parser.parse_args()
DEST = OUT / ('cloud-final-backup-' + args.attempt)
DEST.mkdir(exist_ok=False)
PRIVATE = OUT / 'private'
SOURCE = PRIVATE / ('hosted-final-backup-' + args.attempt + '.sql')
LOCAL = PRIVATE / ('hosted-final-export-restored-' + args.attempt + '.sqlite')
assert not SOURCE.exists() and not LOCAL.exists()
NODE = Path.home() / 'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
STAGE = ROOT / '.wrangler/pages-output'
PRIMARY = 'c2eb978f-9f49-4e4c-8286-f6b398fae0de'
RECOVERY = 'da1711d7-f770-4e30-b305-9d812588f8b4'
config = json.loads((STAGE / 'wrangler.jsonc').read_text())
assert config['name'] == 'thewyj-finance-qa'
assert config['d1_databases'][0]['database_id'] == PRIMARY
assert config['env']['preview']['d1_databases'][0]['database_id'] == PRIMARY
env = dict(os.environ, CI='true', NO_COLOR='1', WRANGLER_SEND_METRICS='false')
env['PATH'] = str(NODE.parent) + os.pathsep + env.get('PATH', '')
commands = []

def run(name, args, parse=True):
    argv = [str(NODE), str(ROOT / 'node_modules/wrangler/bin/wrangler.js'), *args, '--cwd', str(STAGE)]
    started = time.monotonic()
    with (DEST / (name + '.stdout.log')).open('xb') as stdout, (DEST / (name + '.stderr.log')).open('xb') as stderr:
        process = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=stdout, stderr=stderr)
        try:
            code = process.wait(60)
            status = 'PASS' if code == 0 else 'FAIL'
        except subprocess.TimeoutExpired:
            process.kill()
            code = process.wait()
            status = 'TIMEOUT'
    commands.append(dict(name=name, argv=argv, status=status, exit_code=code, seconds=round(time.monotonic()-started, 3)))
    (DEST / 'commands.json').write_text(json.dumps(commands, indent=2))
    assert status == 'PASS', name + ': ' + status
    return json.loads((DEST / (name + '.stdout.log')).read_text(encoding='utf8-sig')) if parse else None

row_query = 'SELECT id,user_id,direction,currency,amount_minor,amount_exponent,revision,occurred_at_ms,status FROM task16_finance_transactions ORDER BY id'
receipt_query = 'SELECT user_id,operation_id,operation_type,payload_digest,result_version FROM task16_finance_sync_operations ORDER BY user_id,operation_id'
notification_receipt_query = 'SELECT user_id,operation_id,operation_type,payload_digest,result_version FROM task21_notification_sync_operations ORDER BY user_id,operation_id'
QUERY = row_query + ';' + receipt_query + ';' + notification_receipt_query + ";SELECT COUNT(*) AS tables FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';PRAGMA foreign_key_check;"
record = dict(started_utc=datetime.now(timezone.utc).isoformat(), primary_database=PRIMARY, recovery_database=RECOVERY,
              production_mutations=False, remote_import=False, source='Final owned synthetic QA D1; no real WeChat data uploaded')
try:
    primary = run('primary-info', ['d1', 'info', PRIMARY, '--json'])
    recovery = run('recovery-info', ['d1', 'info', RECOVERY, '--json'])
    assert primary['uuid'] == PRIMARY and primary['name'] == 'finance-p03-p04-qa'
    assert recovery['uuid'] == RECOVERY and recovery['name'] == 'finance-p03-p04-qa-restore'
    deployments = run('deployments', ['pages', 'deployment', 'list', '--project-name', 'thewyj-finance-qa', '--json'])
    run('export', ['d1', 'export', PRIMARY, '--remote', '--output', str(SOURCE)], parse=False)
    live = run('live-finance', ['d1', 'execute', PRIMARY, '--remote', '--json', '--command', QUERY])
    sql = SOURCE.read_bytes()
    connection = sqlite3.connect(LOCAL)
    try:
        connection.executescript(sql.decode('utf8'))
        assert connection.execute('PRAGMA quick_check').fetchall() == [('ok',)]
        assert connection.execute('PRAGMA foreign_key_check').fetchall() == []
        connection.row_factory = sqlite3.Row
        rows = [dict(row) for row in connection.execute(row_query)]
        receipts = [dict(row) for row in connection.execute(receipt_query)]
        notification_receipts = [dict(row) for row in connection.execute(notification_receipt_query)]
        tables = connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").fetchone()[0]
        manual = [row for row in rows if row['id'].startswith('synthetic-hosted-p04-')]
        assert len(manual) == 12
        assert all(row['amount_minor'] == 23456 and row['amount_exponent'] == (0 if row['currency'] == 'JPY' else 2) for row in manual)
        assert all(row['currency'] in {'CNY','USD','EUR','HKD','GBP','JPY'} and row['amount_exponent'] == (0 if row['currency'] == 'JPY' else 2) for row in rows)
        assert tables == 105 and len(rows) >= 19 and len(receipts) >= 25 and len(notification_receipts) >= 6
        assert live[0]['results'] == rows and live[1]['results'] == receipts
        assert live[2]['results'] == notification_receipts
        assert live[3]['results'] == [{'tables': 105}] and live[4]['results'] == []
    finally:
        connection.close()
    record.update(status='PASS', tables=tables, transactions=len(rows), finance_receipts=len(receipts), notification_receipts=len(notification_receipts), manual_original_rows=len(manual),
                  exact_remote_financial_projection_verified=True, foreign_key_violations=0,
                  sql_sha256=hashlib.sha256(sql).hexdigest(), sql_bytes=len(sql),
                  sqlite_sha256=hashlib.sha256(LOCAL.read_bytes()).hexdigest(), sqlite_bytes=LOCAL.stat().st_size,
                  backup_sql=SOURCE.relative_to(ROOT).as_posix(), restored_sqlite=LOCAL.relative_to(ROOT).as_posix(),
                  deployments=len(deployments), deployment_records=deployments,
                  cleanup_ownership=[dict(kind='pages_project',name='thewyj-finance-qa'),
                                     dict(kind='d1',name=primary['name'],id=PRIMARY),dict(kind='d1',name=recovery['name'],id=RECOVERY)])
except Exception as error:
    record.update(status='FAIL', error=str(error))
    raise
finally:
    record['finished_utc'] = datetime.now(timezone.utc).isoformat()
    (DEST / 'result.json').write_text(json.dumps(record, indent=2))
    print(json.dumps({k: v for k, v in record.items() if k != 'deployment_records'}))
