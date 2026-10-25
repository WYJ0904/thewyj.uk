"""Create the new-root Android driver without editing any sealed prior driver."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'qa/finance-p04/android.py';target=ROOT/'qa/finance-p06/android.py'
assert not target.exists()
text=source.read_text()
assert text.count('FINANCE_P04_OUTPUT')==1
assert text.count("ROOT/'docs/migration-evidence/finance-p04'")==3
text=text.replace('FINANCE_P04_OUTPUT','FINANCE_P06_OUTPUT').replace("ROOT/'docs/migration-evidence/finance-p04'","ROOT/'docs/migration-evidence/finance-p06'")
target.write_text(text)
out=ROOT/'docs/migration-evidence/finance-p06/android-runner-adaptation.json';assert not out.exists()
out.write_text(json.dumps(dict(source=str(source.relative_to(ROOT)),source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    derivative=str(target.relative_to(ROOT)),changes='P06 output variable and three allowed evidence-root guards only; same source lock, test selection and artifact archival',
    prior_errors=['P04 runner refused a P06 output before Gradle; no test result created','First inline generation had a shell quoting syntax error; no file created']),indent=2))
print(target)
