"""Count current cloud evidence by identity; imported results are history only."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import json
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
HISTORY = ROOT / 'docs/migration-evidence/finance-p03'
BASE = HISTORY / 'nonphone-entry/cloud-20261021'
def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def nd(path):
    return [dict(json.loads(line), evidence=str(path.relative_to(ROOT)))
            for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]

def counts(rows):
    return dict(Counter(row['status'] for row in rows))

def junit(folder):
    rows = {}
    for path in folder.glob('TEST-*.xml'):
        for case in ET.parse(path).getroot().findall('testcase'):
            key = (case.get('classname'), case.get('name'))
            assert key not in rows
            rows[key] = {'class': key[0], 'method': key[1],
                         'status': 'FAIL' if case.find('failure') is not None or case.find('error') is not None else 'SKIP' if case.find('skipped') is not None else 'PASS',
                         'evidence': str(path.relative_to(ROOT)),
                         'error': '\n'.join(child.text or '' for child in case if child.tag in {'failure', 'error'})}
    return rows

full = junit(BASE / 'standard-full-junit')
assert len(full) == 681 and counts(full.values()) == {'PASS': 681}
initial = junit(HISTORY / 'reviewed-final-junit')
original = {key for key in initial if '.FinanceP03' not in key[0]}
legacy = set(initial) - original
closeout = set(junit(HISTORY / 'closeout/completion-full-junit')) - set(initial)
previous = set(junit(HISTORY / 'phase-a/closure-full-junit')) - original - legacy - closeout
new = set(full) - original - legacy - closeout - previous
assert [len(keys) for keys in [original, legacy, closeout, previous, new]] == [588, 26, 18, 31, 18]
assert counts(full[key] for key in original) == {'PASS': 588}
groups = [[dict(full[key], case_id=prefix + key[1]) for key in sorted(keys)]
          for keys, prefix in [(legacy, 'P03-JVM-'), (closeout, 'CO-JVM-'), (previous, 'A-JVM-'), (new, 'FINAL-JVM-')]]
groups[0] += nd(BASE / 'p03-server/server.ndjson') + nd(BASE / 'p03-legacy/legacy-raw.ndjson')
groups[0] += [dict(row, evidence=str((BASE / 'p03-migration/migration.json').relative_to(ROOT))) for row in read(BASE / 'p03-migration/migration.json')]
groups[1] += nd(BASE / 'closeout-server/clearing.ndjson') + nd(BASE / 'closeout-d1/migration.ndjson')
groups[2] += nd(BASE / 'device-reconciliation/reconciliation.ndjson') + nd(BASE / 'device-correction-migration/migration.ndjson')
for name in ['device-resolution/resolution.ndjson', 'device-controls/controls.ndjson', 'device-providers/providers.ndjson',
             'device-d1-migration/migration.ndjson', 'device-projections/projections.ndjson', 'device-local-sandbox/sandbox.ndjson']:
    groups[3] += nd(BASE / name)
groups[3].append(dict(read(BASE / 'native-persist/result.json'), evidence=str((BASE / 'native-persist/result.json').relative_to(ROOT))))
bridges = {}
for index, name, prefix in [(0, 'legacy-bridge', 'P03-BRIDGE-'), (1, 'clearing-bridge', 'CO-BRIDGE-'),
                            (2, 'correction-bridge', 'A-BRIDGE-'), (3, 'unified-bridge', 'FINAL-BRIDGE-')]:
    detail = read(BASE / name / 'server-final.json')
    assert detail['status'] == 'PASS'
    seed, restore = read(BASE / name / 'seed.json'), read(BASE / name / 'restore.json')
    assert seed['pid'] != restore['pid']
    for step in ['seed', 'restore']:
        rows = junit(BASE / f'{name}-{step}-junit')
        assert len(rows) == 1 and counts(rows.values()) == {'PASS': 1}
        groups[index].append(dict(next(iter(rows.values())), case_id=prefix + step.upper()))
    bridges[name] = detail
for expected, rows in zip([63, 41, 99, 79], groups):
    assert len(rows) == expected and counts(rows) == {'PASS': expected}, (expected, len(rows), counts(rows))

matrix = []
for group in 'ABCDE':
    matrix += nd(BASE / 'frozen-native' / f'kotlin-{group}.ndjson')
for name in ['web-pure.ndjson', 'web-dom.ndjson', 'ledger-d1.ndjson', 'ai-contract.ndjson']:
    matrix += nd(BASE / 'p02-web' / name)
for name in ['process-G-PROCESS-SEED.ndjson', 'process-G-PROCESS-RESTORE.ndjson']:
    matrix += nd(BASE / 'frozen-process' / name)
matrix += nd(BASE / 'frozen-native/negative-bookings.ndjson')
matrix.append(dict(read(BASE / 'frozen-native/timing.json'), evidence=str((BASE / 'frozen-native/timing.json').relative_to(ROOT))))
old_matrix = {row['case_id']: row for row in read(HISTORY / 'finish/delivery-final/frozen-608.json')}
for row in old_matrix.values():
    if row['case_id'].startswith('G-REUSED-'):
        fixture = row['fixture']; actual = full[(fixture['class'], fixture['method'])]
        matrix.append(dict(row, status=actual['status'], evidence=actual['evidence']))
    elif row['case_id'].startswith('NT-'):
        matrix.append(dict(row, status='NOT_TESTED', evidence='Not exercised in this cloud run'))
assert len(matrix) == 608 and {row['case_id'] for row in matrix} == set(old_matrix)
changes = []
for row in matrix:
    old = old_matrix[row['case_id']]
    assert row.get('fixture') == old.get('fixture'), row['case_id']
    if row['status'] != old['status']:
        changes.append(dict(case_id=row['case_id'], before=old['status'], after=row['status']))
assert not changes, changes
tap = (BASE / 'aeris-node.log').read_text()
dom = read(BASE / 'aeris-dom.log')
assert re.search(r'# tests 13\b', tap) and re.search(r'# fail 0\b', tap)
assert dom['tests'] == dom['pass'] == 6 and dom['fail'] == 0
trace = junit(BASE / 'trace-five-corrected-junit')
assert len(trace) == 5 and counts(trace.values()) == {'PASS': 5}
extra = list(trace.values())
for folder, name, expected in [('legacy-projection-release', 'legacy-controls.ndjson', 15),
                                ('legacy-browser-release', 'legacy-browser.ndjson', 10),
                                ('provider-identity-final', 'provider-identity.ndjson', 8)]:
    rows = nd(BASE / folder / name)
    assert len(rows) == expected and counts(rows) == {'PASS': expected}
    extra += rows
assert len(extra) == 38
lint = dict(Counter(issue.get('severity') for issue in ET.parse(BASE / 'standard-full-lint.xml').getroot().findall('issue')))
assert not lint.get('Error') and not lint.get('Fatal')
summary = dict(utc=datetime.now(timezone.utc).isoformat(), standard681=counts(full.values()),
               original607=dict(PASS=607, FAIL=0, SKIP=0, parts=dict(JVM=588, Node=13, DOM=6)),
               overlapping_p03_sets={str(size): counts(rows) for size, rows in zip([63, 41, 99, 79], groups)},
               new38=counts(extra), frozen608=counts(matrix), frozen_status_changes=changes,
               lint=lint, bridges=bridges, phone='NOT TESTED; prohibited', production='NOT TESTED; no access',
               windows_protection='UNAVAILABLE in this cloud machine; historical observations not promoted',
               p03_status='PARTIAL', nonphone_engineering='COMPLETE_FOR_AVAILABLE_EVIDENCE')
destination = BASE / 'delivery-final'
destination.mkdir(exist_ok=False)
for name, data in [('summary.json', summary), ('frozen-608.json', matrix), ('new-38.json', extra),
                   ('jvm-681.json', list(full.values())), ('failure-ledger.json', [row for row in matrix if row['status'] != 'PASS'])]:
    (destination / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
for size, rows in zip([63, 41, 99, 79], groups):
    (destination / f'suite-{size}.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(summary, ensure_ascii=False))
