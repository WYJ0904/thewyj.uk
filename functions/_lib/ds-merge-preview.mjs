import { featureFlags } from './cloudflare-foundation.mjs';
import { opaque, unixTime } from './ds-native-crypto.mjs';
import { liveNativeGrant } from './ds-native-store.mjs';
import { activeOwnershipRows } from './ds-ownership.mjs';
import { Task12Error, accountRole } from './task12-model.mjs';
import { accountMembershipState, ensureTask13Schema } from './task13-service.mjs';
import { securityRate } from './task27-auth.mjs';
import { first } from './task27-store.mjs';

export const mergePreviewOperation = 'merge_preview_accounts';
const accountColumns = `
  u.id, u.username, coalesce(nullif(u.registered_at,''),u.created_at) AS registered_at, u.role,
  (SELECT role FROM task18_admin_roles ar WHERE ar.user_id=u.id) AS assigned_admin_role,
  sec.email_verified_at!='' AND sec.verified_email!='' AS email_verified
`;
const projection = 'p.proof_id, ' + accountColumns;
const error = (code,status) => new Task12Error('Account merge preview unavailable',status,code);

async function currentActor(db,client,grant) {
  const live = liveNativeGrant(client,grant,unixTime());
  return first(db,`SELECT ${accountColumns}
    FROM aeris_ds_sso_grants g JOIN task12_users u ON u.id=g.user_id JOIN task27_security sec ON sec.user_id=u.id
    WHERE g.grant_id=? AND EXISTS(${live.sql})`,[grant,...live.args]);
}

const unavailableMembership = () => ({state:'NEEDS_REVIEW',label:null,expiresAt:null,entitlements:[]});

async function membership(db,row,role,available) {
  if (!available) return unavailableMembership();
  try {
    const active = await accountMembershipState(db,{id:row.id,is_super_admin:role==='super_admin'},{readOnly:true});
    return {
      state:'VERIFIED',
      label:active.membership_summary.label,
      expiresAt:active.membership_summary.expires_at || null,
      entitlements:active.entitlements,
    };
  } catch {
    return unavailableMembership();
  }
}

async function project(db,row,available) {
  const role = accountRole(row);
  return {
    subject:row.id,
    username:row.username,
    registeredAt:row.registered_at,
    role,
    securityEmailVerified:row.email_verified===1,
    membership:await membership(db,row,role,available),
  };
}

function unchanged(before,after) {
  return after && before.id===after.id && before.username===after.username && before.registered_at===after.registered_at
    && accountRole(before)===accountRole(after) && before.email_verified===after.email_verified;
}

export async function handleMergePreview(context, client, input, grant) {
  const { env } = context;
  const flags = featureFlags(env);
  if (!client.mergePreviewEnabled || !flags.task12CloudAccounts) {
    throw error('merge_preview_unavailable',503);
  }
  const refs = input.refs;
  if (Object.keys(input).length!==1 || !Object.hasOwn(input,'refs') || !Array.isArray(refs) || refs.length>16
    || !refs.every(opaque) || new Set(refs).size!==refs.length || !opaque(grant)) {
    throw error('invalid_request',400);
  }

  await securityRate(context,'ds-native-merge-preview',grant,45,60);
  const db = env.WYJ_DB;
  const actor = await currentActor(db,client,grant);
  if (!actor) throw error('session_invalid',401);
  const actorGrant = { grant_id:grant };
  const [targets, available] = await Promise.all([
    activeOwnershipRows(context,client,actorGrant,refs,projection),
    flags.task13CloudReads ? ensureTask13Schema(db).catch(()=>false) : false,
  ]);
  const [actorProfile,sources] = await Promise.all([
    project(db,actor,available),
    Promise.all(targets.map(async row=>({proofId:row.proof_id,...await project(db,row,available)}))),
  ]);

  // Membership scope is exposed only if the same live owner and receipt still
  // authorize the projection after the membership lookups.
  const [liveActor,liveTargets] = await Promise.all([
    currentActor(db,client,grant),
    activeOwnershipRows(context,client,actorGrant,targets.map(row=>row.proof_id),projection),
  ]);
  if (!liveActor) throw error('session_invalid',401);
  if (!unchanged(actor,liveActor)) throw error('merge_preview_changed',409);
  const byId = new Map(liveTargets.map(row=>[row.proof_id,row]));
  return {
    actor:actorProfile,
    sources:sources.filter((row,index)=>unchanged(targets[index],byId.get(row.proofId))),
  };
}
