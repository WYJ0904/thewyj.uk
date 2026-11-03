"""Record one uniquely named local layout run; preserve its stdout and exit."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import re
import subprocess


ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product-root", type=Path, required=True)
    parser.add_argument("--label", required=True)
    options = parser.parse_args()
    assert re.fullmatch(r"[a-z][a-z0-9-]+", options.label)
    product = options.product_root.resolve()
    assert product != ROOT
    output = ROOT / "docs/migration-evidence/p0-finance-layout"
    output.mkdir(parents=True, exist_ok=True)
    assert not (output / options.label).exists(), "Preserve existing evidence"
    log = output / (options.label + ".log")
    record_path = output / (options.label + ".command.json")
    assert not log.exists() and not record_path.exists()
    node = Path(os.environ.get("FINANCE_NODE", str(Path.home() / "AppData/Local/npm-cache/_npx/d18f28baf1132559/node_modules/node/bin/node.exe")))
    assert node.is_file()
    driver = ROOT / "qa/p0-layout/browser.mjs"
    command = [str(node), str(driver), "--product-root", str(product), "--label", options.label]
    record = dict(argv=command, started_utc=datetime.now(timezone.utc).isoformat(),
                  driver_sha256_before=hashlib.sha256(driver.read_bytes()).hexdigest())
    with log.open("xb") as stream:
        result = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
    record.update(exit_code=result.returncode, finished_utc=datetime.now(timezone.utc).isoformat(),
                  driver_sha256_after=hashlib.sha256(driver.read_bytes()).hexdigest())
    record_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"label": options.label, "exit_code": result.returncode}))
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
