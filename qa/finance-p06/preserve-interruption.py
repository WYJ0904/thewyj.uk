"""Preserve an interrupted build, never turn it into an executed test result."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/migration-evidence/finance-p06/device/p03-p05-r2'
assert not (OUT/'result.json').exists() and not (OUT/'interruption.json').exists()
assert 'BUILD SUCCESSFUL' in (OUT/'build.log').read_text(errors='replace')
SDK=Path.home()/'AppData/Local/Android/Sdk';apk=OUT/'app-debug.apk'
badging=subprocess.check_output([str(SDK/'build-tools/36.0.0/aapt2.exe'),'dump','badging',str(apk)],text=True)
assert "package: name='uk.thewyj.app.qa.financep06'" in badging
row=dict(recorded_utc=datetime.now(timezone.utc).isoformat(),status='INTERRUPTED_NOT_TESTED',
    reason='Parent exec disappeared after successful build, before an instrumentation log/result. No test outcome inferred.',
    original_build_log_preserved=True,source_before_manifest_unavailable=True,
    artifacts=[dict(path=str(apk.relative_to(ROOT)),package='uk.thewyj.app.qa.financep06',bytes=apk.stat().st_size,sha256=hashlib.sha256(apk.read_bytes()).hexdigest())])
(OUT/'interruption.json').write_text(json.dumps(row,indent=2));print(json.dumps(row))
