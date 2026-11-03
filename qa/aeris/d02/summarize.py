"""Summarize actual, per-attempt synthetic results without discarding failures."""
import collections
import hashlib
import json
from pathlib import Path
import statistics
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / 'docs/migration-evidence/d02'


def main():
    attempts = []
    for directory in sorted((EVIDENCE / 'runs').iterdir()):
        result_file = directory / 'result.json'
        if not result_file.exists():
            attempts.append({'label': directory.name, 'status': 'INCOMPLETE'})
            continue
        result = json.loads(result_file.read_text(encoding='utf-8-sig'))
        result['label'] = directory.name
        paths = list((directory / 'd02-evidence').rglob('rounds.ndjson'))
        if paths:
            # Initial collector retained older sessions too. Select only the new
            # latest session, not cumulative copies of previous failed attempts.
            path = max(paths, key=lambda p: p.parent.name)
            rows = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]
            completed = [r for r in rows if r['stage'] == 'round-complete']
            durations = []
            for row in completed:
                starts = [r for r in rows if r['stage'] == 'beforeIO' and r['round'] == row['round']]
                if starts:
                    durations.append(row['elapsedMs'] - starts[0]['elapsedMs'])
            result['minimal'] = {'session': path.parent.name, 'roundsCompleted': len(completed),
                'errors': sum(r['stage'] == 'ERROR' for r in rows),
                'mainWebCalls': sum(r['stage'].startswith('web:') and r['mainLooper'] for r in rows),
                'offMainWebCalls': sum(r['stage'].startswith('web:') and not r['mainLooper'] for r in rows),
                'postIoThreads': sorted(set(r['thread'] for r in rows if r['stage'].startswith('afterIO'))),
                'medianMs': statistics.median(durations) if durations else None,
                'maxMs': max(durations) if durations else None}
        publication_rows = [json.loads(line) for path in (directory / 'd01-evidence').rglob('events.ndjson')
                            for line in path.read_text(encoding='utf-8').splitlines()
                            if json.loads(line).get('kind') == 'd02-product-round']
        if publication_rows:
            result['productPublications'] = {'completed': len(publication_rows),
                'allFresh': all(r['publicationAfter'] > r['publicationBefore'] for r in publication_rows)}
        if result.get('mode') == 'original-full':
            rows = json.loads((directory / 'qa3-evidence/results.json').read_text(encoding='utf-8'))[-16:]
            assert [r['caseId'] for r in rows] == ['T%02d' % n for n in range(1, 17)]
            result['originalMatrix'] = {'cases': [{'id': r['caseId'], 'status': r['status'], 'elapsedMs': r['elapsedMs']} for r in rows],
                'allPassed': all(r['status'] == 'PASS' for r in rows),
                'T12': next(r['metrics'] for r in rows if r['caseId'] == 'T12')}
        attempts.append(result)
    apks = {p.relative_to(EVIDENCE).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (EVIDENCE / 'apks').rglob('*.apk')}
    lint = {}
    for path in EVIDENCE.glob('lint-*.xml'):
        lint[path.name] = dict(collections.Counter(i.get('severity') for i in ET.parse(path).getroot().findall('issue')))
    result = {'attempts': attempts, 'apks': apks, 'lint': lint,
              'original607': 'BASELINE_ONLY_NOT_RERUN_IN_D02', 'realWechat': 'NOT TESTED 0/10',
              'production': 'NOT TESTED', 'formalAppBusinessFlows': 'NOT TESTED'}
    (EVIDENCE / 'verification-summary.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
