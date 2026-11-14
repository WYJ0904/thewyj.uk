import {unitStamp} from './finance-money-units.mjs';
import {sourceExponent} from './finance-source-units.mjs';
import {sha256Hex} from './cloudflare-foundation.mjs';
import {publicTransaction} from './task16-model.mjs';
import {cleanId,requireAllowedFields,Task21Error,isoNow} from './task21-model.mjs';
import {referenceNamespaceForSource,financeReplayReference} from './task21-event-safety.mjs';

const MAX=9007199254740991;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const encode=v=>JSON.stringify(stable(v));
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const error=code=>new Task21Error('交易关联或更正证据仍需核实',409,code);

/** A trusted adapter must bind the complete command and immutable stored source
 * digests, the provider account scope and completion/version semantics. Neither
 * an authenticated client nor a JSON `verified` flag is a provider attestation.
 * No real provider adapter has been validated; the public API defaults closed. */
export const rejectUnverifiedPaymentAuthority=async()=>null;

export function normalizeReconciliation(operation) {
  requireAllowedFields(operation,new Set(['operation_id','type','payload']));
  cleanId(operation.operation_id,'操作标识');
  if(operation.type!=='payment.reconcile')throw error('reconciliation_type_invalid');
  const p=operation.payload;
  requireAllowedFields(p,new Set(['kind','evidence_event_id','target_event_ids','detach_event_ids','predecessor_operation_id','predecessor_revision','expected_transaction_revision','proof_id','canonical_transaction_id','expected_transaction_revisions']));
  if(!['REPLACE','MAP','REASSIGN','REVOKE','CONSOLIDATE','CONTROL_REPLACE'].includes(p.kind))throw error('reconciliation_kind_invalid');
  for(const k of ['evidence_event_id','proof_id'])cleanId(p[k],k);
  if(p.predecessor_operation_id)cleanId(p.predecessor_operation_id,'前驱修正');
  for(const k of ['predecessor_revision','expected_transaction_revision'])if(!Number.isSafeInteger(p[k])||p[k]<0)throw error('reconciliation_revision_invalid');
  for(const k of ['target_event_ids','detach_event_ids']) {
    if(!Array.isArray(p[k])||p[k].length>8||new Set(p[k]).size!==p[k].length)throw error('reconciliation_targets_invalid');
    p[k].forEach(id=>cleanId(id,'来源事件'));
  }
  if(!p.target_event_ids.length||p.target_event_ids.includes(p.evidence_event_id)||p.detach_event_ids.some(id=>p.target_event_ids.includes(id)||id===p.evidence_event_id))throw error('reconciliation_targets_invalid');
  if(p.kind==='CONSOLIDATE') {
    cleanId(p.canonical_transaction_id,'保留账目标识');
    if(p.detach_event_ids.length||!p.expected_transaction_revisions||typeof p.expected_transaction_revisions!=='object'||Array.isArray(p.expected_transaction_revisions)||
      Object.keys(p.expected_transaction_revisions).length>17)throw error('formal_resolution_invalid');
    for(const [id,revision]of Object.entries(p.expected_transaction_revisions)) {
      cleanId(id,'历史账目标识');
      if(!Number.isSafeInteger(revision)||revision<1)throw error('formal_resolution_invalid');
    }
  } else if(p.canonical_transaction_id!==undefined||p.expected_transaction_revisions!==undefined)throw error('formal_resolution_invalid');
  return operation;
}

function immutableSource(r) {
  const keys=['event_id','user_id','device_id','fingerprint','source_package','source_type','event_type','parser_version','parse_status',
    'direction','amount_minor','currency','payment_channel','merchant','counterparty','confidence','occurred_at_ms','received_at_ms',
    'provider_reference','lifecycle_identity','financial_phase','lifecycle_reference','reference_namespace','currency_evidence','identity_review_reason','lifecycle_operation','lifecycle_revision'];
  return Object.fromEntries(keys.map(k=>[k,r[k]]));
}

export async function reconciliationSnapshot(db,account,operation) {
  const p=normalizeReconciliation(operation).payload;
  const ids=[...p.target_event_ids,...p.detach_event_ids,p.evidence_event_id];
  const rows=[];
  for(const id of ids) {
    const source=await first(db,'SELECT * FROM task21_notification_events WHERE user_id=? AND event_id=?',account.id,id);
    if(!source)throw error('reconciliation_source_missing');
    const effective=await first(db,'SELECT * FROM task21_payment_effective_events WHERE user_id=? AND event_id=?',account.id,id);
    const view=await first(db,'SELECT * FROM task21_payment_effective_view WHERE user_id=? AND event_id=?',account.id,id);
    const candidate=await first(db,'SELECT * FROM task21_notification_candidates WHERE user_id=? AND event_id=?',account.id,id);
    const decision=await first(db,'SELECT * FROM task21_payment_user_decisions WHERE user_id=? AND event_id=?',account.id,id);
    rows.push({source,effective,view,candidate,decision,source_digest:await sha256Hex(encode(immutableSource(source)))});
  }
  const transactionIds=[...new Set(rows.filter(r=>p.target_event_ids.includes(r.source.event_id)||r.source.event_id===p.evidence_event_id)
    .map(r=>r.view.finance_transaction_id).filter(Boolean))];
  const transactions=[];
  for(const id of transactionIds)transactions.push(await first(db,'SELECT * FROM task16_finance_transactions WHERE user_id=? AND id=?',account.id,id));
  const version=Number((await first(db,'SELECT server_version FROM task16_finance_user_versions WHERE user_id=?',account.id))?.server_version||0);
  return {rows,transactions,version};
}

/** Correction/old ingest receipts never rename a transaction silently. An
 * excluded alias is explicitly superseded and carries no usable receipt. */
export async function reconciledIngestReceipt(db,account,eventId,result) {
  const r=await first(db,'SELECT * FROM task21_payment_effective_events WHERE user_id=? AND event_id=?',account.id,eventId);
  if(!r)return result;
  const transaction=r.transaction_id?await first(db,'SELECT * FROM task16_finance_transactions WHERE user_id=? AND id=?',account.id,r.transaction_id):null;
  return {...result,transaction_id:r.excluded?'':r.transaction_id,receipt_reconciled:true,
    reconciliation_status:r.excluded?'superseded':'applied',reconciliation_operation_id:r.operation_id,
    transaction:transaction?publicTransaction(transaction):null,original_transaction_id:String(result.transaction_id||'')};
}

async function pending(db,account,operation,digest,reason,before={}) {
  const now=isoNow();
  await db.prepare(`INSERT INTO task21_payment_reconciliations VALUES(?,?,?,?, 'pending',?,?,'{}',?,?)
    ON CONFLICT(user_id,operation_id) DO UPDATE SET reason=excluded.reason,before_json=excluded.before_json,updated_at=excluded.updated_at
    WHERE task21_payment_reconciliations.status='pending' AND task21_payment_reconciliations.payload_digest=excluded.payload_digest`)
    .bind(account.id,operation.operation_id,digest,encode(operation),reason,encode(before),now,now).run();
  const saved=await first(db,'SELECT payload_digest FROM task21_payment_reconciliations WHERE user_id=? AND operation_id=?',account.id,operation.operation_id);
  if(saved?.payload_digest!==digest)throw error('operation_id_conflict');
  return {operation_id:operation.operation_id,reconciliation_status:'pending',reason,transaction_id:''};
}

/** The normal lifecycle guard and correction guard both read the same view.
 * This runs after overlays, within the very same atomic batch as money+receipt. */
function familyGuard(db,user,op,namespace,family) {
  const scope=`user_id=?1 AND reference_namespace=?3 AND lifecycle_reference=?4 AND excluded=0`;
  const money=phase=>`COALESCE((SELECT SUM(m) FROM (SELECT MAX(amount_minor) m FROM task21_payment_effective_view WHERE ${scope}
    AND financial_phase='${phase}' AND finance_transaction_id!='' GROUP BY finance_transaction_id)),0)`;
  const release=`COALESCE((SELECT SUM(m) FROM (SELECT MAX(e.amount_minor) m FROM task21_payment_effective_view e
    JOIN task21_payment_lifecycle_guards g ON g.user_id=e.user_id AND g.event_id=e.event_id
    WHERE e.user_id=?1 AND e.reference_namespace=?3 AND e.lifecycle_reference=?4 AND e.excluded=0
    AND e.lifecycle_operation='RELEASE' AND e.identity_review_reason='' AND e.lifecycle_review_reason='' GROUP BY e.provider_reference)),0)`;
  const authorized=`(SELECT MAX(e.amount_minor) FROM task21_payment_effective_view e WHERE e.${scope.replaceAll(' AND ',' AND e.')}
    AND e.financial_phase='AUTHORIZED' AND e.identity_review_reason='' AND e.lifecycle_review_reason='')`;
  return db.prepare(`INSERT OR REPLACE INTO task21_payment_reconciliation_guards VALUES(?1,?2,CASE WHEN
    ${money('REFUNDED')}<=${money('SETTLED')} AND ${money('SETTLED')}<=9007199254740991 AND ${money('REFUNDED')}<=9007199254740991
    AND (${release}=0 OR (${authorized} IS NOT NULL AND ${release}<=MAX(${authorized}-${money('SETTLED')},0)))
    AND NOT EXISTS(SELECT 1 FROM task21_payment_effective_view WHERE ${scope} AND finance_transaction_id!=''
      GROUP BY user_id HAVING COUNT(DISTINCT currency)>1) THEN 1 ELSE 0 END)`).bind(user,op,namespace,family);
}

/** Authorization/release/expiry revisions update source facts, never the ledger.
 * The role, family and independent control reference must remain identical. */
async function applyControlRevision(db,account,operation,digest,snapshot,proof) {
  const p=operation.payload,{rows,transactions,version}=snapshot;
  const fail=reason=>pending(db,account,operation,digest,reason,snapshot);
  const e=rows.find(r=>r.source.event_id===p.evidence_event_id).source;
  const targets=rows.filter(r=>p.target_event_ids.includes(r.source.event_id));
  if(transactions.length||p.expected_transaction_revision!==0||p.detach_event_ids.length||!proof.control_revision||
    !['AUTHORIZED','RELEASED','EXPIRED'].includes(e.financial_phase)||!['AUTHORIZE','RELEASE','CLOSE'].includes(e.lifecycle_operation)||
    targets.some(t=>t.view.financial_phase!==e.financial_phase||t.view.lifecycle_operation!==e.lifecycle_operation||
      t.view.provider_reference!==e.provider_reference||t.view.lifecycle_reference!==e.lifecycle_reference))return fail('control_relation_conflict');
  if(!e.lifecycle_reference||!e.provider_reference||!Number.isSafeInteger(e.amount_minor)||e.amount_minor<0||
    proof.completed_source_digests?.[e.event_id]!==rows.find(r=>r.source.event_id===e.event_id).source_digest)return fail('completed_operation_unproven');
  if(e.lifecycle_revision!==p.predecessor_revision+1||targets.some(t=>t.view.lifecycle_revision!==p.predecessor_revision))return fail('stale_or_missing_predecessor');
  const scope=await sha256Hex(String(proof.provider_account_id));
  for(const t of targets){
    const accepted=await first(db,'SELECT passed FROM task21_payment_lifecycle_guards WHERE user_id=? AND event_id=?',account.id,t.source.event_id);
    if(!accepted?.passed)return fail('control_predecessor_unproven');
    if(t.effective){
      const j=await first(db,"SELECT result_json FROM task21_payment_reconciliations WHERE user_id=? AND operation_id=? AND status='applied'",account.id,t.effective.operation_id);
      if(t.effective.operation_id!==p.predecessor_operation_id||!j||JSON.parse(j.result_json).authority_scope!==scope)return fail('provider_account_scope_conflict');
    }
  }
  const canonical=targets[0].view.canonical_event_id;
  if(targets.some(t=>t.view.canonical_event_id!==canonical))return fail('control_relation_conflict');
  const affected=await all(db,`SELECT * FROM task21_payment_effective_view WHERE user_id=? AND reference_namespace=? AND provider_reference=? AND financial_phase=? AND excluded=0`,account.id,e.reference_namespace,e.provider_reference,e.financial_phase);
  if(affected.some(t=>!rows.some(r=>r.source.event_id===t.event_id)))return fail('incomplete_mapping_set');
  const now=isoNow(),next=version+1;
  const result={account_id:account.id,operation_id:operation.operation_id,payload_digest:digest,reconciliation_status:'applied',kind:p.kind,
    transaction_id:'',transaction:null,canonical_event_id:canonical,evidence_event_id:e.event_id,target_event_ids:p.target_event_ids,detach_event_ids:[],authority_scope:scope,
    effective:{amount_minor:e.amount_minor,currency:e.currency,direction:e.direction,financial_phase:e.financial_phase,lifecycle_operation:e.lifecycle_operation,
      lifecycle_revision:e.lifecycle_revision,lifecycle_reference:e.lifecycle_reference,provider_reference:e.provider_reference,reference_namespace:e.reference_namespace},server_version:next};
  await db.prepare('INSERT OR IGNORE INTO task16_finance_user_versions VALUES(?,0,?)').bind(account.id,now).run();
  const statements=[db.prepare(`INSERT OR REPLACE INTO task21_payment_reconciliation_guards VALUES(?,?,CASE WHEN
    (SELECT server_version FROM task16_finance_user_versions WHERE user_id=?)=? THEN 1 ELSE 0 END)`).bind(account.id,operation.operation_id,account.id,version)];
  for(const r of rows){
    statements.push(db.prepare(`INSERT OR REPLACE INTO task21_payment_reconciliation_guards VALUES(?1,?2,CASE WHEN
      EXISTS(SELECT 1 FROM task21_notification_events WHERE user_id=?1 AND event_id=?3 AND status='active')
      AND COALESCE((SELECT operation_id FROM task21_payment_effective_events WHERE user_id=?1 AND event_id=?3),'')=?4
      AND NOT EXISTS(SELECT 1 FROM task21_payment_user_decisions WHERE user_id=?1 AND event_id=?3)
      AND NOT EXISTS(SELECT 1 FROM task21_notification_candidates c WHERE c.user_id=?1 AND c.event_id=?3 AND
        ((c.status='rejected' AND NOT EXISTS(SELECT 1 FROM task21_payment_control_closures s WHERE s.user_id=c.user_id AND s.event_id=c.event_id)) OR c.correction_count>0 OR c.edited_json!='{}'))
      THEN 1 ELSE 0 END)`).bind(account.id,operation.operation_id,r.source.event_id,r.effective?.operation_id||''));
    statements.push(db.prepare(`INSERT INTO task21_payment_effective_events VALUES(?,?,?,'',?,?,?,?,?,?,?,?,0)
      ON CONFLICT(user_id,event_id) DO UPDATE SET canonical_event_id=excluded.canonical_event_id,amount_minor=excluded.amount_minor,
      lifecycle_revision=excluded.lifecycle_revision,operation_id=excluded.operation_id`)
      .bind(account.id,r.source.event_id,canonical,e.amount_minor,e.financial_phase,e.lifecycle_operation,e.lifecycle_revision,e.lifecycle_reference,e.provider_reference,e.reference_namespace,operation.operation_id));
    statements.push(db.prepare('INSERT OR REPLACE INTO task21_payment_lifecycle_guards VALUES(?,?,1)').bind(account.id,r.source.event_id));
  }
  statements.push(familyGuard(db,account.id,operation.operation_id,e.reference_namespace,e.lifecycle_reference));
  statements.push(db.prepare('UPDATE task16_finance_user_versions SET server_version=?,updated_at=? WHERE user_id=? AND server_version=?').bind(next,now,account.id,version));
  statements.push(db.prepare(`INSERT INTO task16_finance_changes VALUES(?,?,'payment_control',?,'upsert',?,?,?)`)
    .bind(account.id,next,canonical,e.lifecycle_revision,encode({payment_control:result.effective,canonical_event_id:canonical}),now));
  statements.push(db.prepare(`INSERT INTO task21_payment_reconciliations VALUES(?,?,?,?,'applied','',?,?,?,?)
    ON CONFLICT(user_id,operation_id) DO UPDATE SET status='applied',reason='',before_json=excluded.before_json,result_json=excluded.result_json,updated_at=excluded.updated_at
    WHERE task21_payment_reconciliations.status='pending' AND task21_payment_reconciliations.payload_digest=excluded.payload_digest`)
    .bind(account.id,operation.operation_id,digest,encode(operation),encode(snapshot),encode(result),now,now));
  try{await db.batch(statements);return result}catch(ex){
    const raced=await first(db,"SELECT * FROM task21_payment_reconciliations WHERE user_id=? AND operation_id=? AND status='applied'",account.id,operation.operation_id);
    if(raced&&raced.payload_digest===digest)return applyPaymentReconciliation(db,account,'',operation);
    if(/CHECK constraint|UNIQUE constraint/.test(String(ex)))return fail('reconciliation_concurrent_or_balance_conflict');throw ex;
  }
}

export async function applyPaymentReconciliation(db,account,deviceId,input,{verifyAuthority=rejectUnverifiedPaymentAuthority}={}) {
  const operation=normalizeReconciliation(input),p=operation.payload;
  const digest=await sha256Hex(encode(operation));
  const prior=await first(db,'SELECT * FROM task21_payment_reconciliations WHERE user_id=? AND operation_id=?',account.id,operation.operation_id);
  if(prior?.payload_digest!==undefined&&prior.payload_digest!==digest)throw error('operation_id_conflict');
  if(prior?.status==='applied') {
    const result=JSON.parse(prior.result_json);
    if(result.kind==='CONTROL_REPLACE') {
      const current=await first(db,'SELECT operation_id FROM task21_payment_effective_events WHERE user_id=? AND event_id=?',account.id,result.canonical_event_id);
      return current?.operation_id===operation.operation_id?{...result,idempotent_replay:true}:{operation_id:operation.operation_id,reconciliation_status:'pending',reason:'control_changed_after_correction',transaction_id:'',idempotent_replay:true};
    }
    const current=await first(db,'SELECT * FROM task16_finance_transactions WHERE user_id=? AND id=?',account.id,result.transaction_id);
    if(!current||current.revision!==result.transaction.revision||current.status!=='active')return {
      operation_id:operation.operation_id,reconciliation_status:'pending',reason:'user_ledger_changed_after_correction',
      transaction_id:'',committed_operation_id:operation.operation_id,idempotent_replay:true};
    return {...result,idempotent_replay:true};
  }
  let snapshot;try{snapshot=await reconciliationSnapshot(db,account,operation)}catch(e){if(e instanceof Task21Error)return pending(db,account,operation,digest,e.code);throw e}
  const {rows,transactions,version}=snapshot;
  const e=rows.find(r=>r.source.event_id===p.evidence_event_id).source;
  const sourceDigests=Object.fromEntries(rows.map(r=>[r.source.event_id,r.source_digest]));
  let proof;try{proof=await verifyAuthority({accountId:account.id,command:operation,commandDigest:digest,sources:rows.map(r=>immutableSource(r.source)),sourceDigests})}catch{proof=null}
  const proven=proof?.command_digest===digest&&proof.account_id===account.id&&proof.provider_account_id&&proof.namespace===e.reference_namespace&&
    proof.completed===true&&proof.semantics==='absolute-operation-revision-v1'&&encode(proof.source_digests)===encode(sourceDigests);
  const fail=reason=>pending(db,account,operation,digest,reason,snapshot);
  if(!proven)return fail('provider_semantics_unverified');
  const systemClosed=new Set();
  if(p.kind==='CONTROL_REPLACE')for(const r of rows){
    if(await first(db,'SELECT event_id FROM task21_payment_control_closures WHERE user_id=? AND event_id=?',account.id,r.source.event_id))systemClosed.add(r.source.event_id);
  }
  if(rows.some(r=>r.source.status!=='active'||r.decision||(r.candidate?.status==='rejected'&&!systemClosed.has(r.source.event_id))||r.candidate?.correction_count>0||
    (r.candidate?.edited_json&&r.candidate.edited_json!=='{}')))return fail('user_decision_conflict');
  if(!e.reference_namespace||referenceNamespaceForSource(e)!==e.reference_namespace||rows.some(r=>referenceNamespaceForSource(r.source)!==e.reference_namespace))return fail('reference_namespace_conflict');
  const reversing=p.kind==='REVOKE';
  if(rows.some(r=>r.source.currency!==e.currency||(!reversing&&r.source.direction!==e.direction))||e.currency_evidence!==e.currency)return fail('currency_or_direction_conflict');
  if(e.currency==='JPY' && await sourceExponent(db,account.id,e.event_id,'JPY')!==0)
    return fail('currency_unit_review_required');
  if(p.kind==='CONTROL_REPLACE')return applyControlRevision(db,account,operation,digest,snapshot,proof);
  const completionProven=proof.completed_source_digests?.[e.event_id]===sourceDigests[e.event_id];
  if(!completionProven||(e.parse_status!=='parsed'&&!(e.parse_status==='candidate'&&e.identity_review_reason==='lifecycle_revision_requires_reconciliation'))||!['SETTLED','REFUNDED'].includes(e.financial_phase)||!e.lifecycle_reference||!e.provider_reference||
    !Number.isSafeInteger(e.amount_minor)||e.amount_minor<0||e.amount_minor>MAX||
    e.amount_minor===0)return fail('completed_operation_unproven');
  const targets=rows.filter(r=>p.target_event_ids.includes(r.source.event_id));
  if(targets.some(r=>['AUTHORIZED','RELEASED','EXPIRED'].includes(r.view.financial_phase)))return fail('authoritative_role_conflict');
  const authorityScope=await sha256Hex(String(proof.provider_account_id));
  for(const target of targets.filter(r=>r.effective)) {
    const accepted=await first(db,"SELECT result_json FROM task21_payment_reconciliations WHERE user_id=? AND operation_id=? AND status='applied'",account.id,target.effective.operation_id);
    if(!accepted||JSON.parse(accepted.result_json).authority_scope!==authorityScope)return fail('provider_account_scope_conflict');
  }
  if(targets.some(r=>(r.view.excluded&&p.kind!=='MAP')||r.view.lifecycle_revision!==p.predecessor_revision)||e.lifecycle_revision!==p.predecessor_revision+1)return fail('stale_or_missing_predecessor');
  if(p.kind==='REPLACE') {
    if(targets.some(r=>r.view.provider_reference!==e.provider_reference||r.view.lifecycle_reference!==e.lifecycle_reference||r.view.financial_phase!==e.financial_phase))return fail('authoritative_relation_conflict');
  }
  const consolidating=p.kind==='CONSOLIDATE';
  if(transactions.some(t=>!t)||(!consolidating&&transactions.length>1))return fail('multiple_formal_transactions');
  if(consolidating) {
    if(encode(proof.same_operation_source_digests)!==encode(sourceDigests))return fail('same_operation_unproven');
    if(transactions.length<2||!transactions.some(t=>t.id===p.canonical_transaction_id)||
      encode(Object.fromEntries(transactions.map(t=>[t.id,t.revision])))!==encode(p.expected_transaction_revisions)||
      proof.canonical_transaction_id!==p.canonical_transaction_id||encode(proof.transaction_revisions)!==encode(p.expected_transaction_revisions))return fail('formal_resolution_revision_conflict');
  }
  const existing=consolidating?transactions.find(t=>t.id===p.canonical_transaction_id):transactions[0];
  const superseded=consolidating?transactions.filter(t=>t.id!==existing.id):[];
  for(const ledger of transactions) {
    const origins=await all(db,`SELECT r.metadata_json FROM task16_finance_raw_events r JOIN task16_finance_transaction_events l
      ON l.raw_event_id=r.id AND l.relation_status='active' WHERE r.user_id=? AND l.transaction_id=?`,account.id,ledger.id);
    const kinds=origins.map(r=>{try{return JSON.parse(r.metadata_json).capture_version||''}catch{return ''}});
    if(kinds.some(k=>['verified-on-device','pending-hint'].includes(k)))return fail('user_decision_conflict');
    const auto=new Set(['wechat-4','alipay-4','bank-notification-4','bank-sms-4','wechat-structured-4','alipay-structured-4','local-autobook-v2','payment-settled-4','pending-hint-auto']);
    // Reconciliation-created ledgers have their origin in the immutable journal.
    const journalOrigin=await first(db,"SELECT operation_id FROM task21_payment_reconciliations WHERE user_id=? AND status='applied' AND json_extract(result_json,'$.transaction_id')=? LIMIT 1",account.id,ledger.id);
    if(!journalOrigin&&(!kinds.length||kinds.some(k=>!auto.has(k))))return fail('legacy_ledger_origin_unproven');
    if(ledger.status!=='active'||ledger.source_kind!=='automatic'||ledger.reconciliation_state!=='automatic'||ledger.system_superseded_by)return fail('user_ledger_revision_conflict');
    if(ledger.revision>1&&ledger.id!==existing.id) {
      const previous=await first(db,"SELECT result_json FROM task21_payment_reconciliations WHERE user_id=? AND operation_id=? AND status='applied'",account.id,proof.predecessor_operations?.[ledger.id]||'');
      const t=previous?JSON.parse(previous.result_json).transaction:null;
      if(!t||t.id!==ledger.id||t.revision!==ledger.revision||t.amount_minor!==ledger.amount_minor||t.currency!==ledger.currency)return fail('user_ledger_revision_conflict');
    }
  }
  if(reversing&&(!proof.revoked||!existing||e.financial_phase!=='REFUNDED'||e.direction!=='refund'||
    e.amount_minor!==existing.amount_minor||targets.some(r=>r.view.financial_phase!=='SETTLED'||r.view.lifecycle_reference!==e.lifecycle_reference||r.view.provider_reference===e.provider_reference)))return fail('reversal_requires_exact_completed_refund');
  if(existing) {
    if(existing.status!=='active'||existing.source_kind!=='automatic'||existing.reconciliation_state!=='automatic'||existing.revision!==p.expected_transaction_revision)return fail('user_ledger_revision_conflict');
    if(existing.revision>1) {
      const previous=await first(db,"SELECT result_json FROM task21_payment_reconciliations WHERE user_id=? AND operation_id=? AND status='applied'",account.id,p.predecessor_operation_id||'');
      const t=previous?JSON.parse(previous.result_json).transaction:null;
      if(!t||t.id!==existing.id||t.revision!==existing.revision||t.amount_minor!==existing.amount_minor||t.currency!==existing.currency)return fail('user_ledger_revision_conflict');
    }
  } else if(p.expected_transaction_revision!==0||p.kind==='REVOKE')return fail('ledger_predecessor_missing');
  const claimed=await all(db,`SELECT * FROM task21_payment_effective_view WHERE user_id=? AND reference_namespace=? AND provider_reference=?
    AND financial_phase=? AND finance_transaction_id!='' AND excluded=0`,account.id,e.reference_namespace,e.provider_reference,e.financial_phase);
  if(claimed.some(r=>!rows.some(x=>x.source.event_id===r.event_id)&&r.finance_transaction_id!==(existing?.id||'')))return fail('authoritative_relation_conflict');
  const namespace=e.reference_namespace,family=e.lifecycle_reference;
  const canonicalOwner=existing?targets.find(t=>t.view.finance_transaction_id===existing.id)||rows.find(t=>t.source.event_id===e.event_id&&t.view.finance_transaction_id===existing.id):null;
  const canonical=existing&&!reversing?canonicalOwner?.view.canonical_event_id:p.evidence_event_id;
  if(!canonical)return fail('canonical_predecessor_missing');
  const now=isoNow(),transactionId=(!reversing&&existing?.id)||`txn:notif:${(await sha256Hex(`${account.id}\n${canonical}`)).slice(0,48)}`;
  // Task16 has one row per account/version. Allocate a contiguous range in the
  // same batch, so old clients can consume each tombstone before the upsert.
  const revision=reversing?1:(existing?.revision||0)+1,next=version+1+superseded.length;
  const original=reversing?null:existing;
  const transaction={...(original||{}),id:transactionId,user_id:account.id,direction:e.direction,amount_minor:e.amount_minor,currency:e.currency,...(e.currency==='JPY'?{amount_exponent:0}:{}),
    category_id:original?.category_id||'',merchant:original?.merchant??e.merchant,counterparty:original?.counterparty??e.counterparty,note:original?.note||'',
    occurred_at_ms:original?.occurred_at_ms||e.occurred_at_ms||e.received_at_ms,source_kind:'automatic',reconciliation_state:'automatic',status:'active',
    revision,sync_version:next,created_at:original?.created_at||now,updated_at:now,deleted_at:''};
  const result={account_id:account.id,operation_id:operation.operation_id,payload_digest:digest,reconciliation_status:'applied',transaction_id:transactionId,
    kind:p.kind,original_transaction_id:reversing?existing.id:'',authority_scope:authorityScope,
    authority:{proof_id:p.proof_id,namespace:e.reference_namespace,source_digests:sourceDigests,completed_source_digests:proof.completed_source_digests,semantics:proof.semantics},
    canonical_event_id:canonical,evidence_event_id:e.event_id,target_event_ids:p.target_event_ids,detach_event_ids:p.detach_event_ids,
    transaction:publicTransaction({...transaction,notification_event_ids_json:JSON.stringify([...p.target_event_ids,e.event_id])}),
    ...(consolidating?{superseded_transactions:superseded.map((t,index)=>publicTransaction({...t,status:'deleted',revision:t.revision+1,sync_version:version+index+1,updated_at:now,deleted_at:now,
      system_superseded_by:transactionId,system_superseded_operation:operation.operation_id}))}:{}),
    effective:{amount_minor:e.amount_minor,currency:e.currency,direction:e.direction,financial_phase:e.financial_phase,lifecycle_operation:e.lifecycle_operation,
      lifecycle_revision:e.lifecycle_revision,lifecycle_reference:family,provider_reference:e.provider_reference,reference_namespace:namespace},server_version:next};
  await db.prepare('INSERT OR IGNORE INTO task16_finance_user_versions VALUES(?,0,?)').bind(account.id,now).run();
  const statements=[];
  // Compare every mutable input again in the write transaction. The version
  // fence also serializes against normal captures/refunds and Task16 edits.
  statements.push(db.prepare(`INSERT OR REPLACE INTO task21_payment_reconciliation_guards VALUES(?,?,CASE WHEN
    (SELECT server_version FROM task16_finance_user_versions WHERE user_id=?)=? THEN 1 ELSE 0 END)`).bind(account.id,operation.operation_id,account.id,version));
  for(const r of rows) {
    statements.push(db.prepare(`INSERT OR REPLACE INTO task21_payment_reconciliation_guards VALUES(?1,?2,CASE WHEN
      EXISTS(SELECT 1 FROM task21_notification_events WHERE user_id=?1 AND event_id=?3 AND status=?4 AND finance_transaction_id=?5 AND candidate_id=?6)
      AND COALESCE((SELECT operation_id FROM task21_payment_effective_events WHERE user_id=?1 AND event_id=?3),'')=?7
      AND NOT EXISTS(SELECT 1 FROM task21_payment_user_decisions WHERE user_id=?1 AND event_id=?3)
      AND NOT EXISTS(SELECT 1 FROM task21_notification_candidates WHERE user_id=?1 AND event_id=?3 AND (status='rejected' OR correction_count>0 OR edited_json!='{}'))
      THEN 1 ELSE 0 END)`).bind(account.id,operation.operation_id,r.source.event_id,r.source.status,r.source.finance_transaction_id,r.source.candidate_id,r.effective?.operation_id||''));
  }
  for(const ledger of transactions)statements.push(db.prepare(`INSERT OR REPLACE INTO task21_payment_reconciliation_guards VALUES(?,?,CASE WHEN
    EXISTS(SELECT 1 FROM task16_finance_transactions WHERE user_id=? AND id=? AND revision=? AND status='active' AND amount_minor=? AND currency=?) THEN 1 ELSE 0 END)`)
    .bind(account.id,operation.operation_id,account.id,ledger.id,ledger.revision,ledger.amount_minor,ledger.currency));
  const affected=[];
  for(const id of (transactions.length?transactions.map(t=>t.id):[transactionId]))affected.push(...await all(db,'SELECT * FROM task21_payment_effective_view WHERE user_id=? AND finance_transaction_id=? AND excluded=0',account.id,id));
  if(affected.some(r=>!rows.some(x=>x.source.event_id===r.event_id)))return fail('incomplete_mapping_set');
  for(const r of rows.filter(r=>p.detach_event_ids.includes(r.source.event_id))) {
    const original=await first(db,"SELECT id FROM task16_finance_raw_events WHERE user_id=? AND source_type='notification' AND source_event_id=?",account.id,r.source.event_id);
    if(r.view.finance_transaction_id!==transactionId||original)return fail('detach_requires_alias_proof');
  }
  const members=[...new Set([...(reversing?[]:p.target_event_ids),e.event_id,...(reversing?[]:affected.map(r=>r.event_id))])];
  if(reversing)for(const r of targets)statements.push(db.prepare(`INSERT INTO task21_payment_effective_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)
    ON CONFLICT(user_id,event_id) DO UPDATE SET lifecycle_revision=excluded.lifecycle_revision,operation_id=excluded.operation_id`)
    .bind(account.id,r.source.event_id,r.view.canonical_event_id,existing.id,r.view.amount_minor,r.view.financial_phase,r.view.lifecycle_operation,
      e.lifecycle_revision,r.view.lifecycle_reference,r.view.provider_reference,r.view.reference_namespace,operation.operation_id));
  for(const id of [...new Set([...members,...p.detach_event_ids])]) {
    const excluded=p.detach_event_ids.includes(id)?1:0;
    const source=rows.find(r=>r.source.event_id===id)?.source;
    statements.push(db.prepare(`INSERT INTO task21_payment_effective_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,event_id) DO UPDATE SET canonical_event_id=excluded.canonical_event_id,transaction_id=excluded.transaction_id,
      amount_minor=excluded.amount_minor,financial_phase=excluded.financial_phase,lifecycle_operation=excluded.lifecycle_operation,lifecycle_revision=excluded.lifecycle_revision,
      lifecycle_reference=excluded.lifecycle_reference,provider_reference=excluded.provider_reference,reference_namespace=excluded.reference_namespace,operation_id=excluded.operation_id,excluded=excluded.excluded`)
      .bind(account.id,id,excluded?id:canonical,excluded?'':transactionId,excluded?source.amount_minor:e.amount_minor,
        excluded?'REVIEW_REQUIRED':e.financial_phase,excluded?'':e.lifecycle_operation,excluded?0:e.lifecycle_revision,
        excluded?'':family,excluded?source.provider_reference:e.provider_reference,namespace,operation.operation_id,excluded));
    statements.push(db.prepare(`UPDATE task21_notification_candidates SET status=?,finance_transaction_id=?,updated_at=? WHERE user_id=? AND event_id=?`)
      .bind(excluded?'pending':'confirmed',excluded?'':transactionId,now,account.id,id));
    if(excluded)statements.push(db.prepare(`INSERT INTO task21_notification_candidates(id,user_id,event_id,direction,amount_minor,currency,merchant,counterparty,payment_channel,occurred_at_ms,confidence,status,finance_transaction_id,created_at,updated_at)
      SELECT ?,user_id,event_id,direction,amount_minor,currency,merchant,counterparty,payment_channel,CASE WHEN occurred_at_ms>0 THEN occurred_at_ms ELSE received_at_ms END,confidence,'pending','',?,?
      FROM task21_notification_events WHERE user_id=? AND event_id=? AND NOT EXISTS(SELECT 1 FROM task21_notification_candidates WHERE user_id=? AND event_id=?)`)
      .bind('cand:'+crypto.randomUUID(),now,now,account.id,id,account.id,id));
    statements.push(db.prepare(`UPDATE task21_notification_evidence SET finance_transaction_id=?,reconciliation_state=?,updated_at=? WHERE user_id=? AND event_id=?`)
      .bind(excluded?'':transactionId,excluded?'pending':'confirmed',now,account.id,id));
    statements.push(db.prepare(`UPDATE task21_notification_pending_hints SET state=?,finance_entry_id=?,updated_at=? WHERE user_id=? AND source_event_id=? AND state IN ('pending','confirmed')`)
      .bind(excluded?'pending':'confirmed',excluded?'':transactionId,now,account.id,id));
  }
  const families=new Map([[namespace+'|'+family,[namespace,family]]]);
  for(const r of [...targets,...affected.map(view=>({view}))])if(r.view.lifecycle_reference)families.set(r.view.reference_namespace+'|'+r.view.lifecycle_reference,[r.view.reference_namespace,r.view.lifecycle_reference]);
  for(const [ns,f] of families.values())statements.push(familyGuard(db,account.id,operation.operation_id,ns,f));
  if(existing&&!reversing)statements.push(db.prepare('UPDATE task16_finance_transactions SET amount_minor=?,revision=?,sync_version=?,updated_at=? WHERE user_id=? AND id=? AND revision=?')
    .bind(e.amount_minor,revision,next,now,account.id,transactionId,existing.revision));
  else {
    const rawId='raw:reconcile:'+crypto.randomUUID();
    statements.push(db.prepare(`INSERT INTO task16_finance_raw_events(id,user_id,device_id,source_type,source_event_id,source_provider,provider_reference,direction,amount_minor,currency,merchant,counterparty,account_last4,occurred_at_ms,captured_at_ms,text_fingerprint_sha256,classification,classification_reason,metadata_json,sync_version,created_at)
      VALUES(?,?,?,'notification',?,?,?,?,?,?,?,?,'',?,?,?,'accepted','authoritative_reconciliation',?,?,?)`).bind(rawId,account.id,deviceId,canonical,
      financeReplayReference(e).provider,e.provider_reference,e.direction,e.amount_minor,e.currency,e.merchant,e.counterparty,transaction.occurred_at_ms,e.received_at_ms,e.fingerprint,encode({operation_id:operation.operation_id}),next,now));
    statements.push(db.prepare(`INSERT INTO task16_finance_transactions(id,user_id,direction,amount_minor,currency,category_id,merchant,counterparty,note,occurred_at_ms,source_kind,reconciliation_state,status,revision,sync_version,created_by_device,import_source_key,created_at,updated_at,deleted_at)
      VALUES(?,?,?,?,?,'',?,?,'',?,'automatic','automatic','active',1,?,?,'',?,?,'')`).bind(transactionId,account.id,e.direction,e.amount_minor,e.currency,e.merchant,e.counterparty,transaction.occurred_at_ms,next,deviceId,now,now));
    statements.push(db.prepare(`INSERT INTO task16_finance_transaction_events VALUES(?,?,'active',1000,?,'automatic',?,?)`).bind(transactionId,rawId,encode(['authoritative_reconciliation']),now,now));
  }
  statements.push(...await unitStamp(db,transactionId,e.currency,e.currency==='JPY'?0:undefined));
  // Retire only the proved duplicate's effective contribution. Its ID, amount,
  // source links and original receipts remain queryable. No refund is invented.
  for(const [index,t] of superseded.entries()) {
    const retiredVersion=version+index+1;
    statements.push(db.prepare(`UPDATE task16_finance_transactions SET status='deleted',revision=revision+1,sync_version=?,updated_at=?,deleted_at=?,
      system_superseded_by=?,system_superseded_operation=? WHERE user_id=? AND id=? AND revision=?`)
      .bind(retiredVersion,now,now,transactionId,operation.operation_id,account.id,t.id,t.revision));
    const retired=result.superseded_transactions.find(r=>r.id===t.id);
    statements.push(db.prepare(`INSERT INTO task16_finance_changes(user_id,version,entity_type,entity_id,operation,revision,payload_json,created_at) VALUES(?,?,'transaction',?,'delete',?,?,?)`)
      .bind(account.id,retiredVersion,t.id,retired.revision,encode({transaction:retired,system_supersession:true}),now));
  }
  // Existing Task16 audit cells are capped at 12 KB. The new journal retains
  // the complete immutable before image; the old audit table gets a verifiable
  // pointer and the formal ledger's before image, without dropping evidence.
  const auditBefore={reconciliation_operation_id:operation.operation_id,snapshot_sha256:await sha256Hex(encode(snapshot)),
    source_event_ids:rows.map(r=>r.source.event_id),transaction:existing?publicTransaction(existing):null};
  statements.push(db.prepare(`INSERT INTO task16_finance_audit_logs VALUES(?,?,?,'payment_reconciliation','transaction',?,?,?,?)`)
    .bind(crypto.randomUUID(),account.id,deviceId,transactionId,encode(auditBefore),encode(result),now));
  statements.push(db.prepare(`UPDATE task16_finance_user_versions SET server_version=?,updated_at=? WHERE user_id=? AND server_version=?`).bind(next,now,account.id,version));
  statements.push(db.prepare(`INSERT INTO task16_finance_changes(user_id,version,entity_type,entity_id,operation,revision,payload_json,created_at) VALUES(?,?,'transaction',?,'upsert',?,?,?)`)
    .bind(account.id,next,transactionId,revision,encode({transaction:result.transaction}),now));
  statements.push(db.prepare(`INSERT INTO task21_payment_reconciliations VALUES(?,?,?,?,'applied','',?,?,?,?)
    ON CONFLICT(user_id,operation_id) DO UPDATE SET status='applied',reason='',before_json=excluded.before_json,result_json=excluded.result_json,updated_at=excluded.updated_at
    WHERE task21_payment_reconciliations.status='pending' AND task21_payment_reconciliations.payload_digest=excluded.payload_digest`)
    .bind(account.id,operation.operation_id,digest,encode(operation),encode(snapshot),encode(result),now,now));
  try{await db.batch(statements);return result}catch(ex) {
    const raced=await first(db,"SELECT * FROM task21_payment_reconciliations WHERE user_id=? AND operation_id=? AND status='applied'",account.id,operation.operation_id);
    if(raced){
      if(raced.payload_digest!==digest)throw error('operation_id_conflict');
      // Re-enter the applied-receipt branch so a user edit committed after the
      // other writer is checked as well. Never bypass this check on a CAS race.
      return applyPaymentReconciliation(db,account,deviceId,input,{verifyAuthority});
    }
    if(/CHECK constraint|UNIQUE constraint/.test(String(ex)))return fail('reconciliation_concurrent_or_balance_conflict');
    throw ex;
  }
}

export async function recordPaymentUserDecision(db,account,eventId,decision) {
  await db.prepare('INSERT OR IGNORE INTO task21_payment_user_decisions VALUES(?,?,?,?)').bind(account.id,eventId,decision,isoNow()).run();
}
