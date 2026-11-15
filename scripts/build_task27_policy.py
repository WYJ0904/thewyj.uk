"""Build public policy JS modules from reviewed versioned markdown archives."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent.parent
POLICIES_DIR = ROOT / 'docs' / 'task27' / 'policies'
ACTIVE_VERSION = '2026-11-16-v1'
VERSIONS = ('2026-11-14-v1', '2026-11-16-v1')
TITLES = {
    'terms': 'Aeris 使用条款',
    'privacy': 'Aeris 隐私政策',
    'security': 'Aeris 安全与隐私说明',
}


def load_archive() -> dict[str, dict[str, dict[str, str]]]:
    archive: dict[str, dict[str, dict[str, str]]] = {}
    for version in VERSIONS:
        entry: dict[str, dict[str, str]] = {}
        for key, title in TITLES.items():
            md_path = POLICIES_DIR / f'{key}-{version}.md'
            body = md_path.read_text(encoding='utf-8').strip()
            entry[key] = {'title': title, 'version': version, 'body': body}
        archive[version] = entry
    return archive


def main() -> None:
    archive = load_archive()
    history_file = ROOT / 'functions/_lib/task27-policy-archive.mjs'
    history_file.write_text(
        '// Immutable owner-reviewed policy history.\nexport const POLICY_ARCHIVE = Object.freeze('
        + json.dumps(archive, ensure_ascii=False, indent=2)
        + ');\n',
        encoding='utf-8',
    )
    target = ROOT / 'functions/_lib/task27-policy-content.mjs'
    target.write_text(
        '// Generated from owner-approved policy markdown; do not invent operational facts.\n'
        "import { POLICY_ARCHIVE } from './task27-policy-archive.mjs';\n"
        f"export const POLICY_CONTENT = POLICY_ARCHIVE['{ACTIVE_VERSION}'];\n",
        encoding='utf-8',
    )
    active = archive[ACTIVE_VERSION]
    (ROOT / 'js/account/policy-version.js').write_text(
        '// Generated public policy versions; server validation remains authoritative.\n'
        'export const POLICY_VERSIONS = Object.freeze('
        + json.dumps({key: value['version'] for key, value in active.items()})
        + ');\n',
        encoding='utf-8',
    )
    print(f'Generated policy archives ({", ".join(VERSIONS)}); active={ACTIVE_VERSION}.')


if __name__ == '__main__':
    main()
