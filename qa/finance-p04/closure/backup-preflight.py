"""QA-only offline backup preflight against the actual sealed synthetic archive.

This does not implement a formal-app backup/restore API. It reads four files in
memory, checks identity/hash/schema compatibility, and never extracts the tar or
changes a database. Integrity/restore evidence comes from the separate Samsung
cold-restore test; a SQLite header check is not an integrity check.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/migration-evidence/finance-p04/closure-current'
COMPONENTS = {'notification.sqlite', 'currency.sqlite', 'outbox.queue', 'currency-context.xml'}
PREFIX = 'files/finance-p04-closure/cold-proof-final/'


def validate(manifest, files, expected_owner, target_room=16, target_fx=1):
    if manifest.get('account_id') != expected_owner:
        raise ValueError('owner_mismatch')
    if set(manifest.get('files', {})) != COMPONENTS or set(files) != COMPONENTS:
        raise ValueError('component_set_mismatch')
    if manifest.get('room_version') != 16 or manifest.get('fx_version') != 1:
        raise ValueError('unsupported_manifest_schema')
    if target_room != manifest['room_version'] or target_fx != manifest['fx_version']:
        raise ValueError('target_schema_incompatible')
    for name, content in files.items():
        if hashlib.sha256(content).hexdigest() != manifest['files'][name]:
            raise ValueError('file_hash_mismatch')
    for name, key in [('notification.sqlite', 'room_version'), ('currency.sqlite', 'fx_version')]:
        content = files[name]
        if len(content) < 100 or content[:16] != b'SQLite format 3\0':
            raise ValueError('sqlite_header_invalid')
        if int.from_bytes(content[60:64], 'big') != manifest[key]:
            raise ValueError('sqlite_schema_manifest_mismatch')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='backup-preflight-final-r1.json')
    args = parser.parse_args()
    if Path(args.output).name != args.output or not args.output.startswith('backup-preflight-') or not args.output.endswith('.json'):
        parser.error('output must be a new backup-preflight-*.json filename')
    result_path = OUT / args.output
    if result_path.exists():
        parser.error('output exists; preserve earlier evidence')
    archive = OUT / 'private/phone-final-cold.tar'
    archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    with tarfile.open(archive, 'r') as source:
        manifest = json.load(source.extractfile(PREFIX + 'backup-manifest.json'))
        files = {name: source.extractfile(PREFIX + 'sealed/' + name).read() for name in COMPONENTS}
    cases = []

    def run(name, expected, *, mutation=None, owner='synthetic-backup-owner', room=16, fx=1):
        changed_manifest, changed_files = copy.deepcopy(manifest), dict(files)
        if mutation:
            mutation(changed_manifest, changed_files)
        try:
            validate(changed_manifest, changed_files, owner, room, fx)
            actual = 'accepted'
        except ValueError as error:
            actual = str(error)
        cases.append(dict(name=name, expected=expected, actual=actual, status='PASS' if actual == expected else 'FAIL'))

    run('actual_sealed_four_components', 'accepted')
    run('manifest_room_17_rejected', 'unsupported_manifest_schema', mutation=lambda m, f: m.update(room_version=17))
    run('manifest_fx_2_rejected', 'unsupported_manifest_schema', mutation=lambda m, f: m.update(fx_version=2))
    run('old_target_room_15_rejected', 'target_schema_incompatible', room=15)
    run('old_target_fx_0_rejected', 'target_schema_incompatible', fx=0)
    run('missing_component_rejected', 'component_set_mismatch', mutation=lambda m, f: f.pop('outbox.queue'))
    run('changed_component_rejected', 'file_hash_mismatch', mutation=lambda m, f: f.update({'outbox.queue': f['outbox.queue'] + b' '}))
    run('other_owner_rejected', 'owner_mismatch', owner='synthetic-other-owner')

    def alter_header(m, f):
        data = bytearray(f['notification.sqlite'])
        data[60:64] = (15).to_bytes(4, 'big')
        f['notification.sqlite'] = bytes(data)
        m['files']['notification.sqlite'] = hashlib.sha256(data).hexdigest()

    run('header_manifest_schema_conflict_rejected_even_with_new_hash', 'sqlite_schema_manifest_mismatch', mutation=alter_header)
    report = dict(scope='QA-only in-memory preflight of actual synthetic sealed four-component archive; not a product backup manager',
                  archive_relative=str(archive.relative_to(ROOT)), archive_sha256=archive_hash,
                  archive_unchanged=hashlib.sha256(archive.read_bytes()).hexdigest() == archive_hash,
                  plaintext_financial_data_emitted=False, files_extracted=False, databases_modified=False,
                  limitations=['SQLite header/schema verification only; no new SQLite integrity execution in this utility',
                               'Formal personal backup and actual old formal-client restore NOT_TESTED',
                               'Expected_rejection is preflight safety, not successful downgrade support'],
                  tests=len(cases), passed=sum(c['status'] == 'PASS' for c in cases),
                  failed=sum(c['status'] == 'FAIL' for c in cases), cases=cases)
    with result_path.open('x', encoding='utf-8') as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps({key: report[key] for key in ('tests', 'passed', 'failed', 'archive_unchanged')}))
    raise SystemExit(0 if report['failed'] == 0 and report['archive_unchanged'] else 1)


if __name__ == '__main__':
    main()
