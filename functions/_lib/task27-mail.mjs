import { cleanBodyText, cleanSingleLineText, DEFAULT_FROM_EMAIL, DEFAULT_REPLY_TO_EMAIL, sendTransactionalEmail } from './email-service.mjs';
import { sessionStorageKey } from './task12-crypto.mjs';
import { isAdminAccount, isOwnerAccount } from './task12-model.mjs';
import { authorize, identity } from './task27-security.mjs';
import { challengeAssertion, challengeIdentity, challengeRow, createChallenge, securityRate } from './task27-auth.mjs';
import { assertion, atomic, changed, fail, first, nowIso, rows, run, stmt } from './task27-store.mjs';

const mask=email=>email.replace(/^(.{1,2})[^@]*@/,'$1…@');
async function recipients(db,ids) {
  if (!Array.isArray(ids) || ids.length<1 || ids.length>20 || new Set(ids).size!==ids.length || ids.some(id=>typeof id!=='string'||!id||id.length>80||/[\u0000-\u001f\u007f]/u.test(id))) fail('mail_recipients_invalid','请选择 1 至 20 个已验证邮箱的账户');
  const values=await rows(db,`SELECT u.id,u.username,s.verified_email FROM task12_users u JOIN task27_security s ON s.user_id=u.id
    WHERE u.id IN (${ids.map(()=>'?').join(',')}) AND u.deleted=0 AND u.banned=0 AND s.verified_email!='' AND s.email_verified_at!=''`,ids);
  if (values.length!==ids.length) fail('mail_recipient_unavailable','部分收件用户没有可用的已验证邮箱',409);
  return values.sort((a,b)=>a.id.localeCompare(b.id));
}
async function draftFor(db,actor,id) {
  if (typeof id!=='string'||id.length>80) fail('mail_draft_invalid','邮件草稿无效');
  const draft=await first(db,'SELECT * FROM task27_email_drafts WHERE id=?1',[id]);
  if (!draft || (draft.actor_user_id!==actor.id && !isOwnerAccount(actor))) fail('mail_draft_not_found','邮件草稿不存在',404);
  return draft;
}
function publicDraft(draft) { return {...draft,recipient_ids:JSON.parse(draft.recipient_ids_json),recipient_ids_json:undefined}; }
export async function mailRecipients(context,account,query) {
  if (!account.is_admin) fail('forbidden','无管理员权限',403);
  const search=(query.get('q') || '').slice(0,40).replace(/[\\%_]/g,'\\$&');
  return rows(context.env.WYJ_DB,`SELECT u.id,u.username FROM task12_users u JOIN task27_security s ON s.user_id=u.id
    WHERE u.deleted=0 AND u.banned=0 AND s.verified_email!='' AND s.email_verified_at!='' AND u.username_normalized LIKE ?1 ESCAPE '\\'
    ORDER BY u.username_normalized LIMIT 30`,[`%${search.toLowerCase()}%`]);
}
export async function saveDraft(context,account,payload) {
  const {db,user}=await identity(context,account);
  if (!isAdminAccount(user)) fail('forbidden','无管理员权限',403);
  const subject=cleanSingleLineText(payload.subject,'主题',120), body=cleanBodyText(payload.body,'正文',4000);
  const to=await recipients(db,payload.recipient_ids);
  const when=nowIso(); let id=payload.id;
  if (id) {
    const draft=await draftFor(db,user,id);
    if (draft.status!=='draft' || payload.revision!==draft.revision) fail('mail_draft_changed','草稿已变化或已发送',409);
    const result=await run(db,`UPDATE task27_email_drafts SET subject=?2,body=?3,recipient_ids_json=?4,revision=revision+1,updated_at=?5 WHERE id=?1 AND status='draft' AND revision=?6`,[id,subject,body,JSON.stringify(to.map(r=>r.id)),when,draft.revision]);
    if (!changed(result)) fail('mail_draft_changed','草稿已变化',409);
  } else {
    id=crypto.randomUUID();
    await run(db,'INSERT INTO task27_email_drafts(id,actor_user_id,subject,body,recipient_ids_json,thread_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)',[id,user.id,subject,body,JSON.stringify(to.map(r=>r.id)),crypto.randomUUID(),when]);
  }
  return {draft:publicDraft(await draftFor(db,user,id))};
}
export async function listDrafts(context,account) {
  const {db,user}=await identity(context,account);
  if (!isAdminAccount(user)) fail('forbidden','无管理员权限',403);
  const drafts=await rows(db,`SELECT * FROM task27_email_drafts ${isOwnerAccount(user)?'':'WHERE actor_user_id=?1'} ORDER BY updated_at DESC,id DESC LIMIT 50`,isOwnerAccount(user)?[]:[user.id]);
  const jobs=await rows(db,`SELECT j.id,j.draft_id,j.user_id,j.status,j.attempts,j.error_code,j.provider_message_id,j.updated_at FROM task27_email_jobs j
    JOIN task27_email_drafts d ON d.id=j.draft_id ${isOwnerAccount(user)?'':'WHERE d.actor_user_id=?1'} ORDER BY j.updated_at DESC LIMIT 100`,isOwnerAccount(user)?[]:[user.id]);
  return {drafts:drafts.map(publicDraft),jobs,from:DEFAULT_FROM_EMAIL,reply_to:DEFAULT_REPLY_TO_EMAIL,inbound_mailbox_available:false,inbox_delivery_confirmed:false};
}
export async function previewDraft(context,account,payload) {
  const {db,user,state,sessionDigest}=await identity(context,account);
  if (!isAdminAccount(user)) fail('forbidden','无管理员权限',403);
  const draft=await draftFor(db,user,payload.id);
  const to=await recipients(db,JSON.parse(draft.recipient_ids_json));
  const fingerprint=await sessionStorageKey(JSON.stringify(to.map(r=>[r.id,r.verified_email])));
  const preview=await createChallenge(db,{user,state,kind:'email_preview',sessionDigest,data:{draft_id:draft.id,revision:draft.revision,fingerprint}});
  return {draft:publicDraft(draft),recipients:to.map(r=>({id:r.id,username:r.username,email_masked:mask(r.verified_email)})),preview:preview.token,from:DEFAULT_FROM_EMAIL,reply_to:DEFAULT_REPLY_TO_EMAIL,thread_id:draft.thread_id,inbox_delivery_confirmed:false};
}
export async function sendDraft(context,account,payload) {
  if (payload.confirm!==true) fail('mail_confirmation_required','请先预览并确认邮件发送');
  const scope=`email_send:${payload.id}:${payload.revision}`;
  const {db,user,sessionDigest,guards}=await authorize(context,account,payload.grant,scope);
  if (!isAdminAccount(user)) fail('forbidden','无管理员权限',403);
  await securityRate(context,'mail-admin',user.id,5,900);
  const draft=await draftFor(db,user,payload.id);
  if (draft.revision!==payload.revision) fail('mail_draft_changed','邮件草稿已变化，请重新预览',409);
  const retry=payload.retry===true;
  if ((!retry&&draft.status!=='draft') || (retry&&draft.status!=='partial')) fail('mail_already_sent','邮件已开始发送或不可重试',409);
  const to=await recipients(db,JSON.parse(draft.recipient_ids_json));
  const preview=await challengeRow(db,payload.preview,'email_preview',sessionDigest);
  if (preview.user_id!==user.id) fail();
  await challengeIdentity(db,preview);
  const snapshot=JSON.parse(preview.context_json);
  if (snapshot.draft_id!==draft.id || snapshot.revision!==draft.revision || snapshot.fingerprint!==await sessionStorageKey(JSON.stringify(to.map(r=>[r.id,r.verified_email])))) fail('mail_preview_stale','收件人或草稿已变化，请重新预览',409);
  const when=nowIso();
  const jobs=retry ? await rows(db,"SELECT * FROM task27_email_jobs WHERE draft_id=?1 AND status='failed' AND attempts<3",[draft.id])
    : to.map(recipient=>({id:crypto.randomUUID(),user_id:recipient.id,recipient_email:recipient.verified_email,attempts:0}));
  if (!jobs.length) fail('mail_retry_unavailable','没有可安全重试的失败投递；未知结果需人工核实',409);
  if (retry && jobs.some(job=>Date.parse(job.updated_at)>Date.now()-60000)) fail('mail_retry_wait','请至少等待一分钟后重试',429);
  if (jobs.some(job=>!to.some(r=>r.id===job.user_id&&r.verified_email===job.recipient_email))) fail('mail_recipient_changed','收件邮箱已变化，请重新创建草稿',409);
  const initialJobs=retry?[]:jobs.map(job=>stmt(db,'INSERT INTO task27_email_jobs(id,draft_id,user_id,recipient_email,updated_at) VALUES(?1,?2,?3,?4,?5)',[job.id,draft.id,job.user_id,job.recipient_email,when]));
  await atomic(db,[...guards,...challengeAssertion(db,preview),stmt(db,'UPDATE task27_challenges SET consumed_at=?2 WHERE token_digest=?1',[preview.token_digest,when]),
    ...assertion(db,'EXISTS(SELECT 1 FROM task27_email_drafts WHERE id=? AND revision=? AND status=?)',[draft.id,draft.revision,retry?'partial':'draft']),
    stmt(db,"UPDATE task27_email_drafts SET status='sending',updated_at=?2 WHERE id=?1",[draft.id,when]),...initialJobs,
    stmt(db,`INSERT INTO task18_admin_action_audit(id,actor_user_id,actor_username,actor_role,target_type,target_id,action,success,after_json,request_id,created_at)
      VALUES(?1,?2,?3,?4,'email',?5,'email_send',1,?6,?7,?8)`,[crypto.randomUUID(),user.id,user.username,isOwnerAccount(user)?'super_admin':'admin',draft.id,JSON.stringify({recipient_count:jobs.length,retry}),String(context.data?.requestId || ''),when])]);
  for (const job of jobs) {
    const claimed=await run(db,`UPDATE task27_email_jobs SET status='sending',attempts=attempts+1,updated_at=?2 WHERE id=?1 AND status IN ('pending','failed') AND attempts<3`,[job.id,nowIso()]);
    if (!changed(claimed)) continue;
    let status='unknown',code='',providerId='';
    try {
      // Each address is separate; no recipient list is disclosed to other users.
      const current=await recipients(db,[job.user_id]);
      if (current[0].verified_email!==job.recipient_email) { status='rejected'; code='mail_recipient_changed'; }
      else {
        const sent=await sendTransactionalEmail(context.env,{kind:'admin_service_notice',to:job.recipient_email,subject:draft.subject,body:draft.body,threadId:draft.thread_id,deliveryId:job.id,requestId:context.data?.requestId});
        status=sent.delivery_status==='delivered'?'provider_delivered':sent.delivery_status; providerId=sent.message_id;
      }
    } catch(error) {
      code=String(error?.code || 'email_unknown');
      if (['email_sending_disabled','email_binding_unavailable','email_credentials_invalid','email_rate_limited'].includes(code)) status='failed';
      else if (code==='email_rejected' || code==='mail_recipient_unavailable') status='rejected';
      // A network failure can occur after provider acceptance. Hold as unknown.
    }
    await run(db,'UPDATE task27_email_jobs SET status=?2,error_code=?3,provider_message_id=?4,updated_at=?5 WHERE id=?1',[job.id,status,code,providerId,nowIso()]);
  }
  const failed=await first(db,"SELECT COUNT(*) AS count FROM task27_email_jobs WHERE draft_id=?1 AND status NOT IN ('accepted','queued','provider_delivered')",[draft.id]);
  await run(db,'UPDATE task27_email_drafts SET status=?2,updated_at=?3 WHERE id=?1',[draft.id,Number(failed.count)?'partial':'sent',nowIso()]);
  return {...await listDrafts(context,account),inbox_delivery_confirmed:false};
}
