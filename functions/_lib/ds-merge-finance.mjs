import { sha256Hex } from './cloudflare-foundation.mjs';

const subjects = 'SELECT value FROM json_each(?)';
const limit = 250;
const scopedTransactions = `WITH scoped AS (
  SELECT * FROM task16_finance_transactions WHERE user_id IN (${subjects})
  ORDER BY user_id,id LIMIT ${limit + 1}
)`;

// Columns used for the receipt or comparison are also compared in the
// conditional commit. Amounts cross the D1/JavaScript boundary as text.
export const mergeFinanceQueries = {
  transactions: `${scopedTransactions}
    SELECT json_object('id',id,'subject',user_id,'amount',CAST(amount_minor AS TEXT),
      'exponent',amount_exponent,'currency',currency,'direction',direction,'occurred',occurred_at_ms,
      'posted',created_at,'updated',updated_at,'revision',revision,'syncVersion',sync_version,
      'device',created_by_device,'source',source_kind,'batch',import_source_key,'merchant',merchant,
      'counterparty',counterparty,'status',status,'superseded',system_superseded_by,
      'currencyReview',currency_review_required,'reviewState',reconciliation_state) AS value
    FROM scoped ORDER BY user_id,id`,
  evidence: `${scopedTransactions}
    SELECT json_object('transaction',t.id,'id',r.id,'subject',r.user_id,'provider',r.source_provider,
      'reference',r.provider_reference,'event',r.source_event_id,'type',r.source_type,'device',r.device_id,
      'fingerprint',r.text_fingerprint_sha256,'captured',r.captured_at_ms,'relation',l.relation_status,
      'version',r.sync_version,'linkedBy',l.linked_by,'updated',l.updated_at) AS value FROM scoped t
    JOIN task16_finance_transaction_events l ON l.transaction_id=t.id
    JOIN task16_finance_raw_events r ON r.id=l.raw_event_id AND r.user_id=t.user_id
    ORDER BY t.id,r.id LIMIT 1001`,
  lifecycle: `${scopedTransactions}
    SELECT json_object('transaction',t.id,'event',e.event_id,'canonicalEvent',e.canonical_event_id,
      'provider',e.payment_channel,'reference',e.provider_reference,'namespace',e.reference_namespace,
      'parent',e.lifecycle_reference,'phase',e.financial_phase,'operation',e.lifecycle_operation,
      'revision',e.lifecycle_revision,'excluded',e.excluded) AS value FROM scoped t
    JOIN task21_payment_effective_view e ON e.finance_transaction_id=t.id AND e.user_id=t.user_id
    ORDER BY t.id,e.event_id LIMIT 1001`,
  authority: `${scopedTransactions}
    SELECT json_object('transaction',t.id,'subject',f.subject,'provider',f.provider,
      'account',f.provider_account,'reference',f.operation_ref,'parent',f.parent_ref,
      'kind',f.kind,'amount',CAST(f.amount_minor AS TEXT),'currency',f.currency,
      'exponent',f.amount_exponent,'digest',f.evidence_digest) AS value FROM scoped t
    JOIN aeris_ds_merge_finance_facts f ON f.transaction_id=t.id AND f.revision=t.revision
    ORDER BY t.id`,
};

const idOf = row => JSON.stringify([row.subject,row.id]);
const keyOf = fact => JSON.stringify([fact.provider,fact.account,fact.reference]);
const active = row => row.status==='active' && !row.superseded;
const normalize = value => value.trim().normalize('NFKC').toLowerCase();
const sameNamedParty = (a, b) => [a.merchant,a.counterparty].map(normalize).some(value =>
  value && [b.merchant,b.counterparty].map(normalize).includes(value));
const currencyCertain = row => [0,2].includes(row.exponent) && !row.currencyReview;
const sameMoney = (a, b) => a.currency===b.currency && a.exponent===b.exponent && a.amount===b.amount;

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const current = groups.get(key(item)) ?? [];
    current.push(item);
    groups.set(key(item),current);
  }
  return groups;
}

function compatibleFact(row, fact) {
  const refund = fact.kind==='refund' || fact.kind==='reversal';
  const validType = row.direction===fact.kind || (row.direction!=='refund' && fact.kind==='transfer')
    || (row.direction==='refund' && refund);
  return fact.subject===row.subject && validType && sameMoney(row,fact) && currencyCertain(row)
    && [fact.provider,fact.account,fact.reference].every(value => typeof value==='string' && value.trim().length>0)
    && /^[a-f0-9]{64}$/.test(fact.digest)
    && (refund ? !!fact.parent && fact.parent!==fact.reference : !fact.parent);
}

export async function reconcileMergeFinance(snapshot, keep) {
  const { transactions, evidence, lifecycle, authority } = snapshot;
  if (transactions.length>limit || evidence.length>1000 || lifecycle.length>1000) return null;
  const rawById = groupBy(evidence, row=>row.transaction);
  const lifecycleById = groupBy(lifecycle, row=>row.transaction);
  const authoritative = new Map(authority.map(item=>[item.transaction,item]));
  const conflicts = new Map();
  const rows = transactions.map(row => {
    const proof = authoritative.get(row.id);
    return { ...row, raw:rawById.get(row.id) ?? [], lifecycle:lifecycleById.get(row.id) ?? [],
      proof:proof && compatibleFact(row,proof) ? proof : null, invalidProof:!!proof && !compatibleFact(row,proof),
      canonical:idOf(row), refundOf:null };
  });
  const included = rows.filter(active);
  const addConflict = (kind, members) => {
    const refs = members.map(idOf).sort();
    conflicts.set(JSON.stringify([kind,refs]),{ kind, refs });
  };
  const strong = groupBy(included.filter(row=>row.proof), row=>keyOf(row.proof));
  for (const group of strong.values()) {
    const [first] = group;
    if (!group.every(row=>sameMoney(first,row) && first.direction===row.direction
      && first.proof.kind===row.proof.kind && first.proof.parent===row.proof.parent)) {
      addConflict('AUTHORITY_MISMATCH',group);
      continue;
    }
    const canonical = group.find(row=>row.subject===keep) ?? first;
    for (const row of group) row.canonical = idOf(canonical);
  }
  const canonicalLines = included.filter(row=>row.canonical===idOf(row));
  const refundFamilies = new Map();
  for (const row of canonicalLines) {
    if (row.invalidProof) addConflict('AUTHORITY_MISMATCH',[row]);
    if (!currencyCertain(row)) addConflict('CURRENCY_UNVERIFIED',[row]);
    if (['review','pending'].includes(row.reviewState)) addConflict('SOURCE_PENDING',[row]);
    if (row.direction!=='refund') continue;
    const parentKey = row.proof && keyOf({...row.proof,reference:row.proof.parent});
    const parents = parentKey ? strong.get(parentKey) ?? [] : [];
    const original = parents.find(candidate=>candidate.canonical===idOf(candidate));
    if (!original || parents.some(candidate=>candidate.canonical!==idOf(original))
      || original.proof.kind!=='expense' || row.currency!==original.currency || row.exponent!==original.exponent) {
      addConflict('REFUND_LINK_UNVERIFIED',[row,...parents]);
      continue;
    }
    row.refundOf = idOf(original);
    const linked = refundFamilies.get(original) ?? [];
    linked.push(row);
    refundFamilies.set(original,linked);
  }
  for (const [original, refunds] of refundFamilies) {
    const total = refunds.reduce((sum,row)=>sum+BigInt(row.amount),0n);
    if (total>BigInt(original.amount)) addConflict('REFUND_AMOUNT_MISMATCH',[original,...refunds]);
    for (const refund of refunds) {
      for (const row of included) if (row.canonical===refund.canonical) row.refundOf = refund.refundOf;
    }
  }

  const observed = row => new Set([
    ...row.raw.filter(link=>link.relation==='active' && link.reference).map(link=>link.reference),
    ...row.lifecycle.filter(link=>!link.excluded && link.reference).map(link=>link.reference),
  ]);
  const references = new Map(included.map(row=>[row,observed(row)]));
  for (const [index, left] of included.entries()) {
    for (const right of included.slice(index+1)) {
      if (left.subject===right.subject || left.canonical===right.canonical) continue;
      const bothProven = left.proof && right.proof;
      const sameProviderAccount = bothProven && left.proof.provider===right.proof.provider && left.proof.account===right.proof.account;
      const differentOperations = sameProviderAccount && left.proof.reference!==right.proof.reference;
      if (differentOperations) continue;
      const sharedReference = [...references.get(left)].some(ref=>references.get(right).has(ref))
        || (bothProven && left.proof.reference===right.proof.reference);
      if (sharedReference) {
        addConflict('UNVERIFIED_SHARED_REFERENCE',[left,right]);
      } else if (sameMoney(left,right) || left.occurred===right.occurred || sameNamedParty(left,right)) {
        addConflict('POSSIBLE_DUPLICATE_OR_TRANSFER',[left,right]);
      }
      if (conflicts.size>300) return null;
    }
  }

  const review = await Promise.all([...conflicts.entries()].map(async ([key, conflict])=>({
    ...conflict, id:await sha256Hex(key), digest:await sha256Hex(JSON.stringify(
      rows.filter(row=>conflict.refs.includes(idOf(row))),
    )),
  })));
  const totals = new Map();
  for (const row of canonicalLines.filter(currencyCertain)) {
    const kind = row.proof?.kind ?? 'UNCLASSIFIED_'+row.direction.toUpperCase();
    const key = JSON.stringify([row.currency,row.exponent,kind]);
    totals.set(key,(totals.get(key) ?? 0n)+BigInt(row.amount));
  }
  return {
    receipts:rows.map(row=>({ kind:'FINANCE',subject:row.subject,id:row.id,canonical:row.canonical,
      payload:{ id:row.id, subject:row.subject, device:row.device, currency:row.currency, amount:row.amount,
        exponent:row.exponent, ledgerDirection:row.direction, kind:row.proof?.kind ?? 'UNCLASSIFIED_'+row.direction.toUpperCase(),
        occurred:row.occurred, posted:row.posted, revision:row.revision, syncVersion:row.syncVersion,
        source:row.source, batch:row.batch || null, status:row.status, superseded:row.superseded || null,
        raw:row.raw, lifecycle:row.lifecycle, authority:row.proof, refundOf:row.refundOf } })),
    review,
    summary:{ originals:rows.length, active:included.length, distinct:canonicalLines.length,
      duplicates:included.length-canonicalLines.length, archived:rows.length-included.length,
      totals:[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([key,total])=>[...JSON.parse(key),total.toString()]) },
  };
}
