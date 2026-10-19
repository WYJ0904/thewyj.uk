/** Source-money projection over existing events and receipts; no second ledger. */
export const RECOVERABLE_LIFECYCLE_REASONS = new Set(['lifecycle_capture_missing','lifecycle_authorization_missing',
  'lifecycle_refund_exceeds_capture','lifecycle_release_exceeds_remaining']);

export async function lifecycleRows(db,userId,namespace,family) {
  return (await db.prepare(`SELECT e.*,COALESCE(g.passed,0) AS control_accepted FROM task21_notification_events e
    LEFT JOIN task21_payment_lifecycle_guards g ON g.user_id=e.user_id AND g.event_id=e.event_id
    WHERE e.user_id=?1 AND e.reference_namespace=?2 AND e.lifecycle_reference=?3`)
    .bind(userId,namespace,family).all()).results;
}

export function lifecycleBalance(rows) {
  const unresolved=r=>r.identity_review_reason && !(RECOVERABLE_LIFECYCLE_REASONS.has(r.identity_review_reason)&&!r.lifecycle_review_reason&&(r.finance_transaction_id||r.control_accepted));
  const trusted=rows.filter(r=>!unresolved(r) && !r.lifecycle_review_reason);
  const booked=[...new Map(rows.filter(r=>r.finance_transaction_id).map(r=>[r.finance_transaction_id,r])).values()];
  const sum=(rs)=>rs.reduce((n,r)=>n+Number(r.amount_minor),0);
  const cleared=sum(booked.filter(r=>r.financial_phase==='SETTLED'));
  const refunded=sum(booked.filter(r=>r.financial_phase==='REFUNDED'));
  const amounts=[...new Set(trusted.filter(r=>r.financial_phase==='AUTHORIZED').map(r=>Number(r.amount_minor)))];
  const authorized=amounts.length===1?amounts[0]:null;
  const controls=trusted.filter(r=>r.control_accepted || !r.lifecycle_operation);
  const closed=controls.some(r=>r.financial_phase==='EXPIRED'||(r.financial_phase==='RELEASED'&&r.lifecycle_operation!=='RELEASE'));
  const partialReleased=sum([...new Map(controls.filter(r=>r.financial_phase==='RELEASED'&&r.lifecycle_operation==='RELEASE')
    .map(r=>[r.provider_reference,r])).values()]);
  const released=closed&&authorized!==null?Math.max(authorized-cleared,partialReleased,0):partialReleased;
  const proven=authorized===null?null:Math.max(authorized-cleared-released,0);
  const reasons=[...new Set(rows.flatMap(r=>[unresolved(r)?r.identity_review_reason:'',r.lifecycle_review_reason]).filter(Boolean))];
  if(amounts.length>1)reasons.push('lifecycle_authorization_conflict');
  if(new Set(rows.map(r=>r.currency)).size>1)reasons.push('lifecycle_currency_conflict');
  if(![cleared,refunded,released].every(Number.isSafeInteger))reasons.push('lifecycle_total_out_of_range');
  if(closed&&authorized===null)reasons.push('lifecycle_authorization_missing');
  const knownReleased=closed&&(authorized===null||reasons.length)?null:released;
  return {authorized_minor:authorized,cleared_minor:cleared,released_minor:knownReleased,
    remaining_frozen_minor:reasons.length?null:proven,refunded_minor:refunded,
    net_expense_minor:Math.max(cleared-refunded,0),over_captured_minor:authorized===null?0:Math.max(cleared+partialReleased-authorized,0),
    last_proven_remaining_minor:knownReleased===null?(authorized===null?null:Math.max(authorized-cleared-partialReleased,0)):proven,closed,review_reasons:[...new Set(reasons)]};
}

export function lifecycleReason(event,rows) {
  if(!event.financial_phase||!event.lifecycle_reference||!event.reference_namespace)return '';
  if(Number(event.lifecycle_revision)>1)return 'lifecycle_revision_requires_reconciliation';
  const prior=rows.filter(r=>r.event_id!==event.event_id);
  const owned=prior.filter(r=>r.finance_transaction_id||r.control_accepted||!r.lifecycle_operation);
  if(owned.some(r=>r.financial_phase===event.financial_phase&&r.provider_reference===event.provider_reference&&
    (Number(r.amount_minor)!==Number(event.amount_minor)||r.currency!==event.currency)))return 'reference_money_or_instance_conflict';
  if(event.financial_phase==='AUTHORIZED'&&owned.some(r=>r.financial_phase==='AUTHORIZED'&&Number(r.amount_minor)!==Number(event.amount_minor)))
    return 'lifecycle_authorization_conflict';
  if(prior.some(r=>!r.identity_review_reason&&!r.lifecycle_review_reason&&r.currency!==event.currency))return 'lifecycle_currency_conflict';
  const b=lifecycleBalance(prior);const amount=Number(event.amount_minor);
  if(b.review_reasons.includes('lifecycle_total_out_of_range'))return 'lifecycle_total_out_of_range';
  if(event.financial_phase==='SETTLED'&&!Number.isSafeInteger(b.cleared_minor+amount))return 'lifecycle_total_out_of_range';
  if(event.financial_phase==='REFUNDED'&&(event.provider_reference!==event.lifecycle_reference||prior.some(r=>['AUTHORIZED','SETTLED'].includes(r.financial_phase)))) {
    if(b.cleared_minor===0)return 'lifecycle_capture_missing';
    // Replays already owned by the same reference do not consume the balance twice.
    if(!prior.some(r=>r.financial_phase==='REFUNDED'&&r.provider_reference===event.provider_reference&&r.finance_transaction_id)) {
      if(amount>b.cleared_minor-b.refunded_minor)return 'lifecycle_refund_exceeds_capture';
    }
  }
  if(event.lifecycle_operation==='RELEASE') {
    if(b.authorized_minor===null)return 'lifecycle_authorization_missing';
    if(!prior.some(r=>r.lifecycle_operation==='RELEASE'&&r.provider_reference===event.provider_reference&&r.control_accepted))
      if(b.closed||amount>b.last_proven_remaining_minor)return 'lifecycle_release_exceeds_remaining';
  }
  return '';
}

/** CHECK failures abort the entire bookkeeping batch, including the receipt marker.
 * Read-and-check in JavaScript alone cannot protect concurrent refund requests. */
export function lifecycleGuardStatement(db,userId,event) {
  if(!event.financial_phase||!event.lifecycle_reference||!event.reference_namespace)return null;
  const family=`user_id=?1 AND reference_namespace=?2 AND lifecycle_reference=?3`;
  const captures=`COALESCE((SELECT SUM(m) FROM (SELECT MAX(amount_minor) m FROM task21_notification_events
    WHERE ${family} AND financial_phase='SETTLED' AND finance_transaction_id!='' GROUP BY finance_transaction_id)),0)`;
  const refunds=`COALESCE((SELECT SUM(m) FROM (SELECT MAX(amount_minor) m FROM task21_notification_events
    WHERE ${family} AND financial_phase='REFUNDED' AND finance_transaction_id!='' GROUP BY finance_transaction_id)),0)`;
  const accepted=`EXISTS(SELECT 1 FROM task21_payment_lifecycle_guards g WHERE g.user_id=e.user_id AND g.event_id=e.event_id)`;
  const controlReplay=`EXISTS(SELECT 1 FROM task21_notification_events e WHERE e.${family.replaceAll(' AND ',' AND e.')}
    AND e.financial_phase=?7 AND e.provider_reference=?8 AND e.amount_minor=?6 AND ${accepted})`;
  const currency=`NOT EXISTS(SELECT 1 FROM task21_notification_events e WHERE e.${family.replaceAll(' AND ',' AND e.')}
    AND (e.finance_transaction_id!='' OR ${accepted}) AND e.currency!=?5)`;
  let valid=currency+` AND ?6>=0 AND NOT EXISTS(SELECT 1 FROM task21_notification_events e WHERE e.${family.replaceAll(' AND ',' AND e.')}
    AND e.financial_phase=?7 AND e.provider_reference=?8 AND e.amount_minor!=?6 AND ${accepted})`;
  if(event.financial_phase==='AUTHORIZED')valid+=` AND NOT EXISTS(SELECT 1 FROM task21_notification_events e WHERE e.${family.replaceAll(' AND ',' AND e.')}
    AND e.financial_phase='AUTHORIZED' AND e.amount_minor!=?6 AND (${accepted} OR e.lifecycle_operation=''))`;
  if(event.financial_phase==='REFUNDED')valid+=` AND (${captures}>=${refunds}+?6)`;
  if(event.financial_phase==='SETTLED')valid+=` AND (${captures}+?6<=9007199254740991)`;
  if(event.lifecycle_operation==='RELEASE') {
    const authorization=`(SELECT MAX(amount_minor) FROM task21_notification_events e WHERE e.${family.replaceAll(' AND ',' AND e.')}
      AND financial_phase='AUTHORIZED' AND identity_review_reason='' AND lifecycle_review_reason='')`;
    const released=`COALESCE((SELECT SUM(m) FROM (SELECT MAX(e.amount_minor) m FROM task21_notification_events e
      JOIN task21_payment_lifecycle_guards g ON g.user_id=e.user_id AND g.event_id=e.event_id
      WHERE e.${family.replaceAll(' AND ',' AND e.')} AND lifecycle_operation='RELEASE' GROUP BY e.provider_reference)),0)`;
    valid+=` AND (${controlReplay} OR (${authorization} IS NOT NULL AND ${authorization}>=${captures}+${released}+?6
      AND NOT EXISTS(SELECT 1 FROM task21_notification_events e WHERE e.${family.replaceAll(' AND ',' AND e.')}
        AND (financial_phase='EXPIRED' OR (financial_phase='RELEASED' AND lifecycle_operation!='RELEASE')) AND ${accepted})))`;
  }
  return db.prepare(`INSERT OR REPLACE INTO task21_payment_lifecycle_guards(user_id,event_id,passed)
    SELECT ?1,?4,CASE WHEN ${valid} THEN 1 ELSE 0 END`).bind(userId,event.reference_namespace,event.lifecycle_reference,event.event_id,event.currency,event.amount_minor,event.financial_phase,event.provider_reference);
}

export async function readLifecycleBalance(db,account,namespace,family) {
  return lifecycleBalance(await lifecycleRows(db,account.id,namespace,family));
}
