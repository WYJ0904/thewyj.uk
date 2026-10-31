"""Additional native policy/race regressions; no product or frozen-test edits."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[2];E=ROOT/'docs/migration-evidence/finance-p06';OUT=E/'native-policy-before';OUT.mkdir(exist_ok=False);source=OUT/'source';(source/'kotlin').mkdir(parents=True)
original=ROOT/'android/app/src/test/java/uk/thewyj/app/finance/FinanceAiTest.kt';text=original.read_text()
(OUT/'FinanceAiTest-original.kt').write_bytes(original.read_bytes())
assert text.count('class FinanceAiTest {')==1 and text.count('.put("available",true)')==1
text=text.replace('class FinanceAiTest {','class FinanceAiPolicyProbeTest {').replace('var enabled=false;var revision=0L;','var available=true;var enabled=false;var revision=0L;').replace('.put("available",true)','.put("available",available)')
methods=r'''
    @Test fun onlineKillSwitchRefreshBlocksAlreadyCachedNativeAdvice(){
        val t=Transport(::response);val c=coordinator(t);c.capture(ticket(),page());c.setConsent(owner,true);c.flush(owner);assertNotNull(c.advice(owner,"rec-ai"))
        val calls=t.models;t.available=false;c.flush(owner);assertNull("Online policy must retire cached advice too",c.advice(owner,"rec-ai"));assertEquals(calls,t.models)
    }
    @Test fun revokingThenRegrantingDoesNotResurrectAnOldAdvice(){
        val t=Transport(::response);val c=coordinator(t);c.capture(ticket(),page());c.setConsent(owner,true);c.flush(owner);assertNotNull(c.advice(owner,"rec-ai"))
        c.setConsent(owner,false);assertNull(c.advice(owner,"rec-ai"));c.setConsent(owner,true);assertNull("A new consent revision cannot reuse revoked local advice",c.advice(owner,"rec-ai"));assertEquals(1,t.models)
    }
    @Test fun delayedRunningSnapshotCannotReplaceAFinalAdvice(){
        val ready=java.util.concurrent.CountDownLatch(1);val release=java.util.concurrent.CountDownLatch(1);val requests=java.util.concurrent.atomic.AtomicInteger()
        val t=Transport {p->if(requests.incrementAndGet()==1){ready.countDown();check(release.await(5,java.util.concurrent.TimeUnit.SECONDS));JSONObject().put("status","running").put("input_digest","a".repeat(64)).put("model_version","synthetic-1").put("requires_manual_confirmation",true)}else response(p)}
        val c=coordinator(t);c.capture(ticket(),page());c.setConsent(owner,true);val pool=java.util.concurrent.Executors.newFixedThreadPool(2)
        try{val slow=pool.submit<Boolean>{c.flush(owner)};assertTrue(ready.await(5,java.util.concurrent.TimeUnit.SECONDS));val fast=pool.submit<Boolean>{c.flush(owner)};assertTrue(fast.get(5,java.util.concurrent.TimeUnit.SECONDS));assertNotNull(c.advice(owner,"rec-ai"));release.countDown();assertTrue(slow.get(5,java.util.concurrent.TimeUnit.SECONDS));assertNotNull("A late running response cannot demote the final result",c.advice(owner,"rec-ai"));assertTrue(store.localBookings(owner).isEmpty())}finally{release.countDown();pool.shutdownNow()}
    }
'''
at=text.rfind('}');text=text[:at]+methods+text[at:];(source/'kotlin/FinanceAiPolicyProbeTest.kt').write_text(text)
shutil.copy2(ROOT/'qa/finance-p02/test.init.gradle',source/'test.init.gradle')
(OUT/'probe-methods.kt.txt').write_text(methods)
(OUT/'preparation.json').write_text(json.dumps({'original_sha256':hashlib.sha256(original.read_bytes()).hexdigest(),'changes':'QA class name, configurable availability in the test transport, and three new regressions only. No existing assertion modified.','new_methods_sha256':hashlib.sha256(methods.encode()).hexdigest()},indent=2))
print(source)
