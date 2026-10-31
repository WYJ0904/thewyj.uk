"""Owned, local-only Aeris quality tooling. No default ADB or network models."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, subprocess

ROOT = Path(__file__).resolve().parents[2]
assert ROOT == Path.home()/'.codex/worktrees/aeris-finance-quality/thewyj.uk'
E = ROOT / 'docs/migration-evidence/aeris-finance-quality'
OLD = Path.home()/'.codex/worktrees/finance-release-convergence/thewyj.uk'
SDK = Path.home() / 'AppData/Local/Android/Sdk'
NODE = Path.home() / 'AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe'
PORT = '5057'
SERIAL = '127.0.0.1:5587'
PKG = 'uk.thewyj.app.qa.aerisfinancequality'

def utc():
    return datetime.now(timezone.utc).isoformat()

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

def environment():
    env = dict(os.environ, JAVA_HOME='C:/Program Files/Android/Android Studio/jbr',
               ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK),
               ANDROID_ADB_SERVER_PORT=PORT, ADB_SERVER_PORT=PORT,
               ADB_SERVER_SOCKET='tcp:127.0.0.1:' + PORT,
               ADB_MDNS_AUTO_CONNECT='0', ANDROID_SERIAL=SERIAL,
               WRANGLER_SEND_METRICS='false', FINANCE_NODE=str(NODE))
    env['PATH'] = str(NODE.parent) + os.pathsep + env['PATH']
    for key in list(env):
        if any(s in key.upper() for s in ['SIGNING','KEYSTORE','STORE_PASSWORD','KEY_PASSWORD','KEY_ALIAS']) or key.upper().startswith(('CLOUDFLARE_', 'CF_API_', 'CF_ACCOUNT_', 'OPENAI_', 'ANTHROPIC_', 'GEMINI_')):
            env.pop(key)
    return env

def adb(*args, timeout=20):
    # Every operation explicitly addresses one task-owned emulator transport.
    cmd = [str(SDK/'platform-tools/adb.exe'), '-P', PORT, '-s', SERIAL, *args]
    p = subprocess.run(cmd, capture_output=True, timeout=timeout, env=environment())
    if p.returncode:
        raise RuntimeError((p.stdout+p.stderr).decode(errors='replace')[:1000])
    return p.stdout

def emulator_guard():
    assert adb('shell','getprop','ro.kernel.qemu').strip() == b'1'
    assert adb('shell','getprop','ro.build.version.sdk').strip() == b'36'

def git(*args, root=ROOT):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
