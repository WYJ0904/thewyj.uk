import https from 'node:https';
import fs from 'node:fs/promises';
const action=process.argv[2];if(!['state','shutdown'].includes(action))throw new Error('QA control action');
const ca=await fs.readFile('docs/migration-evidence/finance-p03/device/generated-res/raw/p03_device_ca.pem');
const data=await new Promise((resolve,reject)=>{const r=https.get({hostname:'localhost',port:19443,path:'/__qa/'+action,ca},s=>{let t='';s.on('data',c=>t+=c);s.on('end',()=>{if(s.statusCode!==200)return reject(new Error('QA HTTP '+s.statusCode));resolve(JSON.parse(t))})});r.on('error',reject)});
console.log(JSON.stringify(data));
