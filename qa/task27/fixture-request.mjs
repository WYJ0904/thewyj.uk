import assert from 'node:assert/strict';
import {POLICY_VERSIONS} from '../../functions/_lib/task27-policy.mjs';

const support=new Map();
const scopes=new Map([
 ['/api/admin/roles','admin_roles'],['/api/admin/ban','admin_account'],['/api/admin/logout-user','admin_account'],['/api/admin/delete-user','admin_account'],
 ['/api/admin/membership/manage','admin_entitlements'],['/api/admin/membership','admin_entitlements'],['/api/admin/entitlement','admin_entitlements'],['/api/admin/recharge/process','admin_entitlements'],
 ['/api/admin/feature-flags','admin_features'],['/api/admin/feature-flags/override','admin_features'],['/api/account/delete','account_delete'],
]);
// Explicit test-only authorization. This helper can never target Hosted or Production,
// and cannot bypass an enabled second factor on a fixture account.
export async function fixtureRequestInit(base,route,body=null,token='',adminPassword=process.env.WYJ_TEST_ADMIN_SECRET) {
 assert.equal(new URL(base).hostname,'127.0.0.1','Task27 fixture mutations must stay on loopback');
 const headers={'Content-Type':'application/json',...(token?{'X-Session-Token':token}:{})};
 if(route==='/api/register'&&body!==null)body={...body,terms_accepted:true,policy_versions:POLICY_VERSIONS};
 const scope=body!==null?scopes.get(route):null;
 if(scope&&token){
  if(!support.has(base)){const capability=await fetch(base+'/api/policies');if(capability.status===404)support.set(base,false);else{assert.equal(capability.status,200,'fixture capability request must succeed');support.set(base,(await capability.json()).security_center_ready===true);}}
  if(support.get(base)){
   const password=scope==='account_delete'?body.secret:adminPassword;assert.ok(password,'synthetic fixture password required for real step-up');
   for(let attempt=0;attempt<2;attempt++){
    const response=await fetch(base+'/api/security/stepup',{method:'POST',headers,body:JSON.stringify({password,scope})});
    if(response.status===429&&attempt===0){const seconds=Number(response.headers.get('Retry-After'));assert.ok(Number.isInteger(seconds)&&seconds>0&&seconds<=60,'bounded explicit step-up Retry-After required');await new Promise(resolve=>setTimeout(resolve,seconds*1000));continue;}
    const result=await response.json();assert.equal(response.status,200,'synthetic fixture step-up must succeed');assert.ok(result.grant,'MFA-protected fixtures need an explicit second-factor test; no bypass is allowed');headers['X-Aeris-Stepup']=result.grant;break;
   }
  }
 }
 return {method:body===null?'GET':'POST',headers,...(body===null?{}:{body:JSON.stringify(body)}),cache:'no-store'};
}
