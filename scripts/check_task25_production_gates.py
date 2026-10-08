"""Read-only Production entry guard; never migrates, deploys or publishes.

Receipt labels require reviewed real evidence. Independently checks signed
artifact bytes, current source/worktree, Draft PR and actual GitHub CI status.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.prepare_task25_android_release import PRODUCTION_ENTRY_GATES, validate_acceptance
from scripts.stage_android_candidate import ROOT, artifact, verify_artifacts


def github(route):
    result = subprocess.run(['gh', 'api', 'repos/WYJ0904/thewyj.uk/' + route],
        capture_output=True, text=True, check=True, timeout=45)
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['candidate-metadata', 'acceptance', 'apk', 'aab']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    try:
        candidate = json.loads(args.candidate_metadata.read_text())
        receipt = json.loads(args.acceptance.read_text())
        validate_acceptance(receipt, candidate, PRODUCTION_ENTRY_GATES)
        for field in ['apk', 'aab']:
            actual = artifact(getattr(args, field))
            if any(actual[key] != candidate[field][key] for key in ['sha256', 'sizeBytes']):
                raise ValueError('Artifact differs from pinned candidate metadata')
        verify_artifacts(args.apk, args.aab, candidate['versionName'], candidate['versionCode'], 'verified')
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True,
            text=True, check=True).stdout.strip()
        dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True,
            text=True, check=True).stdout.strip()
        if dirty or head != candidate['source_commit']:
            raise ValueError('Production requires a clean checkout of the exact signed candidate source')
        pr = github('pulls/96')
        if (not pr['draft'] or pr['merged'] or pr['state'] != 'open' or
            pr['head']['sha'] != head or pr['mergeable'] is not True or pr['mergeable_state'] != 'clean'):
            raise ValueError('PR #96 must remain Draft/unmerged at the pinned source and clean-mergeable')
        if receipt.get('base_main_commit') != pr['base']['sha']:
            raise ValueError('Main drifted since release acceptance; reconcile first')
        run_id = receipt['ci']['run_id']
        if not isinstance(run_id, int) or isinstance(run_id, bool):
            raise ValueError('CI run ID missing')
        run = github(f'actions/runs/{run_id}')
        jobs = github(f'actions/runs/{run_id}/jobs?per_page=100')
        if (run['head_sha'] != head or run['status'] != 'completed' or run['conclusion'] != 'success' or
            jobs['total_count'] != 8 or len(jobs['jobs']) != 8 or
            any(job['status'] != 'completed' or job['conclusion'] != 'success' for job in jobs['jobs'])):
            raise ValueError('Pinned candidate needs all eight actual current-head CI jobs successful')
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        parser.error(str(error))
    print(json.dumps({'production_entry': 'PASS', 'source_commit': head, 'base_main_commit': pr['base']['sha'],
        'ci_run': run_id, 'pr': 96, 'pr_draft': True, 'worktree_clean': True,
        'migration_deployment_publish_executed': False}, indent=2))


if __name__ == '__main__':
    main()
