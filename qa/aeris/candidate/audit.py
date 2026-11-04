"""Verify inherited repair history, imported WIP, and unchanged product sources."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/migration-evidence/hotfix-phase4'
MAIN = Path(os.environ['USERPROFILE']) / 'Desktop/编程/thewyj.uk'
REPAIR = Path(os.environ['USERPROFILE']) / '.codex/worktrees/aeris-state-consistency/thewyj.uk'


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def main():
    chain = ['e2febc6', '94f5177', '9ff7a7f', 'f6a2ec7', '57b622e', '8c0de9c', 'HEAD']
    history = [git('rev-parse', name).decode().strip() for name in chain]
    for a, b in zip(history, history[1:]):
        subprocess.run(['git', '-C', str(ROOT), 'merge-base', '--is-ancestor', a, b], check=True)
    imported = json.loads((REPAIR / 'docs/migration-evidence/accessibility-fix/imported-wip.json').read_text(encoding='utf-8-sig'))
    wip = [{'path': row['path'], 'same': hashlib.sha256((MAIN / row['path']).read_bytes()).hexdigest() == row['sha256'].lower()} for row in imported]
    assert all(row['same'] for row in wip), 'STOP: fixed checkout WIP drifted from the imported baseline'
    d01 = git('diff', '--name-only', 'f6a2ec7', '57b622e').decode().splitlines()
    assert all(n.startswith('qa/aeris/d01/') or n == 'docs/AERIS_D01_LIFECYCLE_RCA.md' for n in d01)
    d02 = git('diff', '--name-only', '57b622e', '8c0de9c').decode().splitlines()
    assert all(n.startswith('qa/aeris/d02/') or n in ['docs/AERIS_D02_WEBVIEW_THREAD_RCA.md', 'docs/ANDROID_HOTFIX_REMAINING_ACCEPTANCE_MATRIX.md'] for n in d02)
    names = git('ls-tree', '-r', '--name-only', '-z', 'f6a2ec7').decode('utf-8').strip('\0').split('\0')
    # Product, Gradle/manifest, schemas, shipped JS/backend/resources and lockfile.
    selected = [n for n in names if n.startswith(('android/', 'js/', 'functions/', 'cloudflare/', 'assets/', 'vendor/'))
                or n in ['index.html', 'sw.js', 'package.json', 'package-lock.json', 'wrangler.jsonc']]
    source = {}; working = {}
    paths = ['android','js','functions','cloudflare','assets','vendor','index.html','sw.js','package.json','package-lock.json','wrangler.jsonc']
    assert not git('diff', '--name-only', 'f6a2ec7', 'HEAD', '--', *paths), 'STOP: product Git tree divergence'
    entries = git('ls-tree','-r','-z','f6a2ec7').decode('utf-8').strip('\0').split('\0')
    objects = {entry.split('\t',1)[1]:entry.split('\t',1)[0].split()[2] for entry in entries}
    # Let Git apply its actual text/binary attributes and clean filters. Some
    # inherited text files are GBK, so a UTF-8-only CRLF heuristic is insufficient.
    cleaned = subprocess.check_output(['git','-C',str(ROOT),'hash-object','--stdin-paths'],
        input=('\n'.join(selected)+'\n').encode('utf-8')).decode().splitlines()
    assert len(cleaned) == len(selected)
    with tarfile.open(fileobj=io.BytesIO(git('archive','--format=tar','f6a2ec7'))) as archive:
        for name, object_id in zip(selected, cleaned):
            old = archive.extractfile(name).read()
            current = (ROOT / name).read_bytes()
            assert object_id == objects[name], 'STOP: dirty product source: ' + name
            source[name] = hashlib.sha256(old).hexdigest()
            working[name] = hashlib.sha256(current).hexdigest()
    encoded = json.dumps(source, sort_keys=True, separators=(',', ':')).encode('utf-8')
    result = {'history': history, 'importedWip': wip, 'd01ProductChanges': 0, 'd02ProductChanges': 0,
              'candidateProductChangesFromF6': 0, 'productFiles': len(source),
              'productManifestSha256': hashlib.sha256(encoded).hexdigest(), 'productFilesSha256': source,
              'workingProductFilesSha256': working}
    (OUT / 'source-consistency.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    for a, b, label in [('e2febc6','94f5177','imported-wip'),('94f5177','f6a2ec7','product-repair'),('f6a2ec7','HEAD','qa-and-docs')]:
        (OUT / (label + '.diff')).write_bytes(git('diff', '--binary', a, b))
    print(json.dumps({k:v for k,v in result.items() if k not in ['productFilesSha256','workingProductFilesSha256','importedWip']}))


if __name__ == '__main__':
    main()
