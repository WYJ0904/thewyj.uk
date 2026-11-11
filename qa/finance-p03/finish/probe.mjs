import https from 'node:https';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out='docs/migration-evidence/finance-p03/finish';
const ca=await fs.readFile(out+'/generated-res/raw/p03_device_ca.pem');
function call(path,method='GET',body,token){return new Promise((resolve,reject)=>{
 const request=https.request({hostname:'localhost',port:19443,path,method,ca,headers:{'User-Agent':'thewyj-android/1.3.37 Android/36','Content-Type':'application/json',...(token?{'X-Session-Token':token}:{})}},response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString()),cookie:response.headers['set-cookie']||[]})}catch(e){reject(e)}})});request.on('error',reject);if(body)request.write(JSON.stringify(body));request.end();
})}
const boot=await call('/__qa/bootstrap');assert.equal(boot.status,200);assert.equal(boot.body.synthetic_only,true);
const login=await call('/api/app/login','POST',{username:boot.body.username,secret:boot.body.secret,device_id:crypto.randomUUID(),app_version:'1.3.37'});
assert.equal(login.status,200,'local actual Task20 login');
const token=login.body.access_token;assert.ok(token);
const checks={login:login.status};
for(const [name,path]of [['status','/api/status'],['web_me','/api/me'],['session','/api/app/session'],['finance','/api/finance/transactions'],['features','/api/features'],['pending','/api/notification/pending-summary']]){
 const result=await call(path,'GET',undefined,token);checks[name]=result.status;assert.equal(result.status,200,name+': '+result.body.code);
}
const result={scope:'PC local HTTPS/API readiness, NOT a phone pass',synthetic_only:true,tls_validation:'pinned local CA; no bypass',checks,credentials_logged:false};
const health=await call('/api/health','POST',{},token);assert.equal(health.status,200,'actual web bootstrap health');result.checks.web_health=health.status;
const name=process.argv[2]||'server-probe';assert.match(name,/^[a-z0-9-]+$/);const file=out+'/'+name+'.json';await fs.writeFile(file,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
