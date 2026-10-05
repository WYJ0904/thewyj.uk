import assert from 'node:assert/strict';
import {openPage} from '../../local-backend/browser_harness.mjs';
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9250',baseUrl:process.env.WYJ_TEST_BASE||'http://127.0.0.1:8938',width:390,height:900,mobile:true});
try {
 await p.send('Network.setBypassServiceWorker',{bypass:true});await p.send('Network.setCacheDisabled',{cacheDisabled:true});
 await p.navigate('/login');await p.waitFor('!document.getElementById("entryScreen")');await p.setFields({'#usernameInput':'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await p.click('#loginSubmitBtn');await p.waitFor("location.pathname==='/'");
 await p.navigate('/tools');await p.waitFor('window.WYJTools.isReady()');let attempts=0;
 await p.intercept([{match:'/workflows.js',respond:()=>++attempts===1?{status:503,body:'owned transient module error'}:null}]);
 const first=await p.evaluate("window.WYJTools.show('/tools/workflows',{}).then(()=>({ok:true})).catch(e=>({ok:false,message:e.message}))");console.log(JSON.stringify({first,attempts}));assert.equal(first.ok,false);
 await p.evaluate("window.WYJTools.show('/tools/workflows',{})");
 assert.equal(attempts,2);assert.equal(await p.evaluate('!!window.WYJWorkflows'),true);
 console.log(JSON.stringify({workflowTransportRetry:true,attempts,pageReloadRequired:false}));
}finally{await p.close();}
