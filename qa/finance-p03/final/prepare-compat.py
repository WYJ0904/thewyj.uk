"""Archive explicit schema-only test adaptations without editing frozen QA."""
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/migration-evidence/finance-p03/final'
DEST=OUT/'compat-p03'
assert not DEST.exists()
manifest=[]
for p in (ROOT/'qa/finance-p03/kotlin').glob('*.kt'):
    s=p.read_text(encoding='utf8')
    t=s.replace('NotificationDatabase.MIGRATION_12_13)', 'NotificationDatabase.MIGRATION_12_13, NotificationDatabase.MIGRATION_13_14)')
    target=DEST/'kotlin'/p.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(t,encoding='utf8')
    manifest.append({'original':str(p.relative_to(ROOT)),'before':hashlib.sha256(p.read_bytes()).hexdigest(),
                     'copy':str(target.relative_to(ROOT)),'after':hashlib.sha256(target.read_bytes()).hexdigest(),
                     'adaptation':'append Room13->14 registration only' if s!=t else 'identical copy'})
(DEST/'test.init.gradle').write_bytes((ROOT/'qa/finance-p03/test.init.gradle').read_bytes())
for p in (ROOT/'qa/finance-p03/final/kotlin').glob('*.kt'):
    (DEST/'kotlin'/p.name).write_bytes(p.read_bytes())
for name,original in [('legacy-migration','qa/finance-p03/migration.mjs'),
                      ('clearing-migration','qa/finance-p03/closeout/migration.mjs'),
                      ('correction-migration','qa/finance-p03/phase-a/migration.mjs')]:
    p=ROOT/original;s=p.read_text(encoding='utf8');t=s
    if name=='legacy-migration':
        t=t.replace("'../../functions/","'../../../functions/").replace("import.meta.dirname,'../..'","import.meta.dirname,'../../..'")
        marker='await db.batch(reconcile.map(s=>db.prepare(s)));'
        assert t.count(marker)==1
        t=t.replace(marker,marker+"\n  await db.batch((await fs.readFile(path.join(root,'cloudflare/migrations/0030_payment_supersession.sql'),'utf8')).replace(/\\/\\*[\\s\\S]*?\\*\\//g,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));")
        t=t.replace(".value,'5'", ".value,'6'").replace("metadata:'5'", "metadata:'6'")
    elif name=='clearing-migration':
        marker="await db.batch(sql(await fs.readFile(path.join(root,'cloudflare/migrations/0029_payment_reconciliation.sql'),'utf8')).map(s=>db.prepare(s)));"
        assert t.count(marker)==1
        t=t.replace(marker,marker+"await db.batch(sql(await fs.readFile(path.join(root,'cloudflare/migrations/0030_payment_supersession.sql'),'utf8')).map(s=>db.prepare(s)));")
        t=t.replace("metadata:'5'", "metadata:'6'")
    else:
        # Keep all original columns in equality assertions while checking the
        # two new default columns separately in the dedicated current migration test.
        t=t.replace("import {dumpD1,restoreD1,writeSqliteSnapshot} from './d1-snapshot.mjs'", "import {dumpD1,restoreD1,writeSqliteSnapshot} from '../phase-a/d1-snapshot.mjs'")
        marker="await db.batch(statements.map(s=>db.prepare(s)));assert.equal(await ensureTask21Schema(db),true);"
        assert t.count(marker)==1
        t=t.replace(marker,"await db.batch(statements.map(s=>db.prepare(s)));await db.batch((await fs.readFile(path.join(root,'cloudflare/migrations/0030_payment_supersession.sql'),'utf8')).replace(/\\/\\*[\\s\\S]*?\\*\\//g,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));assert.equal(await ensureTask21Schema(db),true);")
        # Legacy fixture was captured before ALTER; expected all old values plus
        # the two exact non-null defaults after the committed incremental migration.
        t=t.replace(".results,before)", ".results,before.map(r=>({...r,system_superseded_by:'',system_superseded_operation:''})))")
        # AM02 precedes the ALTER and must still compare the actual old schema.
        segment=t.index("await check('AM03")
        t=t[:segment].replace("before.map(r=>({...r,system_superseded_by:'',system_superseded_operation:''}))",'before')+t[segment:]
        t=t.replace("metadata:'5'", "metadata:'6'").replace("schema_version,'2'", "schema_version,'3'").replace("database_version:2","database_version:3")
    target=ROOT/'qa/finance-p03/final'/(name+'.mjs');assert not target.exists();target.write_text(t,encoding='utf8')
    manifest.append({'original':original,'copy':str(target.relative_to(ROOT)),
                     'before':hashlib.sha256(p.read_bytes()).hexdigest(),'after':hashlib.sha256(target.read_bytes()).hexdigest(),
                     'adaptation':'register 0030, expect DB6/3, preserve all original IDs, data, receipt and rollback assertions'})
(OUT/'compatibility-adaptations.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print(json.dumps({'copies':len(manifest),'destination':str(DEST)}))
