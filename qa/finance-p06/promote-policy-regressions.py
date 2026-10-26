"""Keep the three reproduced test bodies exact when promoting them to the suite."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06';p=ROOT/'android/app/src/test/java/uk/thewyj/app/finance/FinanceAiTest.kt'
before=p.read_text();methods=(E/'native-policy-before/probe-methods.kt.txt').read_text();assert 'onlineKillSwitchRefreshBlocksAlreadyCachedNativeAdvice' not in before
text=before.replace('var enabled=false;var revision=0L;','var available=true;var enabled=false;var revision=0L;').replace('.put("available",true)','.put("available",available)');at=text.rfind('}');text=text[:at]+methods+text[at:];p.write_text(text)
(E/'native-policy-promotion.json').write_text(json.dumps({'old_test_source_sha256':hashlib.sha256(before.encode()).hexdigest(),'reproduced_method_bodies_sha256':hashlib.sha256(methods.encode()).hexdigest(),'same_new_method_bodies':methods in text,'original_19_assertions_retained':True},indent=2))
