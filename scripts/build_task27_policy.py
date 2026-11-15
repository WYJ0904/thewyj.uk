"""Extract only the owner's three policy bodies; implementation rules stay in docs."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    args = parser.parse_args()
    raw = Path(args.source).read_bytes()
    text = raw.decode('utf-8-sig').replace('\r\n', '\n')
    names = [('terms', 'Aeris 使用条款'), ('privacy', 'Aeris 隐私政策'), ('security', 'Aeris 安全与隐私说明')]
    policies = {}
    for key, title in names:
        start = text.index('# ' + title + '\n')
        end = text.index('\n======================================================================', start)
        policies[key] = {'title': title, 'version': '2026-11-14-v1', 'body': text[start:end].strip()}
    history_file = ROOT / 'functions/_lib/task27-policy-archive.mjs'
    history = {}
    if history_file.exists():
        match = re.search(r'Object.freeze\(([\s\S]*)\);', history_file.read_text(encoding='utf-8'))
        if not match:
            raise ValueError('Policy archive format is invalid')
        history = json.loads(match[1])
    version = '2026-11-14-v1'
    if version in history and history[version] != policies:
        raise ValueError('An archived policy version is immutable; use a new reviewed version')
    history[version] = policies
    history_file.write_text('// Immutable owner-reviewed policy history.\nexport const POLICY_ARCHIVE = Object.freeze('
                            + json.dumps(history, ensure_ascii=False, indent=2) + ');\n', encoding='utf-8')
    target = ROOT / 'functions/_lib/task27-policy-content.mjs'
    target.write_text('// Generated from owner-approved policy TXT; do not invent operational facts.\n'
                      "import { POLICY_ARCHIVE } from './task27-policy-archive.mjs';\n"
                      "export const POLICY_CONTENT = POLICY_ARCHIVE['2026-11-14-v1'];\n", encoding='utf-8')
    (ROOT / 'js/account/policy-version.js').write_text('// Generated public policy versions; server validation remains authoritative.\n'
        'export const POLICY_VERSIONS = Object.freeze(' + json.dumps({key: value['version'] for key, value in policies.items()}) + ');\n', encoding='utf-8')
    archive = ROOT / 'docs/task27/policies'
    archive.mkdir(parents=True, exist_ok=True)
    for key, policy in policies.items():
        (archive / f'{key}-2026-11-14-v1.md').write_text(policy['body'] + '\n', encoding='utf-8')
    (archive / 'SOURCE.md').write_text('# Confirmed policy source\n\nOwner-supplied TXT SHA-256: `' + hashlib.sha256(raw).hexdigest() + '`.\n'
        'Only the three policy bodies are public. The fourth implementation section is excluded.\n'
        'Version 1.0 remains a draft, with effective date and operational facts awaiting owner verification.\n', encoding='utf-8')
    print('Generated three exact policy bodies and version archives.')

if __name__ == '__main__':
    main()
