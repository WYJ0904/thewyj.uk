"""Read-only Production entry guard; never migrates, deploys or publishes.

Receipt labels require reviewed real evidence. Independently checks signed
artifact bytes, source/worktree, PR state and actual GitHub CI status. The
explicit main-first mode requires the exact merged tree and successful main CI.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.prepare_task25_android_release import MAIN_FIRST_ENTRY_GATES, production_entry_gates, validate_acceptance
from scripts.stage_android_candidate import ROOT, artifact, verify_artifacts


def github(route):
    if shutil.which('gh'):
        result = subprocess.run(['gh', 'api', 'repos/WYJ0904/thewyj.uk/' + route],
            capture_output=True, text=True, check=True, timeout=45)
        return json.loads(result.stdout)
    # Reuse the existing authenticated Git HTTPS credential on local Windows.
    # GET only; credentials stay in memory and never enter logs or argv.
    result = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
        cwd=ROOT, env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'},
        capture_output=True, text=True, check=True, timeout=30)
    credential = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    request = urllib.request.Request('https://api.github.com/repos/WYJ0904/thewyj.uk/' + route,
        headers={'Authorization': 'Bearer ' + credential['password'], 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'thewyj-task25-readonly-release-guard'})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def validate_ci(run, jobs, source):
    if (run.get('head_sha') != source or run.get('status') != 'completed' or run.get('conclusion') != 'success' or
        jobs.get('total_count') != 8 or len(jobs.get('jobs', [])) != 8 or
        any(job.get('status') != 'completed' or job.get('conclusion') != 'success' for job in jobs['jobs'])):
        raise ValueError('Pinned source needs all eight actual GitHub CI jobs successful')


def validate_merged_source(pr, candidate_source, head, current_main, base_main, parents, head_tree, candidate_tree):
    if (pr.get('draft') is not False or pr.get('merged') is not True or pr.get('state') != 'closed' or
        pr.get('head', {}).get('sha') != candidate_source or pr.get('merge_commit_sha') != head or
        current_main != head or parents != [base_main, candidate_source] or not base_main or
        not head_tree or head_tree != candidate_tree):
        raise ValueError('Main-first entry needs merged #96, unchanged base main and the exact signed candidate tree')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['candidate-metadata', 'acceptance', 'apk', 'aab']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    try:
        candidate = json.loads(args.candidate_metadata.read_text())
        receipt = json.loads(args.acceptance.read_text())
        gates = production_entry_gates(receipt)
        validate_acceptance(receipt, candidate, gates)
        for field in ['apk', 'aab']:
            actual = artifact(getattr(args, field))
            if any(actual[key] != candidate[field][key] for key in ['sha256', 'sizeBytes']):
                raise ValueError('Artifact differs from pinned candidate metadata')
        verify_artifacts(args.apk, args.aab, candidate['versionName'], candidate['versionCode'], 'verified')
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True,
            text=True, check=True).stdout.strip()
        dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True,
            text=True, check=True).stdout.strip()
        if dirty:
            raise ValueError('Production requires a clean checkout')
        pr = github('pulls/96')
        main_first = tuple(gates) == MAIN_FIRST_ENTRY_GATES
        if main_first:
            if receipt.get('final_main_commit') != head:
                raise ValueError('Receipt must pin the final main deployment source')
            def git_value(*args):
                return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
            validate_merged_source(pr, candidate['source_commit'], head,
                github('git/ref/heads/main')['object']['sha'], receipt.get('base_main_commit'),
                git_value('show', '-s', '--format=%P', head).split(),
                git_value('rev-parse', head + '^{tree}'), git_value('rev-parse', candidate['source_commit'] + '^{tree}'))
        else:
            if head != candidate['source_commit']:
                raise ValueError('Production requires the exact signed candidate source')
            if (not pr['draft'] or pr['merged'] or pr['state'] != 'open' or
                pr['head']['sha'] != head or pr['mergeable'] is not True or pr['mergeable_state'] != 'clean'):
                raise ValueError('PR #96 must remain Draft/unmerged at the pinned source and clean-mergeable')
            if receipt.get('base_main_commit') != pr['base']['sha']:
                raise ValueError('Main drifted since release acceptance; reconcile first')
        for gate, source in [('ci', candidate['source_commit']), *([('main_ci', head)] if main_first else [])]:
            run_id = receipt[gate]['run_id']
            if not isinstance(run_id, int) or isinstance(run_id, bool):
                raise ValueError('CI run ID missing: ' + gate)
            validate_ci(github(f'actions/runs/{run_id}'), github(f'actions/runs/{run_id}/jobs?per_page=100'), source)
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        parser.error(str(error))
    print(json.dumps({'production_entry': 'PASS', 'source_commit': candidate['source_commit'],
        'deployment_source_commit': head, 'base_main_commit': receipt['base_main_commit'],
        'ci_run': receipt['ci']['run_id'], 'main_ci_run': receipt['main_ci']['run_id'] if main_first else None,
        'pr': 96, 'pr_draft': pr['draft'], 'worktree_clean': True, 'stable_promotion_authorized': False,
        'migration_deployment_publish_executed': False}, indent=2))


if __name__ == '__main__':
    main()
