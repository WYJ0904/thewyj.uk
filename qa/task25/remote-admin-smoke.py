"""Harmless hosted flag acceptance. Requires an existing administrator session.

Only a newly registered synthetic account and a unique, unconsumed test flag
are mutated. No finance, notifications, files or existing users are changed.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--environment', required=True, choices=['development', 'preview', 'production'])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    origin = args.origin.rstrip('/')
    url = urlsplit(origin)
    allowed = ((args.environment == 'production' and origin == 'https://thewyj.uk') or
        (args.environment == 'preview' and url.scheme == 'https' and url.hostname and
         url.hostname.endswith('.thewyj-uk.pages.dev') and not url.path and not url.query and not url.fragment and
         not url.username and not url.password and url.netloc == url.hostname) or
        (args.environment == 'development' and origin == 'http://127.0.0.1:8894'))
    if not allowed:
        parser.error('Origin does not match the explicitly selected existing environment')
    admin = os.environ.get('WYJ_TASK25_ADMIN_SESSION', '')
    if not admin or '\n' in admin or '\r' in admin:
        parser.error('Existing WYJ_TASK25_ADMIN_SESSION required; no synthetic records created')
    stable = json.loads((Path(__file__).resolve().parents[2] / 'android/release-metadata.json').read_text())
    checks, flag, token = [], None, None
    failure = None
    cleanup_ok = True
    with tempfile.TemporaryDirectory(prefix='task25-admin-') as directory:
        headers = Path(directory) / 'headers'
        headers.touch(mode=0o600)

        def request(route, payload=None, session=None, expect=200):
            lines = [f'Origin: {origin}', 'Content-Type: application/json']
            if session: lines.append(f'X-Session-Token: {session}')
            headers.write_text('\n'.join(lines) + '\n')
            command = ['curl', '--silent', '--show-error', '--max-time', '40', '--header', '@' + str(headers),
                       '--write-out', '\n%{http_code}', origin + route]
            if payload is not None: command += ['--request', 'POST', '--data-binary', '@-']
            result = subprocess.run(command, input=None if payload is None else json.dumps(payload),
                text=True, capture_output=True, check=True)
            body, code = result.stdout.rsplit('\n', 1)
            if int(code) != expect:
                raise RuntimeError(f'{route}: expected HTTP {expect}, observed {code}')
            return json.loads(body)

        def assert_stable():
            config = request('/api/app/config')['app']
            for field, value in [('application_id', stable['applicationId']), ('latest_version_name', stable['versionName']),
                ('latest_version_code', stable['versionCode']), ('apk_sha256', stable['apkSha256']),
                ('apk_size_bytes', stable['apkSizeBytes'])]:
                if config[field] != value: raise RuntimeError('Stable metadata changed; stop validation')

        def save(**patch):
            nonlocal flag
            payload = {k: flag[k] for k in ['flag_key', 'description', 'enabled', 'kill_switch', 'channels', 'rollout_percentage']}
            payload.update(expected_revision=flag['revision'], **patch)
            flag = request('/api/admin/feature-flags', payload, admin)['flag']

        def evaluate(channel):
            return request('/api/admin/feature-flags/evaluate', {'user_id': account, 'channel': channel}, admin)['snapshot']['flags'][key]

        try:
            status = request('/api/status')
            if status.get('environment') != args.environment or not status.get('features', {}).get('task25_feature_flags'):
                raise RuntimeError('Server has not proved requested environment and enabled service')
            assert_stable()
            request('/api/admin/feature-flags', session=admin)  # Prove authorization before fixture creation.
            username, secret = 't25release_' + secrets.token_hex(5), secrets.token_urlsafe(30)
            registered = request('/api/register', {'username': username, 'secret': secret, 'confirm_secret': secret}, expect=201)
            account = registered['account']['id']
            token = request('/api/login', {'username': username, 'secret': secret})['session']
            key = 'task25_release_' + secrets.token_hex(5)
            flag = request('/api/admin/feature-flags', {'flag_key': key, 'description': 'Unconsumed harmless release validation; synthetic account only.',
                'enabled': False, 'kill_switch': False, 'channels': ['stable', 'beta', 'experimental'],
                'rollout_percentage': 0, 'expected_revision': 0}, admin)['flag']
            assert all(evaluate(channel)['reason'] == 'global_off' for channel in ['stable', 'beta', 'experimental'])
            checks.append('global_OFF')
            save(enabled=True, rollout_percentage=100)
            assert all(evaluate(channel)['enabled'] for channel in ['stable', 'beta', 'experimental'])
            checks.append('global_ON')
            for channel in ['stable', 'beta', 'experimental']:
                save(channels=[channel])
                for observed in ['stable', 'beta', 'experimental']:
                    assert evaluate(observed)['enabled'] == (observed == channel)
            checks.append('three_explicit_channel_gates')
            save(channels=['stable', 'beta', 'experimental'], rollout_percentage=37.25)
            bucket = int.from_bytes(hashlib.sha256((key + '\0' + account).encode()).digest()[:4], 'big') * 10000 // 2**32
            for _ in range(2):
                observed = evaluate('stable')
                assert observed['bucket'] == bucket and observed['enabled'] == (bucket < 3725)
            checks.append('independent_deterministic_percentage')
            for enabled in [False, True, None]:
                result = request('/api/admin/feature-flags/override', {'flag_key': key, 'user_id': account,
                    'enabled': enabled, 'expected_revision': flag['revision']}, admin)
                flag['revision'] = result['override']['revision']
                assert evaluate('stable')['enabled'] == (enabled if enabled is not None else bucket < 3725)
            checks.append('targeted_ON_OFF_inherit')
            save(kill_switch=True)
            assert evaluate('stable')['reason'] == 'kill_switch'
            checks.append('kill_switch')
            for channel in ['beta', 'experimental', 'stable']:
                pref = request('/api/release-channel', session=token)
                changed = request('/api/release-channel', {'channel': channel, 'expected_revision': pref['revision']}, token)
                assert changed['snapshot']['channel'] == channel
                assert not changed['snapshot']['flags'][key]['enabled']
            checks.append('synthetic_channel_preference')
            request('/api/admin/feature-flags', session=token, expect=403)
            audit = request('/api/admin/feature-flags', session=admin)['audit']
            relevant = [entry for entry in audit if entry['flag_key'] == key]
            assert relevant and all(entry['actor_user_id'] and entry['request_id'] for entry in relevant)
            assert_stable()
            checks.append('ordinary_admin_denied_audit_and_Stable_preserved')
        except Exception as error:
            # Never include response bodies, credentials or exception arguments.
            failure = type(error).__name__
        finally:
            if flag:
                try:
                    current = request('/api/admin/feature-flags', session=admin)
                    flag = next(item for item in current['flags'] if item['flag_key'] == flag['flag_key'])
                    save(enabled=False, kill_switch=True, rollout_percentage=0)
                    assert not flag['enabled'] and flag['kill_switch'] and flag['rollout_percentage'] == 0
                except Exception:
                    cleanup_ok = False
            if token:
                try:
                    pref = request('/api/release-channel', session=token)
                    if pref['channel'] != 'stable':
                        request('/api/release-channel', {'channel': 'stable', 'expected_revision': pref['revision']}, token)
                    request('/api/logout', {}, token)
                except Exception:
                    cleanup_ok = False
    report = {'checked_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'origin': origin,
        'environment': args.environment, 'acceptance': 'PASS' if not failure and cleanup_ok else 'FAILED',
        'checks': checks, 'failure_class': failure, 'cleanup_pass': cleanup_ok,
        'test_flag': flag['flag_key'] if flag else None, 'final_flag_global_off': not flag['enabled'] if flag else None,
        'final_flag_kill_switch': flag['kill_switch'] if flag else None,
        'real_user_data_modified': False, 'stable_pointer_modified': False,
        'synthetic_account_id': locals().get('account'), 'admin_session_persisted': False}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    if failure or not cleanup_ok: raise SystemExit(1)


if __name__ == '__main__':
    main()
