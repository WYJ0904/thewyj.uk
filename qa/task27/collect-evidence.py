"""Collect sanitized local acceptance metadata, never credentials or raw logs."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/task27/evidence'
BASE = '3f5ea474404df5e513df6198d0244c8a041ad2ff'

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode('utf-8').strip()

def text(relative):
    return (ROOT / relative).read_text(encoding='utf-8-sig', errors='replace')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def result_from_log(relative, prefix):
    records = []
    for line in text(relative).splitlines():
        try:
            row = json.loads(line)
            if row.get('status') and row.get('evidence'):
                records.append(row)
        except (ValueError, AttributeError):
            pass
    record = records[-1]
    assert record['status'] == 'PASS', relative
    directory = (ROOT / record['evidence']).resolve()
    assert directory.is_relative_to((ROOT / prefix).resolve())
    return directory, json.loads((directory / 'result.json').read_text(encoding='utf-8'))

def main():
    assert git('branch', '--show-current') == 'codex/task27-security-center'
    OUT.mkdir(parents=True, exist_ok=True)
    api_log = '.wrangler/task27-final-source-api.log'
    groups = int(re.search(r'Task27: (\d+) isolated D1/API groups passed', text(api_log))[1])
    assert groups >= 31
    browser_dir, browser = result_from_log('.wrangler/task27-browser-final.log', '.wrangler/task27-ui')
    _, runtime = result_from_log('.wrangler/task27-workerd-acceptance-current.log', '.wrangler/task27-workerd')
    _, upgrade = result_from_log('.wrangler/task27-upgrade-strength-acceptance-current.log', '.wrangler/task27-increment')
    oracle = json.loads(text('.wrangler/task27-oracle/result.json'))
    assert browser['status'] == runtime['status'] == upgrade['status'] == oracle['status'] == 'PASS'
    assert not browser['runtime_errors'] and not browser['api_errors']
    native = {'suites': 0, 'tests': 0, 'failures': 0, 'errors': 0, 'skipped': 0}
    for path in (ROOT / 'android/app/build/test-results/testDebugUnitTest').glob('TEST-*.xml'):
        suite = ET.parse(path).getroot()
        native['suites'] += 1
        for key in ('tests', 'failures', 'errors', 'skipped'):
            native[key] += int(suite.attrib.get(key, 0))
    assert native['tests'] >= 831 and not any(native[key] for key in ('failures', 'errors', 'skipped'))
    assert 'BUILD SUCCESSFUL' in text('.wrangler/task27-increment-android-first.log')
    screenshots = []
    image_dir = OUT / ('browser-' + browser_dir.name[:8])
    image_dir.mkdir(exist_ok=True)
    for name in ('password-policy-desktop.png', 'password-policy-mobile.png', 'security-desktop.png',
                 'security-mobile-dark.png', 'inbox-desktop.png', 'mail-desktop.png', 'policy-mobile.png'):
        source = browser_dir / name
        assert source.is_file()
        target = image_dir / name
        shutil.copyfile(source, target)
        screenshots.append({'path': target.relative_to(ROOT).as_posix(), 'sha256': digest(target)})
    reports = {'browser': browser, 'compiled_workerd': runtime, 'upgrade_and_strength': upgrade, 'otpauth_oracle': oracle}
    for name, value in reports.items():
        (OUT / f'{name}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    logs = [api_log, '.wrangler/task27-final-source-role.log', '.wrangler/task27-final-email.log',
            '.wrangler/task27-increment-task12.log', '.wrangler/task27-increment-task20.log',
            '.wrangler/task27-increment-task15.log', '.wrangler/task27-increment-android-first.log',
            '.wrangler/task27-stage-acceptance-current.log', '.wrangler/task27-s0-json-depth.log']
    old_failures = ['.wrangler/task27-android-first.log', '.wrangler/task27-browser-first.log',
                    '.wrangler/task27-browser-second.log', '.wrangler/task27-test-final.log',
                    '.wrangler/task27-task12-first.log', '.wrangler/task27-regressions/test_task18_d1_js.mjs.log',
                    '.wrangler/task27-oracle-first.log', '.wrangler/task27-oracle-second.log',
                    '.wrangler/task27-browser-acceptance-current.log']
    file_refs = lambda paths: [{'path': relative, 'sha256': digest(ROOT / relative)} for relative in paths if (ROOT / relative).is_file()]
    files = git('diff', '--name-only', BASE, 'HEAD').splitlines()
    protected = ['wrangler.jsonc', 'wrangler.local.jsonc', 'android/app/build.gradle.kts',
                 'android/app/src/main/AndroidManifest.xml', 'android/release-metadata.json']
    protected += [p.as_posix() for p in Path('cloudflare/migrations').glob('00*.sql') if 26 <= int(p.name[:4]) <= 34]
    assert not git('diff', '--name-only', BASE, 'HEAD', '--', *protected)
    public_files = [ROOT / 'index.html', *(ROOT / 'js').rglob('*.js'), *(ROOT / 'functions').rglob('*.mjs')]
    assert not any(re.search(r'wyj[0-9]+@gmail\.com', p.read_text(encoding='utf-8'), re.I) for p in public_files)
    summary = {'date': '2026-11-15', 'timezone': 'Asia/Hong_Kong', 'base': BASE,
        'prior_task27_checkpoint': '4167af98b38ae6c11c632e0b58b3902e62e57c3f', 'implementation_commit': git('rev-parse', 'HEAD'),
        'status': 'CODE_READY_LOCAL_RELEASE_HELD', 'api_groups_passed': groups, 'browser_checks_passed': len(browser['checks']),
        'workerd_checks_passed': len(runtime['checks']), 'upgrade_checks_passed': len(upgrade['checks']), 'android': native,
        'real_email_receipt': 'NOT_TESTED', 'real_authenticator_apps_and_device_webview': 'OWNER_NOT_TESTED',
        'remote_ci': 'NOT_RUN', 'hosted_preview': 'NOT_DEPLOYED', 'production': 'NOT_TOUCHED', 'task27_pr': None,
        'hydrogen_local_refs': {name: git('rev-parse', name) for name in ('hydrogen/s0-p0-integration', 'hydrogen/s0-security-audit')},
        'protected_source_paths_unchanged': protected, 'modified_files': files, 'screenshots': screenshots,
        'local_log_refs': file_refs(logs), 'preserved_earlier_failure_refs': file_refs(old_failures)}
    (OUT / 'acceptance-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: summary[key] for key in ('status', 'implementation_commit', 'api_groups_passed', 'browser_checks_passed', 'android')}))

if __name__ == '__main__':
    main()
