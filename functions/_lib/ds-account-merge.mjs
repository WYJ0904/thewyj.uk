import { featureFlags, sha256Hex } from './cloudflare-foundation.mjs';
import { reconcileMergeFinance, mergeFinanceQueries } from './ds-merge-finance.mjs';
import { activeOwnershipQuery } from './ds-ownership.mjs';
import { opaque, unixTime } from './ds-native-crypto.mjs';
import { liveNativeGrant, liveNativeGrants } from './ds-native-store.mjs';
import { mergeMembershipQueries, preserveMergeMembership } from './task13-ds-merge.mjs';
import { ensureTask13Schema } from './task13-service.mjs';
import { ensureTask16Schema } from './task16-service.mjs';
import { Task12Error, accountRole } from './task12-model.mjs';
import { securityRate } from './task27-auth.mjs';
import { POLICY_VERSIONS } from './task27-policy.mjs';
import { first, rows, stmt } from './task27-store.mjs';

export const mergeOperations = new Set([
  'merge09_inspect','merge09_register','merge09_scope','merge09_consent','merge09_withdraw','merge09_status',
  'merge09_stage','merge09_commit','merge09_undo','merge09_review_list','merge09_review',
  'eligibility10_verify_merge',
]);
const purpose = 'ds_finance_reconciliation_v1';
const error = (code,status=409) => new Task12Error('Account merge operation rejected',status,code);
const exact = (value,...fields) => Object.keys(value).length===fields.length && fields.every(key=>Object.hasOwn(value,key));
const validRefs = refs => Array.isArray(refs) && refs.length>=1 && refs.length<=16
  && refs.every(opaque) && new Set(refs).size===refs.length;
const bySubject = (a,b) => a.subject<b.subject ? -1 : Number(a.subject!==b.subject);
const columns = `u.id AS subject,u.username AS label,u.role,u.session_version AS sessionVersion,
  sec.version AS securityVersion,sec.mfa_method AS mfa,
  (SELECT role FROM task18_admin_roles WHERE user_id=u.id) AS assigned_admin_role,
  (sec.email_verified_at<>'' AND sec.verified_email<>'') AS verified`;
const snapshotQueries = Object.entries({ ...mergeFinanceQueries,...mergeMembershipQueries })
  .map(([key,sql])=>[key,`SELECT json_group_array(json(value)) AS snapshot FROM (${sql})`]);

async function grantAccount(db,client,sandbox,grant,now,requireFresh=false) {
  if (!opaque(grant)) throw error('session_invalid',401);
  const live = liveNativeGrant(client,grant,now);
  const actor = await first(db,`SELECT ${columns},g.issued_at,g.expires_at FROM aeris_ds_sso_grants g
    JOIN task12_users u ON u.id=g.user_id JOIN task27_security sec ON sec.user_id=u.id
    JOIN aeris_ds_merge_test_accounts m ON m.subject=u.id AND m.sandbox_id=?
    WHERE g.grant_id=? AND EXISTS (${live.sql})`,[sandbox,grant,...live.args]);
  if (!actor || !actor.verified) throw error('merge09_scope_denied',403);
  if (requireFresh && actor.issued_at<now-300) throw error('merge09_fresh_signin_required',403);
  return actor;
}

const versions = ({subject,sessionVersion,securityVersion}) => ({subject,sessionVersion,securityVersion});
const projection = row => ({...versions(row),label:row.label,role:accountRole(row),proofId:row.proofId ?? null});
const scopeMembers = job => JSON.parse(job.members_json);

async function authority(context,client,sandbox,grant,refs,now) {
  if (!validRefs(refs)) throw error('invalid_request',400);
  const { WYJ_DB:db } = context.env;
  const actor = await grantAccount(db,client,sandbox,grant,now);
  const proof = await activeOwnershipQuery(context,client,{grant_id:grant},refs,
    `p.proof_id AS proofId,${columns}`);
  const sources = await rows(db,proof.sql,proof.args);
  const all = [actor,...sources].sort(bySubject);
  if (sources.length!==refs.length || new Set(all.map(row=>row.subject)).size!==all.length) {
    throw error('merge09_proof_changed');
  }
  if (all.some(row=>accountRole(row)!=='user')) throw error('privileged_review_required',403);
  const members = all.map(versions);
  const guard = memberGuard(client,sandbox,grant,proof,refs.length,members,now);
  if (!await first(db,`SELECT 1 AS ok WHERE ${guard.sql}`,guard.args)) throw error('merge09_account_changed');
  return { actor,sources,members,guard };
}

function memberGuard(client,sandbox,grant,proof,proofCount,members,now) {
  const live = liveNativeGrant(client,grant,now);
  const ids = JSON.stringify(members.map(item=>item.subject));
  return { sql:`EXISTS (${live.sql}) AND (SELECT count(*) FROM (${proof.sql}))=?
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) m
      LEFT JOIN task12_users u ON u.id=json_extract(m.value,'$.subject')
      LEFT JOIN task27_security sec ON sec.user_id=u.id
      LEFT JOIN aeris_ds_merge_test_accounts a ON a.subject=u.id AND a.sandbox_id=?
      WHERE a.subject IS NULL OR sec.user_id IS NULL OR u.deleted OR u.banned OR sec.must_change_password
        OR sec.verified_email='' OR sec.email_verified_at='' OR u.role IN ('admin','super_admin')
        OR EXISTS (SELECT 1 FROM task18_admin_roles ar WHERE ar.user_id=u.id AND ar.role='admin')
        OR u.session_version<>json_extract(m.value,'$.sessionVersion')
        OR sec.version<>json_extract(m.value,'$.securityVersion')
    ) AND NOT EXISTS (
      SELECT 1 FROM aeris_ds_ownership_review_cases r WHERE r.expires_at>unixepoch()
        AND r.state IN ('UNDER_REVIEW','MORE_EVIDENCE_REQUIRED')
        AND (r.actor_id IN (SELECT value FROM json_each(?)) OR r.target_id IN (SELECT value FROM json_each(?)))
    )`, args:[...live.args,...proof.args,proofCount,JSON.stringify(members),sandbox,ids,ids] };
}

function consentGuard(client,job,now) {
  const members = scopeMembers(job);
  const live = liveNativeGrants(client,now,{ projection:'g.grant_id,g.user_id' });
  return { sql:`(SELECT count(*) FROM aeris_ds_merge_consents c
    JOIN (${live.sql}) live ON live.grant_id=c.grant_id AND live.user_id=c.subject
    WHERE c.merge_id=? AND c.version=? AND c.purpose=? AND c.revoked_at IS NULL AND c.expires_at>unixepoch()
      AND c.subject IN (SELECT value FROM json_each(?))
  )=?`, args:[...live.args,job.id,job.version,purpose,JSON.stringify(members.map(item=>item.subject)),members.length] };
}

async function load(db,client,sandbox,id,version) {
  const job = await first(db,`SELECT * FROM aeris_ds_merges WHERE id=?
    AND issuer=? AND client_origin=? AND sandbox_id=?`,[id,client.issuer,client.origin,sandbox]);
  if (!job || (version && version!==job.version)) throw error('merge09_scope_denied',403);
  return job;
}

async function register(context,client,sandbox,grant,input,now) {
  const { id,version,refs,keep,config } = input;
  if (!exact(input,'id','version','refs','keep','config') || !opaque(version)) throw error('invalid_request',400);
  const { WYJ_DB:db } = context.env;
  const auth = await authority(context,client,sandbox,grant,refs,now);
  if (![keep,config].every(subject=>auth.members.some(item=>item.subject===subject))) throw error('merge09_account_changed');
  const members = JSON.stringify(auth.members);
  await stmt(db,`INSERT INTO aeris_ds_merges(id,version,issuer,client_origin,sandbox_id,actor_id,keep_id,config_id,members_json)
    SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM aeris_ds_merge_aborts WHERE id=?)
      AND ${auth.guard.sql} ON CONFLICT(id) DO NOTHING`,
  [id,version,client.issuer,client.origin,sandbox,auth.actor.subject,keep,config,members,id,...auth.guard.args]).run();
  const saved = await load(db,client,sandbox,id,version);
  if (saved.actor_id!==auth.actor.subject || saved.keep_id!==keep || saved.config_id!==config ||
    saved.members_json!==members || saved.state==='COMPENSATED') throw error('merge09_account_changed');
  return { registered:true };
}

async function selfConsent(db,client,job,actor,grant,op,now) {
  if (accountRole(actor)!=='user' || !scopeMembers(job).some(item=>item.subject===actor.subject
    && item.securityVersion===actor.securityVersion && item.sessionVersion===actor.sessionVersion)
    || job.state==='COMPENSATED') throw error('merge09_scope_denied',403);
  if (op==='merge09_scope') {
    const keep = await first(db,'SELECT username FROM task12_users WHERE id=?',[job.keep_id]);
    const recorded = await first(db,`SELECT expires_at AS expiresAt FROM aeris_ds_merge_consents
      WHERE merge_id=? AND subject=? AND revoked_at IS NULL AND expires_at>unixepoch()`,[job.id,actor.subject]);
    return { id:job.id,version:job.version,keep:keep.username,subject:actor.label,
      purpose,state:job.state,expiresAt:recorded?.expiresAt ?? null };
  }
  if (op==='merge09_withdraw') {
    const live = liveNativeGrant(client,grant,now);
    await stmt(db,`UPDATE aeris_ds_merge_consents SET revoked_at=unixepoch()
      WHERE merge_id=? AND subject=? AND revoked_at IS NULL AND EXISTS(${live.sql})`,
    [job.id,actor.subject,...live.args]).run();
    return { withdrawn:true };
  }
  if (job.state==='COMMITTED') throw error('merge09_already_committed');
  const live = liveNativeGrant(client,grant,now);
  const expires = Math.min(now+600,actor.expires_at);
  const consent = await first(db,`INSERT INTO aeris_ds_merge_consents(merge_id,subject,version,purpose,grant_id,created_at,expires_at)
    SELECT id,?,version,?,?,?,? FROM aeris_ds_merges
    WHERE id=? AND state IN ('REGISTERED','STAGED') AND unixepoch()<? AND EXISTS(${live.sql})
    ON CONFLICT(merge_id,subject) DO UPDATE SET grant_id=excluded.grant_id,created_at=excluded.created_at,
      expires_at=excluded.expires_at,revoked_at=NULL RETURNING expires_at AS expiresAt`,
  [actor.subject,purpose,grant,now,expires,job.id,expires,...live.args]);
  if (!consent) throw error('merge09_account_changed');
  return { consented:true,...consent };
}

function safeSummary(job,conflicts=[]) {
  const summary = job.summary_json ? JSON.parse(job.summary_json) : null;
  if (!summary) return { state:job.state,digest:null,finance:null,membership:null,conflicts };
  const { totals: _privateAmounts,...finance } = summary.finance;
  const membership = { ...summary.membership, coverage:summary.membership.coverage.filter(
    item=>item.expiresAt===null || Date.parse(item.expiresAt)>Date.now(),
  ) };
  return { state:job.state,digest:job.snapshot_digest,finance,membership,conflicts };
}

async function conflictSummary(db,job) {
  return rows(db,`SELECT id,kind,state,blocking,suggestion,decision,reviewed_at AS reviewedAt
    FROM aeris_ds_merge_conflicts WHERE merge_id=? ORDER BY id`,[job.id]);
}

async function financeStatus(db,client,job,now) {
  const guard = consentGuard(client,job,now);
  const allConsented = !!await first(db,`SELECT 1 AS ok WHERE ${guard.sql}`,guard.args);
  return { ...safeSummary(job,await conflictSummary(db,job)),allConsented };
}

async function snapshot(db,job,guard) {
  const ids = JSON.stringify(scopeMembers(job).map(item=>item.subject));
  const data = await db.batch([
    stmt(db,`SELECT 1 AS ok WHERE ${guard.sql}`,guard.args),
    ...snapshotQueries.map(([,query])=>stmt(db,`${query} HAVING count(*)>=0 AND (${guard.sql})`,[ids,...guard.args])),
  ]);
  if (!data[0].results.length || data.slice(1).some(result=>!result.results.length)) throw error('merge09_authority_or_consent_changed');
  const serialized = data.slice(1).map(({results:[row]})=>row.snapshot);
  return { serialized,ids, values:Object.fromEntries(snapshotQueries.map(([key],index)=>[key,JSON.parse(serialized[index])])) };
}

function unchanged({serialized,ids}) {
  return {
    sql:snapshotQueries.map(([,query])=>`(${query})=?`).join(' AND '),
    args:serialized.flatMap(value=>[ids,value]),
  };
}

async function stageOrCommit(context,client,sandbox,job,grant,input,now,isCommit) {
  const { WYJ_DB:db } = context.env;
  const auth = await authority(context,client,sandbox,grant,input.refs,now);
  if (job.actor_id!==auth.actor.subject || job.members_json!==JSON.stringify(auth.members)) throw error('merge09_account_changed');
  if (job.state==='COMPENSATED') throw error('merge09_already_compensated');
  const consent = consentGuard(client,job,now);
  const guard = { sql:`${auth.guard.sql} AND ${consent.sql}`,args:[...auth.guard.args,...consent.args] };
  if (!await first(db,`SELECT 1 AS ok WHERE ${guard.sql}`,guard.args)) throw error('merge09_authority_or_consent_changed');
  if (job.state==='COMMITTED') return safeSummary(job,await conflictSummary(db,job));
  const flags = featureFlags(context.env);
  if (!flags.task13CloudReads || !flags.task16CloudReads || !await ensureTask13Schema(db) || !await ensureTask16Schema(db)) {
    throw error('merge09_ledger_unavailable',503);
  }
  const before = await snapshot(db,job,guard);
  const [finance,membership] = await Promise.all([
    reconcileMergeFinance(before.values,job.keep_id),
    preserveMergeMembership(before.values,job.keep_id,Date.now()),
  ]);
  if (!finance || !membership) throw error('merge09_scope_limit');
  if (membership.summary.needsReview) throw error('merge09_membership_review_required');
  const digest = await sha256Hex(JSON.stringify([before.serialized,membership.receipts.map(row=>row.payload.state)]));
  if (job.snapshot_digest && job.snapshot_digest!==digest) throw error('merge09_data_changed');
  const stable = unchanged(before);
  if (isCommit) {
    const saved = await first(db,`UPDATE aeris_ds_merges SET state='COMMITTED',changed_at=unixepoch()
      WHERE id=? AND state='STAGED' AND snapshot_digest=? AND ${guard.sql} AND ${stable.sql}
        AND NOT EXISTS (SELECT 1 FROM aeris_ds_merge_conflicts WHERE merge_id=? AND blocking=1 AND state='NEEDS_REVIEW')
      RETURNING *`,[job.id,digest,...guard.args,...stable.args,job.id]);
    const current = saved ?? await load(db,client,sandbox,job.id,job.version);
    if (current.state==='COMMITTED' && current.snapshot_digest===digest) return safeSummary(current,await conflictSummary(db,job));
    if ((await conflictSummary(db,job)).some(item=>item.state==='NEEDS_REVIEW' && item.blocking)) throw error('merge09_finance_review_required');
    throw error('merge09_data_or_authority_changed');
  }
  if (job.state==='REGISTERED') {
    const receipts = JSON.stringify([...finance.receipts,...membership.receipts]);
    const review = JSON.stringify(finance.review);
    const [updated] = await db.batch([
      stmt(db,`UPDATE aeris_ds_merges SET state='STAGED',snapshot_digest=?,summary_json=?,changed_at=unixepoch()
        WHERE id=? AND state='REGISTERED' AND ${guard.sql} AND ${stable.sql} RETURNING id`,
      [digest,JSON.stringify({finance:finance.summary,membership:membership.summary}),job.id,...guard.args,...stable.args]),
      stmt(db,`INSERT INTO aeris_ds_merge_receipts(merge_id,kind,subject,original_id,canonical_id,payload_json)
        SELECT ?,j.value->>'$.kind',j.value->>'$.subject',j.value->>'$.id',j.value->>'$.canonical',j.value->'$.payload'
        FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM aeris_ds_merges WHERE id=? AND state='STAGED' AND snapshot_digest=?)
        ON CONFLICT DO NOTHING`,[job.id,receipts,job.id,digest]),
      stmt(db,`INSERT INTO aeris_ds_merge_conflicts(merge_id,id,kind,source_refs,evidence_digest,blocking,suggestion)
        SELECT ?,j.value->>'$.id',j.value->>'$.kind',j.value->'$.refs',j.value->>'$.digest',1,'KEEP_DISTINCT_OR_STOP'
        FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM aeris_ds_merges WHERE id=? AND state='STAGED' AND snapshot_digest=?)
        ON CONFLICT DO NOTHING`,[job.id,review,job.id,digest]),
    ]);
    if (updated.results.length!==1) {
      const current = await load(db,client,sandbox,job.id,job.version);
      if (!['STAGED','COMMITTED'].includes(current.state) || current.snapshot_digest!==digest) throw error('merge09_data_or_authority_changed');
    }
  }
  const current = await load(db,client,sandbox,job.id,job.version);
  if (!['STAGED','COMMITTED'].includes(current.state) || current.snapshot_digest!==digest) throw error('merge09_data_or_authority_changed');
  return safeSummary(current,await conflictSummary(db,job));
}

async function undo(db,client,sandbox,{id,version}) {
  const [aborted] = await db.batch([
    stmt(db,`INSERT INTO aeris_ds_merge_aborts(id,version,sandbox_id) SELECT ?,?,?
      WHERE NOT EXISTS (SELECT 1 FROM aeris_ds_merges WHERE id=?
        AND (version<>? OR sandbox_id<>? OR issuer<>? OR client_origin<>?))
      ON CONFLICT(id) DO UPDATE SET id=excluded.id
      WHERE version=excluded.version AND sandbox_id=excluded.sandbox_id RETURNING id`,
    [id,version,sandbox,id,version,sandbox,client.issuer,client.origin]),
    stmt(db,`UPDATE aeris_ds_merges SET state='COMPENSATED',changed_at=unixepoch()
      WHERE id=? AND version=? AND sandbox_id=? AND issuer=? AND client_origin=? AND state<>'COMPENSATED'
        AND EXISTS(SELECT 1 FROM aeris_ds_merge_aborts WHERE id=? AND version=? AND sandbox_id=?)`,
    [id,version,sandbox,client.issuer,client.origin,id,version,sandbox]),
  ]);
  if (aborted.results.length!==1) throw error('merge09_scope_denied',403);
  return { state:'COMPENSATED' };
}

async function review(db,client,job,actor,grant,input,now,writing) {
  if (accountRole(actor)==='user' || actor.mfa!=='totp' || scopeMembers(job).some(item=>item.subject===actor.subject)) {
    throw error('merge09_scope_denied',403);
  }
  const live = liveNativeGrant(client,grant,now);
  const consent = consentGuard(client,job,now);
  const guard = `EXISTS(${live.sql}) AND ${consent.sql} AND EXISTS (
    SELECT 1 FROM aeris_ds_merge_reviewers r JOIN task12_users u ON u.id=r.reviewer_id
    WHERE r.merge_id=? AND r.reviewer_id=? AND r.revoked_at IS NULL
      AND (u.role IN ('admin','super_admin') OR EXISTS (SELECT 1 FROM task18_admin_roles ar WHERE ar.user_id=u.id AND ar.role='admin'))
  ) AND EXISTS (SELECT 1 FROM aeris_ds_merges WHERE id=? AND state='STAGED')`;
  const args = [...live.args,...consent.args,job.id,actor.subject,job.id];
  if (!await first(db,`SELECT 1 AS ok WHERE ${guard}`,args)) throw error('merge09_scope_denied',403);
  if (writing) {
    const item = await first(db,`UPDATE aeris_ds_merge_conflicts
      SET state='REVIEWED',decision='KEEP_DISTINCT',reviewer_id=?,reason=?,reviewed_at=unixepoch()
      WHERE merge_id=? AND id=? AND state='NEEDS_REVIEW' AND ${guard} RETURNING id`,
    [actor.subject,input.reason,job.id,input.conflict,...args]);
    if (!item) throw error('merge09_review_changed');
    return { reviewed:true };
  }
  const conflicts = await rows(db,`SELECT c.id,c.kind,c.state,c.blocking,c.suggestion,c.decision,
    c.evidence_digest AS evidenceDigest,c.reviewed_at AS reviewedAt,c.source_refs AS originalRefs,
    (SELECT json_group_array(json(line)) FROM (
      SELECT json_object('id',r.original_id,'amount',r.payload_json->>'$.amount',
        'currency',r.payload_json->>'$.currency','exponent',r.payload_json->>'$.exponent') AS line
      FROM json_each(c.source_refs) s JOIN aeris_ds_merge_receipts r ON r.merge_id=c.merge_id
        AND r.kind='FINANCE' AND r.subject=s.value->>0 AND r.original_id=s.value->>1
      ORDER BY r.subject,r.original_id LIMIT 5
    )) AS lines
    FROM aeris_ds_merge_conflicts c WHERE c.merge_id=? AND ${guard} ORDER BY c.id`,[job.id,...args]);
  return { conflicts:conflicts.map(({lines,...item})=>({...item,evidence:JSON.parse(lines)})) };
}

async function verifyCommittedMerge(db, client, sandbox, grant, input, now) {
  const { id, version } = input;
  if (!exact(input, 'id', 'version') || !opaque(id) || !opaque(version) || !opaque(grant)) {
    throw error('invalid_request', 400);
  }
  const keeper = liveNativeGrants(client, now, {
    condition: 'g.grant_id=?',
    args: [grant],
    projection: 'g.user_id',
  });
  // Check the committed journal and current identity/review state in one primary D1 read.
  const job = await first(db, `WITH scope AS (
    SELECT j.* FROM aeris_ds_merges j
    WHERE j.id=? AND j.version=? AND j.issuer=? AND j.client_origin=? AND j.sandbox_id=?
      AND j.state='COMMITTED' AND j.keep_id IN (${keeper.sql})
  ), members AS (
    SELECT j.id, json_extract(m.value,'$.subject') AS subject,
      json_extract(m.value,'$.sessionVersion') AS session_version,
      json_extract(m.value,'$.securityVersion') AS security_version
    FROM scope j CROSS JOIN json_each(j.members_json) m
  )
  SELECT j.id,j.version,j.issuer,j.keep_id,j.members_json,j.snapshot_digest FROM scope j
  WHERE NOT EXISTS (SELECT 1 FROM aeris_ds_merge_aborts a WHERE a.id=j.id)
    AND (SELECT count(*) FROM aeris_ds_merge_events e
      WHERE e.merge_id=j.id AND e.kind='COMMITTED' AND e.detail=j.snapshot_digest AND e.occurred_at=j.changed_at)=1
    AND NOT EXISTS (SELECT 1 FROM aeris_ds_merge_events e WHERE e.merge_id=j.id AND e.kind='COMPENSATED')
    AND (SELECT count(DISTINCT subject) FROM members)=json_array_length(j.members_json)
    AND (SELECT count(DISTINCT subject) FROM members WHERE subject IN (j.keep_id,j.actor_id,j.config_id))=
      (SELECT count(DISTINCT value) FROM json_each(json_array(j.keep_id,j.actor_id,j.config_id)))
    AND NOT EXISTS (
      SELECT 1 FROM members m
      LEFT JOIN task12_users u ON u.id=m.subject
      LEFT JOIN task27_security sec ON sec.user_id=u.id
      LEFT JOIN aeris_ds_merge_test_accounts sandbox_account
        ON sandbox_account.subject=u.id AND sandbox_account.sandbox_id=j.sandbox_id
      LEFT JOIN aeris_ds_merge_consents c
        ON c.merge_id=j.id AND c.subject=u.id AND c.version=j.version AND c.purpose=?
        AND c.created_at<=j.changed_at AND c.expires_at>j.changed_at AND c.revoked_at IS NULL
      WHERE sandbox_account.subject IS NULL OR sec.user_id IS NULL OR c.subject IS NULL
        OR u.deleted OR u.banned OR sec.must_change_password OR sec.verified_email='' OR sec.email_verified_at=''
        OR u.role IN ('admin','super_admin') OR EXISTS (
          SELECT 1 FROM task18_admin_roles ar WHERE ar.user_id=u.id AND ar.role='admin'
        )
        OR u.session_version IS NOT m.session_version OR sec.version IS NOT m.security_version
        OR EXISTS (SELECT 1 FROM aeris_ds_ownership_recovery_holds h WHERE h.user_id=u.id)
        OR (
          EXISTS (SELECT 1 FROM task12_metadata WHERE key='task27_require_policy_reaccept' AND value='1')
          AND NOT EXISTS (
            SELECT 1 FROM task27_policy_consents policy WHERE policy.user_id=u.id
              AND policy.terms_version=? AND policy.privacy_version=? AND policy.security_version=?
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM aeris_ds_ownership_review_cases r
      WHERE r.expires_at>unixepoch() AND r.state IN ('UNDER_REVIEW','MORE_EVIDENCE_REQUIRED')
        AND (r.actor_id IN (SELECT subject FROM members) OR r.target_id IN (SELECT subject FROM members))
    )
    AND json_type(j.summary_json,'$.finance.originals')='integer'
    AND json_type(j.summary_json,'$.membership.originalGrants')='integer'
    AND json_extract(j.summary_json,'$.membership.needsReview')=0
    AND json_extract(j.summary_json,'$.finance.originals')=(
      SELECT count(*) FROM aeris_ds_merge_receipts r WHERE r.merge_id=j.id AND r.kind='FINANCE'
    )
    AND json_extract(j.summary_json,'$.membership.originalGrants')=(
      SELECT count(*) FROM aeris_ds_merge_receipts r WHERE r.merge_id=j.id AND r.kind='MEMBERSHIP'
    )
    AND NOT EXISTS (
      SELECT 1 FROM aeris_ds_merge_receipts r WHERE r.merge_id=j.id
        AND (r.subject NOT IN (SELECT subject FROM members)
          OR (r.kind='MEMBERSHIP' AND r.payload_json->>'$.state'='NEEDS_REVIEW'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM aeris_ds_merge_conflicts c
      WHERE c.merge_id=j.id AND c.blocking=1 AND (
        c.state<>'REVIEWED' OR c.decision<>'KEEP_DISTINCT' OR c.reviewed_at>j.changed_at
        OR c.reviewer_id IN (SELECT subject FROM members)
        OR NOT EXISTS (
          SELECT 1 FROM aeris_ds_merge_reviewers r
          JOIN task12_users u ON u.id=r.reviewer_id AND u.deleted=0 AND u.banned=0
          JOIN task27_security sec ON sec.user_id=u.id AND sec.mfa_method='totp' AND sec.must_change_password=0
          WHERE r.merge_id=j.id AND r.reviewer_id=c.reviewer_id AND r.revoked_at IS NULL
            AND r.assigned_at<=c.reviewed_at AND (u.role IN ('admin','super_admin') OR EXISTS (
              SELECT 1 FROM task18_admin_roles ar
              WHERE ar.user_id=u.id AND ar.role='admin' AND unixepoch(ar.granted_at)<=c.reviewed_at
            ))
        )
        OR NOT EXISTS (
          SELECT 1 FROM aeris_ds_merge_events e WHERE e.merge_id=j.id AND e.kind='CONFLICT_REVIEWED'
            AND e.actor_id=c.reviewer_id AND e.detail=c.id AND e.occurred_at=c.reviewed_at
        )
      )
    )`, [id, version, client.issuer, client.origin, sandbox, ...keeper.args, purpose,
    POLICY_VERSIONS.terms, POLICY_VERSIONS.privacy, POLICY_VERSIONS.security]);
  if (!job || !/^[0-9a-f]{64}$/.test(job.snapshot_digest)) throw error('eligibility10_merge_invalid');
  return {
    id: job.id,
    version: job.version,
    issuer: job.issuer,
    keepSubject: job.keep_id,
    members: JSON.parse(job.members_json).map(versions),
    digest: job.snapshot_digest,
  };
}

export async function handleAccountMerge(context,client,op,input,grant) {
  const { WYJ_DB:db,AERIS_DS_MERGE_SANDBOX:sandbox } = context.env;
  if (op==='eligibility10_verify_merge' && !client.mergeEligibility) throw error('merge09_unavailable',503);
  if (!client.mergeExecution || !opaque(sandbox) || !await first(db,
    'SELECT 1 AS ok FROM aeris_ds_merge_sandbox WHERE sandbox_id=?',[sandbox])) throw error('merge09_unavailable',503);
  if (!featureFlags(context.env).task12CloudAccounts) throw error('merge09_unavailable',503);
  const now = unixTime();
  await securityRate(context,'ds-native-execution',opaque(grant) ? grant : client.clientId,75,60);
  if (op==='eligibility10_verify_merge') return verifyCommittedMerge(db,client,sandbox,grant,input,now);
  if (op==='merge09_inspect') {
    if (!exact(input,'refs')) throw error('invalid_request',400);
    const { actor,sources } = await authority(context,client,sandbox,grant,input.refs,now);
    return { actor:projection(actor),sources:sources.map(projection) };
  }
  if (!opaque(input.id)) throw error('invalid_request',400);
  if (op==='merge09_register') return register(context,client,sandbox,grant,input,now);
  if (op==='merge09_undo') {
    if (!exact(input,'id','version') || !opaque(input.version)) throw error('invalid_request',400);
    return undo(db,client,sandbox,input);
  }
  const own = ['merge09_scope','merge09_consent','merge09_withdraw','merge09_review_list','merge09_review'].includes(op);
  if (own) {
    const writingReview = op==='merge09_review';
    const accepting = op==='merge09_consent';
    const fields = accepting ? ['id','version','purpose','accepted'] :
      writingReview ? ['id','conflict','decision','reason'] : ['id'];
    if (!exact(input,...fields)
      || (accepting && (!opaque(input.version) || input.purpose!==purpose || input.accepted!==true))
      || (writingReview && (!/^[0-9a-f]{64}$/.test(input.conflict) || input.decision!=='KEEP_DISTINCT'
        || typeof input.reason!=='string' || input.reason.trim().length<8 || input.reason.length>240))) throw error('invalid_request',400);
    const actor = await grantAccount(db,client,sandbox,grant,now,accepting || writingReview || op==='merge09_review_list');
    const job = await load(db,client,sandbox,input.id,input.version);
    if (writingReview || op==='merge09_review_list') return review(db,client,job,actor,grant,input,now,writingReview);
    return selfConsent(db,client,job,actor,grant,op,now);
  }
  const status = op==='merge09_status';
  if (!exact(input,...(status ? ['id','version'] : ['id','version','refs'])) || !opaque(input.version)) {
    throw error('invalid_request',400);
  }
  const job = await load(db,client,sandbox,input.id,input.version);
  if (status) {
    const actor = await grantAccount(db,client,sandbox,grant,now);
    if (actor.subject!==job.actor_id) throw error('merge09_scope_denied',403);
    return financeStatus(db,client,job,now);
  }
  return stageOrCommit(context,client,sandbox,job,grant,input,now,op==='merge09_commit');
}
