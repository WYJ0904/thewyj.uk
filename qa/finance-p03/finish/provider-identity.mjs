// Unit cryptography with an ephemeral TEST key only; never provider credentials
// or automatic reconciliation authority. Official field shape is cited in report.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readAlipayAuthorizationEvidence} from '../../../functions/_lib/task21-provider-evidence.mjs';
import {sha256Hex} from '../../../functions/_lib/cloudflare-foundation.mjs';
const out=process.env.FINANCE_P03_OUTPUT;assert.ok(out);await fs.mkdir(out,{recursive:true});const log=path.join(out,'provider-identity.ndjson');await fs.writeFile(log,'',{flag:'wx'});
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
const policy={accountId:'synthetic-finish-owner',merchantId:'synthetic-merchant',appId:'synthetic-app',payerId:'synthetic-payer',platformKey:keys.publicKey,expectedAuthNo:'synthetic-auth',expectedOperationId:'synthetic-operation',expectedRequestNo:'synthetic-request'};
const response={code:'10000',auth_no:policy.expectedAuthNo,operation_id:policy.expectedOperationId,out_request_no:policy.expectedRequestNo,payer_user_id:policy.payerId,amount:'123.45',status:'SUCCESS',operation_type:'FREEZE'};
const bytes=s=>new TextEncoder().encode(s);
async function read(body=response,p=policy){const raw=JSON.stringify(body),sig=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,bytes(raw))).toString('base64');return readAlipayAuthorizationEvidence(raw,sig,p)}
const open=()=>{const r={...response,payer_open_id:policy.payerId};delete r.payer_user_id;return r};
const tests=[
 ['PI01-TRUSTED-APP-SCOPED-OPEN-ID-IS-READABLE',async()=>{const r=await read(open(),{...policy,payerIdType:'open_id'});assert.equal(r.status,'verified_fact');assert.equal(r.payer_id_type,'open_id');assert.equal(r.operation_reference,response.operation_id);return r}],
 ['PI02-WRONG-SELECTED-OPEN-ID-CANNOT-BORROW-USER-ID',async()=>assert.equal((await read({...response,payer_open_id:'other-synthetic-payer'},{...policy,payerIdType:'open_id'})).status,'review')],
 ['PI03-DEFAULT-POLICY-DOES-NOT-GUESS-IDENTITY-KIND',async()=>assert.equal((await read(open())).status,'review')],
 ['PI04-UNKNOWN-TRUSTED-IDENTITY-KIND-FAILS-CLOSED',async()=>assert.equal((await read(response,{...policy,payerIdType:'unrecognized'})).status,'review')],
 ['PI05-IDENTICAL-STRINGS-IN-DIFFERENT-ID-NAMESPACES-ARE-SEPARATE',async()=>{const r={...response,payer_open_id:policy.payerId};const a=await read(r),b=await read(r,{...policy,payerIdType:'open_id'});assert.equal(a.status,'verified_fact');assert.equal(b.status,'verified_fact');assert.notEqual(a.provider_scope,b.provider_scope)}],
 ['PI06-APP-SCOPED-PAYER-DOES-NOT-GRANT-REVISION-OR-AUTHORITY',async()=>{const r=await read(open(),{...policy,payerIdType:'open_id'});assert.equal(r.status,'verified_fact');assert.equal(r.revision,null);assert.equal(r.predecessor_revision,null);assert.equal(r.can_authorize_correction,false)}],
 ['PI07-EXACT-SIGNED-BYTES-STILL-REQUIRED',async()=>{const raw=JSON.stringify(open()),sig=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,bytes(raw))).toString('base64');assert.equal((await readAlipayAuthorizationEvidence(raw+' ',sig,{...policy,payerIdType:'open_id'})).status,'review')}],
 ['PI08-LEGACY-USER-ID-SCOPE-REMAINS-BYTE-COMPATIBLE',async()=>{const r=await read();assert.equal(r.provider_scope,await sha256Hex(JSON.stringify(['alipay',policy.accountId,policy.merchantId,policy.appId,policy.payerId])))}],
];
for(const [case_id,fn] of tests){let actual,error;try{actual=await fn()}catch(e){error=e.stack;process.exitCode=1}await fs.appendFile(log,JSON.stringify({case_id,status:error?'FAIL':'PASS',actual,error:error||'',scope:'isolated SDK-shape unit test, ephemeral non-provider key, no business authentication claim'})+'\n');console.log(case_id,error?'FAIL':'PASS')}
