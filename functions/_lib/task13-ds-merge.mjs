// Task 13 grants and overrides are the authority. This adapter produces a
// reversible merge projection for the retained DS account, without fulfillment.
export const mergeMembershipQueries = {
  memberships: `SELECT json_object('subject',m.user_id,'id',m.id,'plan',m.plan_code,
    'starts',m.starts_at,'expires',m.expires_at,'lifetime',m.is_lifetime,'state',m.status,
    'source',m.source,'reference',m.source_ref,'updated',m.updated_at,'order',(
      SELECT payment_order_id FROM task13_payment_fulfillments f WHERE f.user_membership_id=m.id LIMIT 1
    ),'entitlements',json((SELECT json_group_array(entitlement_code) FROM (
      SELECT entitlement_code FROM task13_membership_entitlements p WHERE p.plan_code=m.plan_code ORDER BY entitlement_code
    ))),'language',CASE WHEN m.plan_code='trial_single_language' AND json_valid(m.metadata_json)
      THEN json_extract(m.metadata_json,'$.language') ELSE NULL END) AS value
    FROM task13_user_memberships m WHERE m.user_id IN (SELECT value FROM json_each(?))
    ORDER BY m.user_id,m.id LIMIT 251`,
  overrides: `SELECT json_object('subject',user_id,'entitlement',entitlement_code,'allowed',allowed,
    'updated',updated_at) AS value FROM task13_user_entitlement_overrides
    WHERE user_id IN (SELECT value FROM json_each(?)) ORDER BY user_id,entitlement_code LIMIT 251`,
};

function membershipState(row, now) {
  if (row.state!=='active') return row.state.toUpperCase();
  const start = Date.parse(row.starts);
  const expires = row.lifetime ? Infinity : Date.parse(row.expires);
  if (Number.isNaN(start) || Number.isNaN(expires) || expires<=start) return 'NEEDS_REVIEW';
  if (expires<=now) return 'EXPIRED';
  return start>now ? 'SCHEDULED' : 'ACTIVE';
}

export function preserveMergeMembership(snapshot, keep, now) {
  if (snapshot.memberships.length>250 || snapshot.overrides.length>250) return null;
  const denied = new Set(snapshot.overrides.filter(row=>!row.allowed)
    .map(row=>JSON.stringify([row.subject,row.entitlement])));
  const coverage = new Map();
  const receipts = snapshot.memberships.map(row=>{
    const state = membershipState(row,now);
    const entitlements = new Set(row.entitlements);
    if (['english','japanese'].includes(row.language)) entitlements.add('language_'+row.language+'_access');
    const effective = [...entitlements].filter(code=>!denied.has(JSON.stringify([row.subject,code]))
      && !denied.has(JSON.stringify([keep,code]))).sort();
    if (state==='ACTIVE') {
      for (const code of effective) {
        const expiry = row.lifetime ? null : new Date(row.expires).toISOString();
        if (!coverage.has(code) || (coverage.get(code)!==null && (expiry===null || expiry>coverage.get(code)))) {
          coverage.set(code,expiry);
        }
      }
    }
    return { kind:'MEMBERSHIP',subject:row.subject,id:row.id,canonical:row.id,
      payload:{ ...row, state, preserved:effective } };
  });
  return { receipts, summary:{ originalGrants:receipts.length,
    archived:receipts.filter(row=>row.payload.state!=='ACTIVE').length,
    needsReview:receipts.filter(row=>row.payload.state==='NEEDS_REVIEW').length,
    coverage:[...coverage].sort(([a],[b])=>a.localeCompare(b)).map(([code,expiresAt])=>({code,expiresAt})) } };
}
