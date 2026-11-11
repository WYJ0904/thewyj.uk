"""Read-only inventory of this P04 closure's explicitly owned local residue.

This script never deletes, moves, terminates processes, invokes ADB/Git/Wrangler,
or examines normal browser profiles. Its only write is a new inventory report.
Candidate entries are a snapshot for independent owner review, not authorization.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile


ROOT = Path(os.path.abspath(Path(__file__).parents[3]))
OUT = ROOT / 'docs/migration-evidence/finance-p04/closure-current'
REG = OUT / 'final-current/regression'
TEMP = Path(os.path.abspath(tempfile.gettempdir()))
EXPLICIT_TEMP = {
    'finance-p04-chromium-CWWpBZ',
    'finance-p04-chromium-FvFynn',
    'finance-p04-chromium-I6xPhx',
}
CACHE_NAMES = {'intermediates', 'cache', 'caches', 'kspcaches'}
NOW = datetime.now(timezone.utc)
SCANNED_AT = NOW.isoformat()
REPARSE_ATTRIBUTE = getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)
ERRORS: list[dict] = []
ROOTS: list[dict] = []
SKIPPED: list[dict] = []


def utc(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def is_reparse(info):
    return bool(getattr(info, 'st_file_attributes', 0) & REPARSE_ATTRIBUTE) or stat.S_ISLNK(info.st_mode)


def absolute(path):
    return Path(os.path.abspath(path))


def validate(path, anchor, *, direct=False):
    """Lexical absolute containment plus lstat of every ancestor; never resolve links."""
    path, anchor = absolute(path), absolute(anchor)
    try:
        relative = path.relative_to(anchor)
    except ValueError:
        raise ValueError('outside_explicit_owned_anchor') from None
    if not relative.parts or (direct and len(relative.parts) != 1):
        raise ValueError('expected_owned_descendant')
    # Also reject a reparse point in an ancestor of the anchor itself.
    for component in list(reversed(anchor.parents)) + [anchor]:
        if is_reparse(component.lstat()):
            raise ValueError('reparse_ancestor')
    component = anchor
    for part in relative.parts:
        component /= part
        try:
            info = component.lstat()
        except FileNotFoundError:
            break
        if is_reparse(info):
            raise ValueError('reparse_target_or_ancestor')
    return path


def child_dirs(parent, name_pattern=None):
    """Only enumerate names/metadata, never traverse a reparse point."""
    try:
        parent = absolute(parent)
        for component in list(reversed(parent.parents)) + [parent]:
            if is_reparse(component.lstat()):
                SKIPPED.append(dict(path=str(parent), reason='reparse_parent_or_ancestor_not_followed'))
                return []
        with os.scandir(parent) as entries:
            result = []
            for entry in entries:
                if name_pattern and not re.fullmatch(name_pattern, entry.name):
                    continue
                info = entry.stat(follow_symlinks=False)
                if is_reparse(info):
                    SKIPPED.append(dict(path=entry.path, reason='reparse_not_followed'))
                elif stat.S_ISDIR(info.st_mode):
                    result.append(Path(entry.path))
            return sorted(result, key=lambda p: p.name.lower())
    except FileNotFoundError:
        return []
    except OSError as error:
        ERRORS.append(dict(path=str(parent), operation='enumerate_directories', error=type(error).__name__))
        return []


def add_root(path, kind, anchor, owner, ownership, **extra):
    try:
        path = validate(path, anchor)
        if not path.exists():
            return
        info = path.lstat()
        ROOTS.append(dict(path=str(path), kind=kind, anchor=str(absolute(anchor)),
                          process_match_owner=str(absolute(owner)), ownership=ownership,
                          created_utc=utc(getattr(info, 'st_birthtime', info.st_ctime)),
                          modified_utc=utc(info.st_mtime), **extra))
    except (OSError, ValueError) as error:
        SKIPPED.append(dict(path=str(path), reason=str(error) if isinstance(error, ValueError) else type(error).__name__))


def find_profile_dirs(parent):
    for child in child_dirs(parent):
        if re.fullmatch(r'owned-browser-[A-Za-z0-9_-]+', child.name):
            add_root(child, 'owned_regression_browser_profile', REG, child,
                     'qa/finance-p03/finish/legacy-browser.mjs creates mkdtemp(out/owned-browser-)')
        else:
            find_profile_dirs(child)


def discover():
    # Direct current-run device/navigator roots only; no source or other worktree.
    validate(OUT, ROOT)
    for owner in child_dirs(OUT):
        if re.fullmatch(r'device(?:-[a-z0-9-]+)?', owner.name):
            build = owner / 'build'
            module_roots = [build] + child_dirs(build)
        elif re.fullmatch(r'navigator(?:-[a-z0-9-]+)?', owner.name):
            build = owner / 'app/build'
            module_roots = [build]
        else:
            continue
        if not build.exists():
            continue
        for module in module_roots:
            for candidate in child_dirs(module):
                if candidate.name.lower() in CACHE_NAMES:
                    add_root(candidate, 'owned_build_intermediate_or_cache', build, owner,
                             'current closure device*/build or navigator*/app/build cache allowlist')

    # The only recursive name discovery is under this current regression tree.
    if REG.exists():
        validate(REG, OUT)
        find_profile_dirs(REG)

    # Explicit three profiles plus same-prefix profiles in this P04 time window.
    explicit_times = []
    for name in EXPLICIT_TEMP:
        path = TEMP / name
        try:
            validate(path, TEMP, direct=True)
            info = path.lstat()
            explicit_times.append(getattr(info, 'st_birthtime', info.st_ctime))
        except (FileNotFoundError, ValueError):
            pass
    p04_time = (ROOT / 'docs/migration-evidence/finance-p04').stat().st_ctime
    floor = min(explicit_times + [p04_time])
    for path in child_dirs(TEMP, r'finance-p04-chromium-[A-Za-z0-9]{6}'):
        info = path.lstat()
        born = getattr(info, 'st_birthtime', info.st_ctime)
        current_window = floor - 60 <= born <= NOW.timestamp() + 60 and info.st_mtime >= floor - 60
        explicit = path.name in EXPLICIT_TEMP
        if not (explicit or current_window):
            SKIPPED.append(dict(path=str(path), reason='matching_prefix_outside_current_p04_time_window'))
            continue
        add_root(path, 'owned_temp_browser_profile', TEMP, path,
                 'qa/finance-p04/browser.mjs mkdtemp(os.tmpdir()/finance-p04-chromium-)',
                 explicitly_named_by_owner=explicit, current_p04_time_window=current_window,
                 ownership_time_floor_utc=utc(floor),
                 ownership_review_required=not explicit)

    # No global CF-temp search: obtain exact paths from these run-owned results.
    for evidence in child_dirs(OUT):
        if not re.fullmatch(r'hosted-bindings(?:-[a-z0-9-]+)?', evidence.name):
            continue
        result_path = evidence / 'result.json'
        try:
            validate(result_path, OUT)
            data = json.loads(result_path.read_text(encoding='utf-8'))
            raw = data['owned_temp']
            if not isinstance(raw, str) or not Path(raw).is_absolute():
                raise ValueError('owned_temp_not_absolute')
            temporary = validate(Path(raw), TEMP, direct=True)
            if not re.fullmatch(r'finance-p04-cf-meta-[a-z0-9_]+', temporary.name):
                raise ValueError('owned_temp_name_not_allowed')
            if not temporary.exists():
                SKIPPED.append(dict(path=str(temporary), reason='recorded_owned_temp_absent', evidence=str(result_path)))
                continue
            configs = []
            for name in ('wrangler.jsonc', 'wrangler.toml'):
                source, saved = temporary / name, evidence / name
                if not source.exists():
                    continue
                validate(source, temporary)
                validate(saved, evidence)
                source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
                saved_hash = hashlib.sha256(saved.read_bytes()).hexdigest()
                configs.append(dict(name=name, copied_to=str(saved), source_sha256=source_hash,
                                    saved_sha256=saved_hash, identical=source_hash == saved_hash))
            verified = bool(configs) and all(item['identical'] for item in configs)
            if not verified:
                SKIPPED.append(dict(path=str(temporary), reason='configuration_copy_hash_not_verified', configs=configs))
                continue
            add_root(temporary, 'owned_cf_metadata_temp', TEMP, temporary,
                     'exact owned_temp from current hosted-bindings*/result.json; config copy hash identical',
                     evidence=str(result_path), verified_configuration_copies=configs)
        except (KeyError, OSError, ValueError) as error:
            SKIPPED.append(dict(path=str(result_path), reason=type(error).__name__))


def process_snapshot():
    """Match all command lines in memory; return only owned path, PID and name."""
    owners = sorted(set(item['process_match_owner'] for item in ROOTS))
    command = r'''
$ErrorActionPreference='Stop'
$owned = @([Console]::In.ReadToEnd() | ConvertFrom-Json)
$hits = @()
Get-CimInstance -ClassName Win32_Process | ForEach-Object {
  $line = [string]$_.CommandLine
  if ($line) {
    $normalized = $line.Replace('/', '\')
    foreach ($target in $owned) {
      if ($normalized.IndexOf([string]$target, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $hits += [pscustomobject]@{owned_path=[string]$target; pid=[int]$_.ProcessId; process_name=[string]$_.Name}
      }
    }
  }
}
ConvertTo-Json -InputObject @($hits) -Compress
'''
    try:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command],
                                input=json.dumps(owners), text=True, capture_output=True, timeout=45,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise RuntimeError('process_query_failed')
        return json.loads(result.stdout), True
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        ERRORS.append(dict(operation='owned_process_snapshot', error=type(error).__name__))
        return [], False


def protected_reason(path, info, root):
    relative = path.relative_to(root).parts
    lower_parts = [part.lower() for part in relative]
    name = path.name.lower()
    if name.endswith(('.apk', '.aab')):
        return 'APK_or_app_bundle_preserved'
    if any(part in {'private', 'backup', 'backups', 'schemas', 'schema', 'src', 'source', 'sources'}
           or part.startswith(('backup-', 'private-', 'generated-schemas')) for part in lower_parts):
        return 'source_schema_private_or_backup_preserved'
    if any(part in {'junit', 'test-results', 'reports'} or part.startswith('lint') for part in lower_parts):
        return 'JUnit_or_Lint_report_preserved'
    if name.startswith('test-') and name.endswith('.xml'):
        return 'JUnit_XML_preserved'
    if name.endswith(('.log', '.ndjson', '.jsonl')) or 'raw' in lower_parts:
        return 'raw_log_preserved'
    if name.endswith(('.kt', '.java', '.kts', '.py', '.mjs', '.js', '.ts', '.sql')):
        return 'source_file_preserved'
    if (name.endswith(('.db', '.sqlite', '.sqlite3', '.db-wal', '.db-shm', '.db-journal', '-wal', '-shm', '-journal'))
            or name in {'history', 'cookies', 'web data', 'login data', 'favicons', 'network action predictor',
                        'top sites', 'shortcuts', 'quota manager', 'trust tokens', 'reporting and nel',
                        'attribution reporting', 'sharedstorage', 'interestgroups'}):
        return 'SQLite_or_database_companion_preserved'
    # Chromium SQLite files often have no extension. Inspect only the signature
    # of files already proven inside the run-owned roots; never emit contents.
    if info.st_size >= 16:
        try:
            with path.open('rb') as stream:
                if stream.read(16) == b'SQLite format 3\0':
                    return 'SQLite_signature_preserved'
        except OSError:
            return 'unreadable_signature_preserved'
    return None


def scan(path, root, kind):
    node = dict(path=str(path), type='directory', files=0, bytes=0, directories=0,
                reparse=0, preserved_files=0, errors=0, children=[])
    try:
        info = path.lstat()
        node.update(created_utc=utc(getattr(info, 'st_birthtime', info.st_ctime)), modified_utc=utc(info.st_mtime))
        if is_reparse(info):
            node.update(type='reparse', reparse=1, reason='reparse_not_followed')
            return node
        if stat.S_ISREG(info.st_mode):
            reason = protected_reason(path, info, root)
            node.update(type='file', files=1, bytes=info.st_size, preserved_files=int(bool(reason)))
            if reason:
                node['reason'] = reason
            return node
        if not stat.S_ISDIR(info.st_mode):
            node.update(type='special', errors=1, reason='special_file_preserved')
            return node
        with os.scandir(path) as entries:
            children = sorted([Path(entry.path) for entry in entries], key=lambda p: p.name.lower())
        for child_path in children:
            child = scan(child_path, root, kind)
            node['children'].append(child)
            for key in ('files', 'bytes', 'reparse', 'preserved_files', 'errors'):
                node[key] += child[key]
            node['directories'] += child['directories'] + int(child['type'] == 'directory')
    except OSError as error:
        node['errors'] += 1
        node['reason'] = type(error).__name__
    return node


def partition(node, inherited, candidates, retained):
    plain = {key: value for key, value in node.items() if key != 'children'}
    plain.update(inherited)
    if node.get('reason') and node['type'] != 'directory':
        plain['retention_reason'] = node['reason']
        retained.append(plain)
    elif not any(node[key] for key in ('reparse', 'preserved_files', 'errors')):
        plain['eligible_at_snapshot'] = not inherited['active_own_process'] and inherited['process_snapshot_succeeded']
        plain['retention_reason'] = ('active_own_process' if inherited['active_own_process'] else
                                     'process_status_unvalidated' if not inherited['process_snapshot_succeeded'] else None)
        plain['candidate_reason'] = 'owned_rebuildable_residue_with_no_protected_files'
        candidates.append(plain)
    else:
        if node['errors'] and not node['children']:
            plain['retention_reason'] = 'unreadable_or_unclassified_preserved'
            retained.append(plain)
        for child in node['children']:
            partition(child, inherited, candidates, retained)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='cleanup-inventory.json',
                        help='New JSON report filename below closure-current; existing files are never overwritten')
    args = parser.parse_args()
    if not re.fullmatch(r'cleanup-inventory(?:-[a-z0-9-]+)?\.json', args.output):
        parser.error('--output must be an allowlisted cleanup-inventory JSON filename')
    report_path = validate(OUT / args.output, OUT, direct=True)
    if report_path.exists():
        parser.error('report already exists; use a unique --output to preserve the earlier scan')
    discover()
    hits, process_ok = process_snapshot()
    candidates, retained, inventories = [], [], []
    for item in ROOTS:
        root_path = Path(item['path'])
        tree = scan(root_path, root_path, item['kind'])
        own_hits = [hit for hit in hits if hit['owned_path'] == item['process_match_owner']]
        inherited = dict(kind=item['kind'], inventory_root=item['path'],
                         active_own_process=bool(own_hits), owned_processes=own_hits,
                         ownership_review_required=item.get('ownership_review_required', False),
                         process_snapshot_succeeded=process_ok)
        partition(tree, inherited, candidates, retained)
        summary = {key: value for key, value in tree.items() if key != 'children'}
        summary.update(item)
        summary.update(inherited)
        summary['whole_root_eligible'] = (not any(tree[key] for key in ('reparse', 'preserved_files', 'errors'))
                                          and process_ok and not own_hits)
        summary['retention_reason'] = ('active_own_process' if own_hits else
                                       'process_status_unvalidated' if not process_ok else
                                       'protected_files_or_reparse_or_scan_errors_present'
                                       if not summary['whole_root_eligible'] else None)
        inventories.append(summary)
    eligible = [item for item in candidates if item['eligible_at_snapshot']]
    report = dict(schema_version=1, mode='READ_ONLY_INVENTORY_NO_DELETION', scanned_at_utc=SCANNED_AT,
                  root=str(ROOT), out=str(OUT), temp_root=str(TEMP),
                  deletion_authorized_by_this_report=False,
                  deletion_requires_fresh_containment_reparse_process_and_manifest_validation=True,
                  byte_measurement='logical bytes; no claim about physically reclaimable space or hardlink allocation',
                  scope=['closure-current/device*/build intermediates and named caches',
                         'closure-current/navigator*/app/build intermediates and named caches',
                         'closure-current/final-current/regression/**/owned-browser-*',
                         'exact named and current-time-window finance-p04-chromium-* Temp profiles',
                         'exact owned_temp from closure-current/hosted-bindings*/result.json after config hash match'],
                  exclusions=['normal Chrome profiles', 'global caches', 'other worktrees', 'phone',
                              'source trees', 'historical evidence', 'all APK/AAB, raw logs, JUnit/Lint, source/schema, SQLite/private/backup files'],
                  process_query=dict(succeeded=process_ok, matched_owned_processes=hits,
                                     unrelated_process_information_emitted=False),
                  roots=inventories, candidates=candidates, retained=retained, skipped=SKIPPED, errors=ERRORS,
                  summary=dict(inventory_roots=len(inventories), files=sum(item['files'] for item in inventories),
                               bytes=sum(item['bytes'] for item in inventories),
                               reparse=sum(item['reparse'] for item in inventories),
                               protected_files=sum(item['preserved_files'] for item in inventories),
                               disjoint_candidate_entries=len(candidates),
                               eligible_candidate_entries=len(eligible),
                               eligible_candidate_files=sum(item['files'] for item in eligible),
                               eligible_candidate_bytes=sum(item['bytes'] for item in eligible),
                               active_owned_roots=sum(item['active_own_process'] for item in inventories),
                               retained_reasons=dict(Counter(item['retention_reason'] for item in retained))))
    # OUT already exists; do not create any target or touch any inventoried path.
    validate(report_path, OUT, direct=True)
    with report_path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps(dict(report=str(report_path), mode=report['mode'], summary=report['summary'],
                          errors=len(ERRORS), skipped=len(SKIPPED)), ensure_ascii=False))


if __name__ == '__main__':
    main()
