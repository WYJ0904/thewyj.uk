import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readWechatProviderEvidence,readAlipayAuthorizationEvidence} from '../../../functions/_lib/task21-provider-evidence.mjs';
const out=process.env.FINANCE_P03_OUTPUT;assert.ok(out);await fs.mkdir(out,{recursive:true});const log=path.join(out,'providers.ndjson');await fs.writeFile(log,'',{flag:'wx'});
const bytes=s=>new TextEncoder().encode(s),b64=b=>Buffer.from(b).toString('base64');
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
const aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const policy={accountId:'synthetic-owner',merchantId:'synthetic-merchant',appId:'synthetic-app',payerId:'synthetic-payer',nowSeconds:1792468800,platformKeys:new Map([['synthetic-serial',keys.publicKey]]),apiV3Key:aes};
const payment={mchid:policy.merchantId,appid:policy.appId,payer:{openid:policy.payerId},transaction_id:'synthetic-transaction-001',trade_state:'SUCCESS',amount:{total:10000,payer_total:8000,currency:'CNY',payer_currency:'CNY'}};
const refund={mchid:policy.merchantId,transaction_id:payment.transaction_id,refund_id:'synthetic-refund-001',refund_status:'SUCCESS',amount:{total:10000,refund:4000,payer_refund:3200}};
async function notification(source,event_type='TRANSACTION.SUCCESS'){
 const nonce='synthetic-iv',associated_data='transaction';
 const ciphertext=b64(await crypto.subtle.encrypt({name:'AES-GCM',iv:bytes(nonce),additionalData:bytes(associated_data),tagLength:128},aes,bytes(JSON.stringify(source))));
 const body=JSON.stringify({id:'synthetic-delivery-001',event_type,resource:{algorithm:'AEAD_AES_256_GCM',nonce,associated_data,ciphertext}});
 const headers=new Headers({'Wechatpay-Serial':'synthetic-serial','Wechatpay-Timestamp':String(policy.nowSeconds),'Wechatpay-Nonce':'synthetic-header-nonce'});
 const signed=`${policy.nowSeconds}\nsynthetic-header-nonce\n${body}\n`;
 headers.set('Wechatpay-Signature',b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,bytes(signed))));
 return {body,headers};
}
async function wx(source=payment,type='TRANSACTION.SUCCESS',p=policy){const n=await notification(source,type);return readWechatProviderEvidence(n.body,n.headers,p)}
const alipayPolicy={accountId:policy.accountId,merchantId:'synthetic-alipay-merchant',appId:'synthetic-alipay-app',payerId:'synthetic-alipay-payer',platformKey:keys.publicKey,expectedAuthNo:'synthetic-auth-001',expectedOperationId:'synthetic-operation-001',expectedRequestNo:'synthetic-request-001'};
const alipay={code:'10000',auth_no:alipayPolicy.expectedAuthNo,operation_id:alipayPolicy.expectedOperationId,out_request_no:alipayPolicy.expectedRequestNo,payer_user_id:alipayPolicy.payerId,amount:'123.45',status:'SUCCESS',operation_type:'SYNTHETIC-UNINTERPRETED-TYPE'};
async function ali(source=alipay,p=alipayPolicy){const s=JSON.stringify(source),sig=b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,bytes(s)));return readAlipayAuthorizationEvidence(s,sig,p)}
const tests=[
 ['PV01-SIGNED-WECHAT-PAYER-CASH-NOT-GROSS',async()=>{const r=await wx();assert.equal(r.status,'verified_fact');assert.equal(r.amount_minor,8000);assert.equal(r.role,'CAPTURE');assert.equal(r.revision,null);assert.equal(r.can_authorize_correction,false);return r}],
 ['PV02-UNSIGNED-BODY-NEVER-AUTHENTICATES',async()=>{const n=await notification(payment);n.headers.delete('Wechatpay-Signature');assert.equal((await readWechatProviderEvidence(n.body,n.headers,policy)).status,'review')}],
 ['PV03-BODY-TAMPERING-FAILS-SIGNATURE',async()=>{const n=await notification(payment);assert.equal((await readWechatProviderEvidence(n.body+' ',n.headers,policy)).reason,'provider_signature_invalid')}],
 ['PV04-WRONG-PAYER-REJECTED',async()=>{assert.equal((await wx({...payment,payer:{openid:'another-synthetic-payer'}})).reason,'provider_payer_mismatch')}],
 ['PV05-WRONG-MERCHANT-REJECTED',async()=>{assert.equal((await wx({...payment,mchid:'another-synthetic-merchant'})).reason,'provider_account_mismatch')}],
 ['PV06-UNKNOWN-PLATFORM-KEY-REJECTED',async()=>{const n=await notification(payment);n.headers.set('Wechatpay-Serial','unknown-serial');assert.equal((await readWechatProviderEvidence(n.body,n.headers,policy)).status,'review')}],
 ['PV07-STALE-DELIVERY-REQUIRES-TRUSTED-REQUERY',async()=>{assert.equal((await wx(payment,'TRANSACTION.SUCCESS',{...policy,nowSeconds:policy.nowSeconds+301})).reason,'provider_signature_or_freshness_invalid')}],
 ['PV08-REFUND-NEEDS-INDEPENDENT-CAPTURE-BINDING',async()=>{assert.equal((await wx(refund,'REFUND.SUCCESS')).reason,'provider_capture_binding_missing')}],
 ['PV09-SIGNED-REFUND-USES-PAYER-REFUND-AMOUNT',async()=>{const capture=await wx();const r=await wx(refund,'REFUND.SUCCESS',{...policy,findVerifiedCapture:async()=>capture});assert.equal(r.status,'verified_fact');assert.equal(r.amount_minor,3200);assert.equal(r.parent_reference,payment.transaction_id);assert.equal(r.can_authorize_correction,false);return r}],
 ['PV10-REFUND-CANNOT-BORROW-ANOTHER-ACCOUNT',async()=>{const capture=await wx();assert.equal((await wx(refund,'REFUND.SUCCESS',{...policy,findVerifiedCapture:async()=>({...capture,account_id:'other-owner'})})).reason,'provider_capture_binding_missing')}],
 ['PV11-INDEPENDENT-REFUND-REFERENCES',async()=>{const capture=await wx(),p={...policy,findVerifiedCapture:async()=>capture};const a=await wx(refund,'REFUND.SUCCESS',p),b=await wx({...refund,refund_id:'synthetic-refund-002'},'REFUND.SUCCESS',p);assert.notEqual(a.operation_reference,b.operation_reference);assert.equal(a.parent_reference,b.parent_reference)}],
 ['PV12-PROCESSING-NOT-COMPLETED',async()=>{assert.equal((await wx({...payment,trade_state:'USERPAYING'})).status,'review')}],
 ['PV13-GROSS-ONLY-CANNOT-INVENT-PAYER-AMOUNT',async()=>{const source=structuredClone(payment);delete source.amount.payer_total;assert.equal((await wx(source)).status,'review')}],
 ['PV14-ALIPAY-SIGNED-OPERATION-IS-NOT-A-VERSION',async()=>{const r=await ali();assert.equal(r.status,'verified_fact');assert.equal(r.amount_minor,12345);assert.equal(r.operation_reference,alipay.operation_id);assert.equal(r.parent_reference,alipay.auth_no);assert.equal(r.revision,null);assert.equal(r.can_authorize_correction,false);return r}],
 ['PV15-ALIPAY-RESPONSE-BOUND-TO-PERSISTED-REQUEST',async()=>{assert.equal((await ali({...alipay,out_request_no:'other-request-001'})).reason,'provider_request_or_payer_mismatch')}],
 ['PV16-ALIPAY-PAYER-IS-NOT-MASKED-PHONE',async()=>{assert.equal((await ali({...alipay,payer_user_id:'138****1234'})).status,'review')}],
 ['PV17-CREDIT-AUTH-IS-NOT-CASH-FREEZE',async()=>{assert.equal((await ali({...alipay,pre_auth_type:'CREDIT_AUTH'})).reason,'provider_credit_authorization_unsupported')}],
 ['PV18-ALIPAY-NO-FLOAT-ROUNDING',async()=>{assert.equal((await ali({...alipay,amount:'0.29'})).amount_minor,29);assert.equal((await ali({...alipay,amount:'0.299'})).status,'review')}],
 ['PV19-CLOSED-ALIPAY-OPERATION-NOT-COMPLETED',async()=>{assert.equal((await ali({...alipay,status:'CLOSED'})).status,'review')}],
 ['PV20-MISSING-TRUSTED-POLICY-NO-SELF-ATTESTATION',async()=>{const n=await notification({...payment,verified:true});assert.equal((await readWechatProviderEvidence(n.body,n.headers,{})).status,'review');assert.equal((await ali(alipay,{})).status,'review')}],
];
for(const [case_id,fn] of tests){let error,actual;try{actual=await fn()}catch(e){error=e.stack;process.exitCode=1}await fs.appendFile(log,JSON.stringify({case_id,status:error?'FAIL':'PASS',error:error||'',actual,synthetic_keys_and_accounts_only:true,real_provider_acceptance:'NOT_TESTED'})+'\n');console.log(case_id,error?'FAIL':'PASS')}
