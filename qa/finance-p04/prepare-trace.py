"""P04 migration replay adapter: only the final expected Room version advances."""
from pathlib import Path
import hashlib
import json
import re

ROOT=Path(__file__).resolve().parents[2]
output=ROOT/'docs/migration-evidence/finance-p04/cloud/trace-room15-source'
(output/'kotlin').mkdir(parents=True,exist_ok=True)
rows=[]
for source in (ROOT/'qa/finance-p03/finish/kotlin').glob('*.kt'):
    original=source.read_text()
    text=original.replace('assertEquals(14,','assertEquals(NotificationDatabase.SCHEMA_VERSION,')
    text=re.sub(r'(inspect\([^\n;)]*?,)14\)',r'\1NotificationDatabase.SCHEMA_VERSION)',text)
    text=text.replace('.put("new_schema",14)','.put("new_schema",NotificationDatabase.SCHEMA_VERSION)')
    text=text.replace('.put("retry_schema",14)','.put("retry_schema",NotificationDatabase.SCHEMA_VERSION)')
    (output/'kotlin'/source.name).write_text(text)
    rows.append(dict(source=str(source.relative_to(ROOT)),sha256=hashlib.sha256(original.encode()).hexdigest(),
                     adaptation='Final expected Room 14 -> current 15 only; original inputs, ID/money/outbox assertions retained.'))
(output/'adaptations.json').write_text(json.dumps(rows,indent=2)+'\n')
print(output)
