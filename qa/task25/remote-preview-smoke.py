"""Exercise the existing hosted Preview using only a new synthetic account.

Never targets Production and never stores credentials in the evidence report.
"""
import argparse
import datetime
import json
from pathlib import Path
import secrets
import subprocess
import tempfile
import uuid
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--origin', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
origin = args.origin.rstrip('/')
url = urlparse(origin)
if url.scheme != 'https' or not url.hostname or not url.hostname.endswith('.thewyj-uk.pages.dev') or url.path or url.query or url.fragment or url.username or url.password or url.netloc != url.hostname:
    parser.error('Only an existing thewyj-uk Pages Preview origin is allowed')

with tempfile.TemporaryDirectory(prefix='task25-preview-') as directory:
    headers_path = Path(directory) / 'headers.txt'
    headers_path.touch(mode=0o600)

    def request(route, payload=None, token=None, cookie=None):
        headers = [f'Origin: {origin}', 'Content-Type: application/json']
        if route.startswith('/api/app/'):
            headers.append('User-Agent: Thewyj-Android/1.3.34')
        if token:
            headers.append(f'X-Session-Token: {token}')
        if cookie:
            headers.append(f'Cookie: __Host-wyj_app_access={cookie}')
        headers_path.write_text('\n'.join(headers) + '\n')
        command = ['curl', '--silent', '--show-error', '--max-time', '40', '--header', '@' + str(headers_path),
                   '--write-out', '\n%{http_code}', origin + route]
        if payload is not None:
            command.extend(['--request', 'POST', '--data-binary', '@-'])
        completed = subprocess.run(command, input=None if payload is None else json.dumps(payload), text=True, capture_output=True, check=True)
        body, code = completed.stdout.rsplit('\n', 1)
        return int(code), json.loads(body)

    status_code, status = request('/api/status')
    if status_code != 200 or status.get('environment') != 'preview':
        raise SystemExit('Remote server has not proved Preview isolation; no records created')
    assert status['bindings']['d1'] and status['bindings']['r2']
    config_code, config = request('/api/app/config')
    stable = json.loads((Path(__file__).resolve().parents[2] / 'android/release-metadata.json').read_text())
    assert config_code == 200 and config['app']['latest_version_code'] == stable['versionCode']
    assert config['app']['apk_sha256'] == stable['apkSha256']
    anonymous_code, _ = request('/api/features')
    assert anonymous_code == 401, 'Anonymous users must not receive account-scoped decisions'
    username, secret = 't25cloud_' + secrets.token_hex(5), secrets.token_urlsafe(30)
    token = native_token = account_id = None
    failure = None
    cleanup_pass = False
    report = {'origin': origin, 'environment': 'preview', 'real_user_data_modified': False}
    try:
        registration_code, registration = request('/api/register', {'username': username, 'secret': secret, 'confirm_secret': secret})
        assert registration_code == 201, 'Synthetic Preview registration failed'
        account_id = registration['account']['id']
        login_code, login = request('/api/login', {'username': username, 'secret': secret})
        assert login_code == 200, 'Synthetic Preview login failed'
        token = login['session']
        feature_code, features = request('/api/features', token=token)
        admin_code, _ = request('/api/admin/feature-flags', token=token)
        assert admin_code == 403, 'Synthetic ordinary user must not administer flags'
        device_id = str(uuid.uuid4())
        native_code, native = request('/api/app/login', {'username': username, 'secret': secret,
                                                       'device_id': device_id, 'app_version': '1.3.34'})
        assert native_code == 200, 'Synthetic native login failed'
        native_token = native['access_token']
        native_feature_code, native_features = request('/api/features', token=native['access_token'])
        cookie_code, cookie_features = request('/api/features', cookie=native['access_token'])
        channel_checks = []
        if feature_code == 200:
            assert native_feature_code == cookie_code == 200
            assert features['snapshot']['account_id'] == native_features['snapshot']['account_id'] == account_id
            assert cookie_features['snapshot']['account_id'] == account_id
            assert features['snapshot']['flags'] == native_features['snapshot']['flags'] == cookie_features['snapshot']['flags']
            assert features['snapshot']['channel'] == 'stable'
            for channel in ('beta', 'experimental', 'stable'):
                code, result = request('/api/release-channel', {'channel': channel,
                    'expected_revision': features['snapshot']['channel_revision']}, token=token)
                assert code == 200 and result['snapshot']['channel'] == channel
                features = result
                channel_checks.append(channel)
            acceptance = 'USER_CHANNEL_AND_IDENTITY_PASS; ADMIN_ROLLOUT_NOT_EXECUTED'
        else:
            assert feature_code == native_feature_code == cookie_code == 503
            assert features.get('code') == native_features.get('code') == cookie_features.get('code')
            acceptance = 'BLOCKED_' + str(features.get('code', 'unknown')).upper()
        report = {'checked_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'origin': origin,
            'deployment': 'PASS_EXISTING_CLOUDFLARE_GIT_INTEGRATION', 'environment': status['environment'],
            'd1_binding': True, 'r2_binding': True, 'service_master_enabled': status['features'].get('task25_feature_flags'),
            'synthetic_username': username, 'synthetic_account_id': account_id, 'real_user_data_modified': False,
            'registration_http': registration_code, 'browser_login_http': login_code, 'native_login_http': native_code,
            'anonymous_features_http': anonymous_code, 'ordinary_user_admin_http': admin_code,
            'browser_features_http': feature_code, 'native_features_http': native_feature_code, 'webview_cookie_features_http': cookie_code,
            'features_error_code': features.get('code'), 'channel_checks': channel_checks, 'task25_remote_acceptance': acceptance,
            'stable_version_code': config['app']['latest_version_code'], 'stable_apk_sha256': config['app']['apk_sha256']}
    except Exception as error:
        failure = type(error).__name__  # Never persist credentials or raw response bodies.
    finally:
        try:
            if account_id:
                if not token:
                    code, restored = request('/api/login', {'username': username, 'secret': secret})
                    assert code == 200
                    token = restored['session']
                code, current = request('/api/release-channel', token=token)
                assert code == 200
                if current['channel'] != 'stable':
                    code, _ = request('/api/release-channel', {'channel': 'stable',
                        'expected_revision': current['revision']}, token=token)
                    assert code == 200
                if native_token:
                    code, _ = request('/api/app/session/logout', {'device_id': device_id}, token=native_token)
                    assert code == 200
                code, identity = request('/api/me', token=token)
                assert code == 200 and identity['account']['id'] == account_id and not identity['account']['is_admin']
                code, deleted = request('/api/account/delete', {'secret': secret}, token=token)
                assert code == 200 and deleted['account_deleted']
                code, denied = request('/api/me', token=token)
                assert code == 403 and denied['code'] == 'account_deleted'
            cleanup_pass = True
        except Exception:
            cleanup_pass = False
    report.update(checked_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        synthetic_account_id=account_id, synthetic_account_soft_deleted=bool(account_id and cleanup_pass),
        cleanup_pass=cleanup_pass, failure_class=failure,
        probe_execution='PASS' if not failure and cleanup_pass else 'FAILED')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    if failure or not cleanup_pass:
        raise SystemExit(1)
