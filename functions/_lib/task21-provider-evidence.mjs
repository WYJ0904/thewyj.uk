import {sha256Hex} from './cloudflare-foundation.mjs';

// Internal, read-only adapters. There is deliberately no public ingestion route
// or automatic conversion to payment.reconcile authority. Real credentials,
// tenant/payer bindings and original-source associations are not yet available.
const bytes=s=>new TextEncoder().encode(s);
const reject=reason=>({status:'review',reason});
function base64(s){if(typeof s!=='string'||s.length>90000||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('encoding');return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
const bounded=s=>typeof s==='string'&&s.length>0&&bytes(s).length<=65536;
const ref=s=>typeof s==='string'&&/^[A-Za-z0-9_\-]{8,80}$/.test(s);
const minor=n=>Number.isSafeInteger(n)&&n>=0&&n<=9007199254740991;
async function scope(provider,policy){
 const parts=[provider,policy.accountId,policy.merchantId,policy.appId,policy.payerId];
 // Preserve existing user-ID/WeChat scopes; an app-scoped Alipay OpenID is a
 // distinct namespace even when its literal value equals a legacy user ID.
 if(provider==='alipay'&&policy.payerIdType==='open_id')parts.push('payer_open_id');
 return sha256Hex(JSON.stringify(parts));
}

/** Official APIv3 RSA signature over exact bytes, then AES-GCM resource. Policy
 * keys and payer binding must come from a trusted server configuration, never
 * fields in the incoming body. No network, persistence or payment operation. */
export async function readWechatProviderEvidence(rawBody,headers,policy){
 try{
  if(!bounded(rawBody)||!policy?.accountId||!policy.merchantId||!policy.appId||!policy.payerId)return reject('provider_binding_missing');
  const serial=headers.get('Wechatpay-Serial'),timestamp=headers.get('Wechatpay-Timestamp'),nonce=headers.get('Wechatpay-Nonce');
  const key=policy.platformKeys?.get(serial);
  if(!key||!policy.apiV3Key||!/^\d{10}$/.test(timestamp||'')||!nonce||nonce.length>64||
    !Number.isSafeInteger(policy.nowSeconds)||Math.abs(policy.nowSeconds-Number(timestamp))>300)return reject('provider_signature_or_freshness_invalid');
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,base64(headers.get('Wechatpay-Signature')),bytes(`${timestamp}\n${nonce}\n${rawBody}\n`)))return reject('provider_signature_invalid');
  const envelope=JSON.parse(rawBody),r=envelope.resource;
  if(!ref(envelope.id)||r?.algorithm!=='AEAD_AES_256_GCM'||typeof r.nonce!=='string'||bytes(r.nonce).length!==12||typeof r.associated_data!=='string')return reject('provider_resource_invalid');
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(r.nonce),additionalData:bytes(r.associated_data),tagLength:128},policy.apiV3Key,base64(r.ciphertext));
  if(plaintext.byteLength>65536)return reject('provider_resource_invalid');
  const source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext));
  if(source.mchid!==policy.merchantId||!ref(source.transaction_id))return reject('provider_account_mismatch');
  const providerScope=await scope('wechat',policy),a=source.amount;
  if(envelope.event_type==='TRANSACTION.SUCCESS'){
   if(source.appid!==policy.appId||source.payer?.openid!==policy.payerId)return reject('provider_payer_mismatch');
   if(source.trade_state!=='SUCCESS'||a?.currency!=='CNY'||a.payer_currency!=='CNY'||!minor(a.payer_total)||!minor(a.total)||a.payer_total>a.total)return reject('provider_amount_or_state_unproven');
   return {status:'verified_fact',account_id:policy.accountId,provider:'wechat',provider_scope:providerScope,
    operation_reference:source.transaction_id,parent_reference:'',role:'CAPTURE',amount_minor:a.payer_total,currency:'CNY',
    amount_basis:'payer_cash',source_digest:await sha256Hex(rawBody),revision:null,predecessor_revision:null,can_authorize_correction:false};
  }
  if(envelope.event_type==='REFUND.SUCCESS'){
   // A refund callback lacks the payer OpenID. Bind it to an independently
   // verified capture in this exact merchant/app/payer/account scope.
   const capture=await policy.findVerifiedCapture?.(source.transaction_id);
   if(!capture||capture.status!=='verified_fact'||capture.provider_scope!==providerScope||capture.account_id!==policy.accountId||
    capture.operation_reference!==source.transaction_id||capture.role!=='CAPTURE'||capture.currency!=='CNY')return reject('provider_capture_binding_missing');
   if(source.refund_status!=='SUCCESS'||!ref(source.refund_id)||a?.currency&&a.currency!=='CNY'||
    !minor(a?.payer_refund)||!minor(a?.refund)||a.payer_refund>a.refund||a.payer_refund>capture.amount_minor)return reject('provider_amount_or_state_unproven');
   return {status:'verified_fact',account_id:policy.accountId,provider:'wechat',provider_scope:providerScope,
    operation_reference:source.refund_id,parent_reference:source.transaction_id,role:'REFUND',amount_minor:a.payer_refund,currency:'CNY',
    amount_basis:'payer_cash',source_digest:await sha256Hex(rawBody),revision:null,predecessor_revision:null,can_authorize_correction:false};
  }
  return reject('provider_operation_unsupported');
 }catch{return reject('provider_evidence_invalid')}
}

/** A genuine signed Alipay operation-query response exposes an independent
 * operation_id and auth_no, not an absolute operation revision. This preserves
 * that distinction. signedContent must be the SDK's exact response-object byte
 * slice, associated with the persisted outgoing query (not JSON re-encoded). */
export async function readAlipayAuthorizationEvidence(signedContent,signature,policy){
 try{
  if(!bounded(signedContent)||!policy?.platformKey||!policy.accountId||!policy.merchantId||!policy.appId||!policy.payerId||
    !ref(policy.expectedAuthNo)||!ref(policy.expectedOperationId)||!ref(policy.expectedRequestNo))return reject('provider_binding_missing');
  // The trusted account binding selects the SDK identity field. Never guess
  // from the response, a masked login name, or a matching unrelated ID.
  const payerIdType=policy.payerIdType||'user_id';
  if(!['user_id','open_id'].includes(payerIdType))return reject('provider_binding_missing');
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',policy.platformKey,base64(signature),bytes(signedContent)))return reject('provider_signature_invalid');
  const s=JSON.parse(signedContent);
  if(s.code!=='10000'||s.auth_no!==policy.expectedAuthNo||s.operation_id!==policy.expectedOperationId||s.out_request_no!==policy.expectedRequestNo||
    s[payerIdType==='open_id'?'payer_open_id':'payer_user_id']!==policy.payerId)return reject('provider_request_or_payer_mismatch');
  // CREDIT_AUTH is explicitly not a frozen-cash balance. The general P03 cash
  // hold projection must not silently apply to credit-authorisation products.
  if(s.pre_auth_type==='CREDIT_AUTH')return reject('provider_credit_authorization_unsupported');
  if(s.status!=='SUCCESS'||typeof s.amount!=='string'||!/^\d{1,13}(?:\.\d{1,2})?$/.test(s.amount)||
    (s.trans_currency&&s.trans_currency!=='CNY'))return reject('provider_amount_or_state_unproven');
  const [whole,fraction='']=s.amount.split('.');const amount=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(!minor(amount))return reject('provider_amount_or_state_unproven');
  return {status:'verified_fact',account_id:policy.accountId,provider:'alipay',provider_scope:await scope('alipay',policy),
    payer_id_type:payerIdType,
    operation_reference:s.operation_id,parent_reference:s.auth_no,provider_operation_type:s.operation_type,amount_minor:amount,currency:'CNY',
    role:'AUTHORIZATION_OPERATION_REQUIRES_PRODUCT_CONTRACT',source_digest:await sha256Hex(signedContent),
    revision:null,predecessor_revision:null,can_authorize_correction:false};
 }catch{return reject('provider_evidence_invalid')}
}
