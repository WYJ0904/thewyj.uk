"""Read-only hosted APK probe: no credentials, records, uploads or pointer writes.

Browser/native/WebView here mean HTTP user agents, not physical device or UI
acceptance. R2 fault injection is separately covered by download-validation.mjs.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--environment', required=True, choices=['preview', 'production'])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    origin = args.origin.rstrip('/')
    url = urlsplit(origin)
    if (url.scheme != 'https' or url.username or url.password or url.path or url.query or url.fragment or
        not ((args.environment == 'preview' and url.hostname and url.hostname.endswith('.thewyj-uk.pages.dev')) or
             (args.environment == 'production' and origin == 'https://thewyj.uk'))):
        parser.error('Use only the existing Pages Preview or Production origin')
    observations = []
    with tempfile.TemporaryDirectory(prefix='task25-download-') as directory:
        root = Path(directory)

        def request(route, label, method='GET', agent='Mozilla/5.0 Chrome/147.0.0.0', extra=()):
            body, header = root / (label + '.body'), root / (label + '.headers')
            command = ['curl', '--silent', '--show-error', '--max-time', '55', '--max-filesize', str(64 * 1024 * 1024),
                '--user-agent', agent, '--dump-header', str(header), '--output', str(body), '--write-out', '%{http_code}']
            if method == 'HEAD': command.append('--head')
            for item in extra: command.extend(['--header', item])
            completed = subprocess.run(command + [origin + route], capture_output=True, text=True)
            headers = {}
            if header.exists():
                for line in header.read_text().splitlines():
                    if ':' in line:
                        key, value = line.split(':', 1)
                        if key.lower() in ['content-type', 'content-length', 'cache-control', 'etag', 'cf-cache-status', 'x-apk-sha256', 'allow']:
                            headers[key.lower()] = value.strip()
            item = {'label': label, 'method': method, 'http_status': int(completed.stdout or 0),
                'transport_exit': completed.returncode, 'headers': headers}
            if method == 'GET' and body.exists():
                item['size_bytes'] = body.stat().st_size
                if item['http_status'] == 200: item['sha256'] = hashlib.sha256(body.read_bytes()).hexdigest()
                elif item['size_bytes'] < 8192:
                    try: item['error_code'] = json.loads(body.read_text()).get('code')
                    except (ValueError, UnicodeDecodeError): pass
            observations.append(item)
            return item, body

        status, status_body = request('/api/status', 'status')
        if status['http_status'] != 200 or json.loads(status_body.read_text()).get('environment') != args.environment:
            raise SystemExit('Requested existing environment not established; no write performed')
        config, config_body = request('/api/app/config', 'config')
        if config['http_status'] != 200: raise SystemExit('APK metadata unavailable; no write performed')
        metadata = json.loads(config_body.read_text())['app']
        head, _ = request('/api/app/download', 'download-head', method='HEAD')
        expected = {'size': metadata['apk_size_bytes'], 'hash': metadata['apk_sha256']}
        all_ok = (head['transport_exit'] == 0 and head['http_status'] == 200 and
            head['headers'].get('content-length') == str(expected['size']) and
            head['headers'].get('content-type') == 'application/vnd.android.package-archive' and
            head['headers'].get('x-apk-sha256') == expected['hash'] and
            head['headers'].get('cache-control') == 'private, no-store')
        etag = None
        modes = [('browser', 'Mozilla/5.0 Chrome/147.0.0.0'), ('native', 'Thewyj-Android/1.3.34 Android/36'),
                 ('webview', 'Mozilla/5.0 Android/16; wv Thewyj-Android/1.3.34')]
        for label, agent in modes:
            result, _ = request('/api/app/download', label, agent=agent)
            ok = (result['transport_exit'] == 0 and result['http_status'] == 200 and
                result.get('size_bytes') == expected['size'] and result.get('sha256') == expected['hash'] and
                result['headers'].get('content-type') == 'application/vnd.android.package-archive' and
                result['headers'].get('content-length') == str(expected['size']) and
                result['headers'].get('x-apk-sha256') == expected['hash'] and
                result['headers'].get('cache-control') == 'private, no-store')
            result['byte_integrity_pass'] = ok
            all_ok = all_ok and ok
            if label == 'browser' and ok: etag = result['headers'].get('etag')
        # Do not repeatedly fetch a broken endpoint or pretend it exercised a
        # cache. Only validate cache behavior after a complete valid download.
        if etag:
            for label, extra in [('cache-miss', ['Cache-Control: no-cache']), ('stale-validator', ['If-None-Match: "task25-stale-object"'])]:
                result, _ = request('/api/app/download', label, extra=extra)
                ok = (result['http_status'] == 200 and result.get('sha256') == expected['hash'] and
                    result.get('size_bytes') == expected['size'] and result['headers'].get('cache-control') == 'private, no-store')
                result['byte_integrity_pass'] = ok
                all_ok = all_ok and ok
    report = {'checked_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'origin': origin,
        'environment': args.environment, 'acceptance': 'PASS' if all_ok else 'BLOCKED', 'observations': observations,
        'version_name': metadata['latest_version_name'], 'version_code': metadata['latest_version_code'],
        'apk_sha256': expected['hash'], 'apk_size_bytes': expected['size'],
        'r2_object_inventory_verified': False, 'physical_device_acceptance': 'NOT_EXECUTED',
        'records_modified': False, 'stable_pointer_modified': False}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    if not all_ok: raise SystemExit(1)


if __name__ == '__main__':
    main()
