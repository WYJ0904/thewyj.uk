import { featureFlags } from './cloudflare-foundation.mjs';
import { resolveTask12Account } from './task12-auth.mjs';
import { sessionStorageKey } from './task12-crypto.mjs';
import { Task12Error } from './task12-model.mjs';
import { challengeRow, createChallenge, securityRate, verifyChallenge, verifyPassword } from './task27-auth.mjs';
import { activeUser, first, nowIso, securityState } from './task27-store.mjs';
import { opaque } from './ds-native-crypto.mjs';
import {
  evidenceReference, hasReviewerAuthority, reviewConfigured, reviewError, reviewerProofScope, reviewReady, staffDecision, staffQueue,
} from './ds-ownership-review-store.mjs';

export const reviewerRoute = '/api/admin/ds-ownership-review/v1';
const authenticatingScope = reviewerProofScope + '_auth';
const reasons = new Map([
  ['approve', new Set(['independent_evidence_verified'])],
  ['deny', new Set(['insufficient_evidence', 'conflict'])],
  ['more_evidence', new Set(['additional_evidence_needed'])],
  ['revoke', new Set(['authority_or_evidence_changed'])],
]);
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const ticketClosed = () => reviewError('ownership_reviewer_stepup',403);

function exact(input, fields) {
  return input && typeof input==='object' && !Array.isArray(input)
    && Object.keys(input).length===fields.length && fields.every(key=>Object.hasOwn(input,key));
}

async function liveStaffSession(db, session, user) {
  if (!await first(db,`SELECT 1 FROM task12_sessions WHERE token_digest=? AND user_id=?
      AND revoked=0 AND expires_at>? AND session_version=? AND client_kind!='android_app'`,
  [session,user.id,nowIso(),user.session_version])) throw ticketClosed();
}

export async function handleOwnershipReviewStaff(context, client, readBody) {
  const { request,env } = context;
  const db = env.WYJ_DB;
  const url = new URL(request.url);
  if (!client?.ownershipEnabled || !reviewConfigured(env) || !featureFlags(env).task12CloudAccounts) return json({error:'not_found'},404);
  if (request.method!=='POST') return json({error:'method_not_allowed'},405);
  if (url.search || request.headers.get('Origin')!==url.origin || request.headers.get('X-Aeris-Review')!=='1') {
    return json({error:'forbidden'},403);
  }
  try {
    if (!await reviewReady(db)) return json({error:'ownership_review_unavailable'},503);
    const auth = await resolveTask12Account(context,{touch:false});
    if (!auth.authenticated) return json({error:'authentication_required'},401);
    if (!await hasReviewerAuthority(db,auth.account.id)) return json({error:'ownership_reviewer_forbidden'},403);
    const raw = await readBody(request);
    let input;
    try { input=JSON.parse(raw); } catch { return json({error:'invalid_request'},400); }
    const op = input?.op;
    const reviewer = auth.account.id;
    const session = await sessionStorageKey(auth.token);
    await securityRate(context,'ds-ownership-review-staff',reviewer,45,60);
    if (op==='challenge') {
      if (!exact(input,['op','password']) || typeof input.password!=='string' || input.password.length>256 || !input.password) {
        return json({error:'invalid_request'},400);
      }
      await securityRate(context,'ds-ownership-review-staff-password',reviewer,6,300);
      const user = await verifyPassword(db,env,reviewer,input.password);
      const state = await securityState(db,user.id);
      if (state.mfa_method!=='totp' || state.must_change_password) throw ticketClosed();
      await liveStaffSession(db,session,user);
      const challenge = await createChallenge(db,{user,state,kind:'stepup',method:'totp',sessionDigest:session,scope:authenticatingScope});
      return json({stage:'mfa_required',challenge:challenge.token});
    }
    if (op==='authenticate') {
      if (!exact(input,['op','challenge','code']) || !opaque(input.challenge) || typeof input.code!=='string' || !/^\d{6}$/.test(input.code)) {
        return json({error:'invalid_request'},400);
      }
      const row = await challengeRow(db,input.challenge,'stepup',session);
      if (row.user_id!==reviewer || row.scope!==authenticatingScope || row.method!=='totp') throw ticketClosed();
      const { user,row:verified } = await verifyChallenge(db,env,input.challenge,'stepup',input.code,{sessionDigest:session});
      const currentUser = await activeUser(db,reviewer);
      const currentSecurity = await securityState(db,reviewer);
      if (currentUser.session_version!==verified.session_version || currentSecurity.version!==verified.security_version
        || currentSecurity.mfa_method!=='totp' || currentSecurity.must_change_password
        || !await hasReviewerAuthority(db,reviewer)) throw ticketClosed();
      await liveStaffSession(db,session,currentUser);
      const staff = await createChallenge(db,{user,state:currentSecurity,kind:'grant',method:'totp',sessionDigest:session,scope:reviewerProofScope});
      return json({reviewer_token:staff.token,expires_at:staff.expires_at});
    }
    if (op==='queue' && exact(input,['op','reviewer_token']) && opaque(input.reviewer_token)) {
      return json(await staffQueue(db,reviewer,session,input.reviewer_token,nowIso()));
    }
    if (op==='decide' && exact(input,['op','reviewer_token','review_id','decision','reason_code','evidence_ref'])
      && opaque(input.reviewer_token) && opaque(input.review_id)
      && reasons.get(input.decision)?.has(input.reason_code) && evidenceReference(input.evidence_ref)) {
      return json(await staffDecision(db,client,reviewer,session,input.reviewer_token,input,nowIso()));
    }
    return json({error:'invalid_request'},400);
  } catch (failure) {
    if (failure instanceof Task12Error) return json({error:failure.code},failure.status);
    return json({error:'ownership_review_unavailable'},503);
  }
}
