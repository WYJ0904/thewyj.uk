import {assert,api,base,fixtures,page,session,snapshot,pointer,recorder,otherTab,flag,delay} from './harness.mjs';
const {admin,A,B}=await fixtures();await flag(admin,{}, {id:B.account.id,enabled:false});
const p=await page(),r=recorder(p,'policy-results.json');
async function loginA(){const v=await api('/api/login',{username:A.username,secret:A.secret});assert.equal(v.status,200);A.session=v.data.session;await p.intercept([]);await session(p,A.session);await p.waitFor("document.documentElement.dataset.interfacePolicy==='enabled'&&document.getElementById('accountModal').checkVisibility()",15000);}
function bounded(promise,label){return Promise.race([promise,delay(5000).then(()=>{throw Error('bounded request not observed: '+label)})]);}
try{
  await r.check('account-switch-drops-previous-owner-presentation',async()=>{
    await loginA();const before=await snapshot(p),serverB=await api('/api/features',null,B.session);assert.equal(serverB.status,200);assert.equal(serverB.data.snapshot.flags.p07_accessibility.enabled,false);
    let release,seen;const gate=new Promise(v=>release=v),observed=new Promise(v=>seen=v);
    await p.intercept([{match:'/api/health',respond:async()=>{const q=await api('/api/health',{},B.session);assert.equal(q.status,200);seen();await gate;return{status:q.status,body:q.data};}}]);
    const peer=await otherTab(p);let pending,after;
    try{await peer.evaluate(`localStorage.setItem('wyjAccountSession',${JSON.stringify(B.session)});true`);await bounded(observed,'B health');pending=await snapshot(p);release();await p.waitFor("document.documentElement.dataset.interfacePolicy==='disabled'",15000,'real B OFF decision');after=await snapshot(p);}finally{release();await peer.close();await p.intercept([]);}
    const detail={before,pending,after,serverBOff:true};r.note('account-switch-drops-previous-owner-presentation',detail);
    assert.notEqual(pending.p07,'enabled','unknown B inherited A visual authority');assert.equal(pending.accountVisible,false,'A private account page remained visible while B was unverified');assert.equal(after.p07,'disabled');return detail;
  });
  await r.check('logout-drops-account-authority-before-public-off-arrives',async()=>{
    await loginA();await flag(admin,{kill_switch:true});let release,seen;const gate=new Promise(v=>release=v),observed=new Promise(v=>seen=v);
    await p.intercept([{match:'/api/ui/features',respond:async()=>{const q=await api('/api/ui/features');assert.equal(q.data.public_ui.enabled,false);seen();await gate;return{status:q.status,body:q.data};}}]);let pending,after;
    try{await pointer(p,'#accountMenu > summary');await pointer(p,'#logoutBtn');await bounded(observed,'public OFF after logout');pending=await snapshot(p);release();await p.waitFor("document.documentElement.dataset.interfacePolicy==='disabled'",15000);after=await snapshot(p);}finally{release();await p.intercept([]);await flag(admin,{kill_switch:false});}
    const detail={pending,after,realPublicKill:true};r.note('logout-drops-account-authority-before-public-off-arrives',detail);assert.notEqual(pending.p07,'enabled','guest inherited prior account V3 authority');assert.equal(pending.accountVisible,false);assert.equal(after.p07,'disabled');return detail;
  });
  await r.check('expired-background-lease-does-not-stay-enabled',async()=>{
    await loginA();let hold=false,release;const gate=new Promise(v=>release=v);
    await p.intercept([{match:'/api/features',respond:async()=>{const q=await api('/api/features',null,A.session);if(hold)await gate;else{q.data.snapshot.max_age_seconds=1;q.data.snapshot.expires_at=new Date(Date.now()+1000).toISOString();}return{status:q.status,body:q.data};}}]);
    const watch=p.watchResponses('/api/features'),count=watch.count();await p.evaluate("document.dispatchEvent(new Event('visibilitychange'));true");const end=Date.now()+5000;while(watch.count()===count&&Date.now()<end)await delay(50);assert.ok(watch.count()>count);hold=true;
    const peer=await otherTab(p);let expired,restored;
    try{await p.client.send('Target.activateTarget',{targetId:peer.targetId});await p.waitFor("document.visibilityState==='hidden'&&document.documentElement.dataset.interfacePolicy==='pending'",7000,'real background TTL expiry');expired=await snapshot(p);await p.client.send('Target.activateTarget',{targetId:p.targetId});await p.send('Page.bringToFront');release();await p.waitFor("document.documentElement.dataset.interfacePolicy==='enabled'",15000);restored=await snapshot(p);}finally{release();await peer.close();await p.intercept([]);}
    const detail={expired,restored,ttlFixtureSeconds:1,realVisibility:true};r.note('expired-background-lease-does-not-stay-enabled',detail);assert.notEqual(expired.p07,'enabled','expired authority was retained');assert.equal(expired.functionalP07,false);return detail;
  });
  await r.check('public-foreground-revalidates-real-kill-with-valid-cache',async()=>{
    await p.intercept([]);await p.evaluate("localStorage.removeItem('wyjAccountSession');true");await p.navigate('/');await p.waitFor("document.documentElement.dataset.interfacePolicy==='enabled'",15000);
    const peer=await otherTab(p),watch=p.watchResponses('/api/ui/features');let before,after;
    try{await p.client.send('Target.activateTarget',{targetId:peer.targetId});await p.waitFor("document.visibilityState==='hidden'",5000);before=watch.count();await flag(admin,{kill_switch:true});await p.client.send('Target.activateTarget',{targetId:p.targetId});await p.send('Page.bringToFront');await p.waitFor("document.documentElement.dataset.interfacePolicy==='disabled'",5000,'foreground real Kill response');after=await snapshot(p);assert.ok(watch.count()>before,'foreground did not revalidate actual public policy');}finally{await flag(admin,{kill_switch:false});await peer.close();}
    return{after,actualResponseObserved:true,realVisibility:true};
  });
  await r.check('post-boot-policy-failure-keeps-visible-retry',async()=>{
    await p.intercept([]);await p.navigate('/');await p.waitFor("document.documentElement.dataset.interfacePolicy==='enabled'",15000);let fail=true;
    await p.intercept([{match:'/api/ui/features',respond:()=>fail?{status:503,body:{error:'isolated bounded transport failure'}}:{continue:true}}]);
    await p.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await p.waitFor("document.documentElement.dataset.interfacePolicy==='error'",5000);
    await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});const failed=await snapshot(p);r.note('post-boot-policy-failure-keeps-visible-retry',{failed});
    assert.equal(failed.p07,'disabled');assert.equal(failed.policyPanelVisible,true,'boot-ready failure hid its recovery feedback');assert.equal(failed.retryVisible,true);fail=false;await pointer(p,'#retryInterfacePolicyBtn');await p.waitFor("document.documentElement.dataset.interfacePolicy==='enabled'",15000);return{failed,recovered:await snapshot(p),fault:'local 503 fixture; no real AI'};
  });
}finally{await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}).catch(()=>{});await p.close();r.finish();}
