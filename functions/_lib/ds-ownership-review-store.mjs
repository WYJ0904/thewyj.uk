import { createSessionToken, sessionStorageKey } from './task12-crypto.mjs';
import { Task12Error } from './task12-model.mjs';
import { first, rows, stmt } from './task27-store.mjs';
import { liveNativeGrant } from './ds-native-store.mjs';
import { unixTime } from './ds-native-crypto.mjs';

export const reviewPurpose = 'ds_account_ownership_recovery_review_v1';
const cases = 'aeris_ds_ownership_review_cases';
const reviewers = 'aeris_ds_ownership_reviewers';
const events = 'aeris_ds_ownership_review_events';
const recoveries = 'aeris_ds_ownership_recovery_versions';

export const reviewError = (code, status) => new Task12Error('Ownership review unavailable', status, code);
export const evidenceReference = value => typeof value === 'string' && /^SUP-[A-F0-9]{16,64}$/.test(value);
export const reviewConfigured = env => env.AERIS_DS_OWNERSHIP_REVIEW_ENABLED === 'true';

export async function reviewReady(db) {
  return Boolean(await first(db, "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?", ['aeris_ds_ownership_review_receipts']));
}

export const recoveryTarget = `EXISTS (
  SELECT 1 FROM aeris_ds_ownership_recovery_holds h
  JOIN ${recoveries} r ON r.user_id=h.user_id WHERE h.user_id=u.id
)`;

// Existing role assignments and narrowly scoped finance-presence signals determine
// when a second reviewer is needed. The queue never reads transaction contents.
export const requiredReviewers = `CASE WHEN (
  EXISTS (SELECT 1 FROM task12_users au WHERE au.id IN (c.actor_id,c.target_id) AND au.role IN ('admin','super_admin'))
  OR EXISTS (SELECT 1 FROM task18_admin_roles ar WHERE ar.user_id IN (c.actor_id,c.target_id) AND ar.role='admin')
  OR EXISTS (SELECT 1 FROM task16_finance_transactions f WHERE f.user_id IN (c.actor_id,c.target_id))
  OR EXISTS (SELECT 1 FROM task16_finance_devices fd WHERE fd.user_id IN (c.actor_id,c.target_id))
) THEN 2 ELSE 1 END`;

export const quorum = `(SELECT count(*) FROM ${events} e
  JOIN ${reviewers} a ON a.id=e.authority_id AND a.reviewer_id=e.reviewer_id
  JOIN task12_users ru ON ru.id=e.reviewer_id
  JOIN task27_security rs ON rs.user_id=ru.id
  WHERE e.case_id=c.id AND e.revision=c.revision AND e.kind='approve'
    AND e.reviewer_id NOT IN (c.actor_id,c.target_id)
    AND a.revoked_at IS NULL AND a.case_scope IN ('*',c.id)
    AND ru.deleted=0 AND ru.banned=0 AND rs.must_change_password=0 AND rs.mfa_method='totp'
    AND ru.session_version=e.reviewer_session_version AND rs.version=e.reviewer_security_version
) >= (${requiredReviewers})`;

export const currentRecovery = `
  EXISTS (SELECT 1 FROM ${recoveries} r
    WHERE r.user_id=c.target_id AND r.event_id=c.recovery_event_id AND r.generation=c.recovery_generation)
  AND EXISTS (
    SELECT 1 FROM task12_users tu JOIN task27_security ts ON ts.user_id=tu.id
    WHERE tu.id=c.target_id AND tu.deleted=0 AND tu.banned=0 AND ts.must_change_password=0
      AND tu.session_version=c.target_session_version AND ts.version=c.target_security_version
  )
  AND NOT EXISTS (SELECT 1 FROM aeris_ds_ownership_recovery_holds ah WHERE ah.user_id=c.actor_id)
`;

export function approvedTarget(actor, request, now) {
  return {
    sql: `EXISTS (SELECT 1 FROM ${cases} c
      WHERE c.id=? AND c.actor_id=? AND c.actor_grant=? AND c.ds_user_id=? AND c.ds_scope=?
        AND c.target_id=u.id AND c.state='APPROVED_FOR_REAUTH' AND c.expires_at>? AND c.approval_expires_at>?
        AND ${currentRecovery} AND ${quorum})`,
    args: [request.review_id, actor.sub, actor.grant_id, request.actor_user_id, request.session_digest, now, now],
  };
}

export const reviewedProof = `EXISTS (
  SELECT 1 FROM aeris_ds_ownership_review_receipts rr JOIN ${cases} c ON c.id=rr.case_id
  WHERE rr.proof_id=p.proof_id AND c.actor_grant=p.actor_grant AND c.target_id=u.id
    AND c.state='CLOSED' AND ${currentRecovery} AND ${quorum}
)`;

const caseProjection = `
  c.id, CASE
    WHEN c.state IN ('DENIED','REVOKED','CLOSED') THEN c.state
    WHEN c.expires_at<=unixepoch() OR (c.state='APPROVED_FOR_REAUTH' AND c.approval_expires_at<=unixepoch()) THEN 'EXPIRED'
    WHEN NOT (${currentRecovery}) OR (c.state='APPROVED_FOR_REAUTH' AND NOT (${quorum})) THEN 'REVOKED'
    ELSE c.state
  END AS state, c.requested_at AS requestedAt, c.expires_at AS expiresAt, c.approval_expires_at AS approvalExpiresAt
`;
const ownerPredicate = 'c.actor_id=? AND c.actor_grant=? AND c.ds_user_id=? AND c.ds_scope=?';
const ownerArgs = (actor, input) => [actor.sub, actor.grant_id, input.actor_user_id, input.session_digest];

export async function createReview(db, client, actor, binding, input, targetClause, targetArgs) {
  const now = unixTime();
  const expiry = Math.min(now + 14400, actor.exp);
  if (expiry <= now) throw reviewError('ownership_denied', 403);
  const id = createSessionToken();
  const attempt = await sessionStorageKey(binding);
  const live = liveNativeGrant(client, actor.grant_id, now);
  const result = await first(db, `INSERT INTO ${cases}(
    id,attempt_digest,actor_id,actor_grant,ds_user_id,ds_scope,target_id,target_session_version,target_security_version,
    recovery_event_id,recovery_generation,purpose,state,requested_at,expires_at,changed_at)
    SELECT ?,?,?,?,?,?,u.id,u.session_version,sec.version,r.event_id,r.generation,?,'UNDER_REVIEW',?,?,?
    FROM task12_users u JOIN task27_security sec ON sec.user_id=u.id JOIN ${recoveries} r ON r.user_id=u.id
    WHERE ${targetClause} AND EXISTS(${live.sql})
      AND NOT EXISTS (SELECT 1 FROM aeris_ds_ownership_recovery_holds h WHERE h.user_id=?)
      AND (SELECT count(*) FROM ${cases} c WHERE ${ownerPredicate} AND c.requested_at>?)<8
      AND NOT EXISTS (SELECT 1 FROM ${cases} c WHERE ${ownerPredicate} AND c.target_id=u.id
        AND c.recovery_generation=r.generation AND c.target_session_version=u.session_version
        AND c.target_security_version=sec.version AND c.expires_at>? AND c.state IN ('UNDER_REVIEW','MORE_EVIDENCE_REQUIRED','APPROVED_FOR_REAUTH')
        AND (c.state!='APPROVED_FOR_REAUTH' OR (c.approval_expires_at>? AND ${quorum})))
    ON CONFLICT DO NOTHING RETURNING target_id,
      (SELECT email_verified_at!='' AND lower(trim(verified_email))=? FROM task27_security WHERE user_id=target_id) AS contact_matches`,
  [id,attempt,...ownerArgs(actor,input),reviewPurpose,now,expiry,now,
    ...targetArgs,...live.args,actor.sub,...ownerArgs(actor,input),now-3600,...ownerArgs(actor,input),now,now,input.contact]);
  if (!result) throw reviewError('ownership_denied', 403);
  return { stage:'review_created', target_subject:result.target_id, contact_matches:result.contact_matches===1,
    review:{ id,state:'UNDER_REVIEW',requestedAt:now,expiresAt:expiry,approvalExpiresAt:null } };
}

export async function applicantReviews(db, actor, input) {
  return { reviews: await rows(db, `SELECT ${caseProjection} FROM ${cases} c WHERE ${ownerPredicate}
    ORDER BY c.requested_at DESC,c.id LIMIT 25`, ownerArgs(actor,input)) };
}

export async function cancelReview(db, actor, input) {
  // Also revokes the downstream receipt when DS closes an already-consumed case.
  const result = await first(db, `UPDATE ${cases} AS c SET state='REVOKED',changed_at=unixepoch()
    WHERE c.id=? AND ${ownerPredicate} AND c.state IN ('UNDER_REVIEW','MORE_EVIDENCE_REQUIRED','APPROVED_FOR_REAUTH','CLOSED') RETURNING id`,
  [input.review_id,...ownerArgs(actor,input)]);
  if (!result) throw reviewError('ownership_review_closed',409);
  return { cancelled:true };
}

export async function submitReviewEvidence(db, client, actor, input) {
  const eventId = crypto.randomUUID();
  const now = unixTime();
  const live = liveNativeGrant(client, actor.grant_id, now);
  const result = await db.batch([
    stmt(db,`INSERT INTO ${events}(id,case_id,revision,kind,evidence_digest,occurred_at)
      SELECT ?,c.id,c.revision,'evidence',?,? FROM ${cases} c
      WHERE c.id=? AND ${ownerPredicate} AND c.state='MORE_EVIDENCE_REQUIRED' AND c.expires_at>?
        AND ${currentRecovery} AND EXISTS(${live.sql})`,
    [eventId,await sessionStorageKey(input.evidence_ref),now,input.review_id,...ownerArgs(actor,input),now,...live.args]),
    stmt(db,`UPDATE ${cases} SET state='UNDER_REVIEW',changed_at=? WHERE id=? AND EXISTS (SELECT 1 FROM ${events} WHERE id=?) RETURNING id`,
    [now,input.review_id,eventId]),
  ]);
  if (result[1].results.length!==1) throw reviewError('ownership_review_closed',409);
  return { submitted:true };
}

export const reviewerProofScope = 'ds_ownership_staff_v1';
const reviewerStrongSession = `
  EXISTS (
    SELECT 1 FROM task27_challenges cap
    JOIN task12_users ru ON ru.id=cap.user_id JOIN task27_security rs ON rs.user_id=ru.id
    JOIN task12_sessions ss ON ss.token_digest=cap.session_digest AND ss.user_id=ru.id
    WHERE cap.token_digest=? AND cap.user_id=? AND cap.session_digest=?
      AND cap.kind='grant' AND cap.scope=? AND cap.method='totp' AND cap.consumed_at='' AND cap.expires_at>?
      AND ru.deleted=0 AND ru.banned=0 AND rs.must_change_password=0 AND rs.mfa_method='totp'
      AND ss.revoked=0 AND ss.expires_at>? AND ss.client_kind!='android_app'
      AND ss.session_version=ru.session_version AND cap.session_version=ru.session_version AND cap.security_version=rs.version
  )
`;
const reviewerProofArgs = (digest, actor, session, now) => [digest,actor,session,reviewerProofScope,now,now];

export async function hasReviewerAuthority(db, actor) {
  return Boolean(await first(db,`SELECT 1 FROM ${reviewers} WHERE reviewer_id=? AND revoked_at IS NULL LIMIT 1`,[actor]));
}

export async function staffQueue(db, actor, session, token, nowIso) {
  const digest = await sessionStorageKey(token);
  const proof = reviewerProofArgs(digest,actor,session,nowIso);
  if (!await first(db,`SELECT 1 WHERE ${reviewerStrongSession}`,proof)) throw reviewError('ownership_reviewer_stepup',403);
  return { reviews: await rows(db,`SELECT ${caseProjection}, (${requiredReviewers}) AS requiredReviewers,
    (SELECT count(*) FROM ${events} e WHERE e.case_id=c.id AND e.revision=c.revision AND e.kind='evidence') AS evidenceCount,
    (SELECT json_group_array(evidence_digest) FROM (
      SELECT e.evidence_digest FROM ${events} e WHERE e.case_id=c.id AND e.revision=c.revision AND e.kind='evidence'
      ORDER BY e.occurred_at DESC,e.id LIMIT 8
    )) AS evidenceDigests
    FROM ${cases} c
    WHERE ? NOT IN (c.actor_id,c.target_id) AND c.expires_at>unixepoch()
      AND c.state IN ('UNDER_REVIEW','MORE_EVIDENCE_REQUIRED','APPROVED_FOR_REAUTH','CLOSED')
      AND EXISTS (SELECT 1 FROM ${reviewers} a WHERE a.reviewer_id=? AND a.revoked_at IS NULL AND a.case_scope IN ('*',c.id))
      AND ${reviewerStrongSession}
    ORDER BY c.requested_at,c.id LIMIT 50`,[actor,actor,...proof]).then(items=>items.map(row=>({
      ...row,evidenceDigests:JSON.parse(row.evidenceDigests),
    }))) };
}

export async function staffDecision(db, client, actor, session, token, input, nowIso) {
  const now = unixTime();
  const digest = await sessionStorageKey(token);
  const proof = reviewerProofArgs(digest,actor,session,nowIso);
  if (!await first(db,`SELECT 1 WHERE ${reviewerStrongSession}`,proof)) throw reviewError('ownership_reviewer_stepup',403);
  const c = await first(db,`SELECT c.actor_grant,g.redirect_uri AS origin FROM ${cases} c
    JOIN aeris_ds_sso_grants g ON g.grant_id=c.actor_grant AND g.issuer=? AND g.client_id=?
    WHERE c.id=? AND ? NOT IN (c.actor_id,c.target_id)
    AND EXISTS(SELECT 1 FROM ${reviewers} a WHERE a.reviewer_id=? AND a.revoked_at IS NULL AND a.case_scope IN ('*',c.id))`,
  [client.issuer,client.clientId,input.review_id,actor,actor]);
  if (!c) throw reviewError('ownership_review_closed',409);
  const live = liveNativeGrant({ ...client,origin:c.origin },c.actor_grant,now);
  const eventId = crypto.randomUUID();
  const checks = {
    approve:"c.state='UNDER_REVIEW'",
    deny:"c.state IN ('UNDER_REVIEW','MORE_EVIDENCE_REQUIRED')",
    more_evidence:"c.state='UNDER_REVIEW'",
    revoke:"c.state IN ('APPROVED_FOR_REAUTH','CLOSED')",
  };
  const result = await db.batch([
    stmt(db,`INSERT INTO ${events} (id,case_id,revision,kind,reviewer_id,authority_id,reviewer_session_version,
      reviewer_security_version,reason_code,evidence_digest,occurred_at)
      SELECT ?,c.id,c.revision,?,ru.id, a.id,ru.session_version,rs.version,?,?,? FROM ${cases} c
      JOIN task12_users ru ON ru.id=? JOIN task27_security rs ON rs.user_id=ru.id
      JOIN ${reviewers} a ON a.id=(SELECT ar.id FROM ${reviewers} ar
        WHERE ar.reviewer_id=ru.id AND ar.revoked_at IS NULL AND ar.case_scope IN ('*',c.id)
        ORDER BY ar.case_scope='*',ar.id LIMIT 1)
      WHERE c.id=? AND ru.id NOT IN (c.actor_id,c.target_id) AND c.expires_at>? AND ${checks[input.decision]}
        AND ${currentRecovery} AND ${reviewerStrongSession} AND EXISTS(${live.sql})
      ON CONFLICT DO NOTHING`,
    [eventId,input.decision,input.reason_code,await sessionStorageKey(input.evidence_ref),now,
      actor,input.review_id,now,...proof,...live.args]),
    stmt(db,`UPDATE ${cases} AS c SET state=CASE ?
      WHEN 'deny' THEN 'DENIED' WHEN 'more_evidence' THEN 'MORE_EVIDENCE_REQUIRED' WHEN 'revoke' THEN 'REVOKED'
      WHEN 'approve' THEN CASE WHEN ${quorum} THEN 'APPROVED_FOR_REAUTH' ELSE 'UNDER_REVIEW' END END,
      revision=c.revision+CASE WHEN ?='more_evidence' THEN 1 ELSE 0 END,
      approval_expires_at=CASE WHEN ?='approve' AND ${quorum} THEN min(?,c.expires_at) ELSE NULL END,
      changed_at=?
      WHERE c.id=? AND EXISTS(SELECT 1 FROM ${events} WHERE id=?) RETURNING id,state`,
    [input.decision,input.decision,input.decision,now+300,now,input.review_id,eventId]),
  ]);
  if (!result[1].results.length) throw reviewError('ownership_review_closed',409);
  return { review: result[1].results[0] };
}
