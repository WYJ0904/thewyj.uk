import { task20TokenFromRequest } from './task20-model.mjs';
import { sessionStorageKey } from './task12-crypto.mjs';
import { challengeAssertion, challengeIdentity, challengeRow, createChallenge } from './task27-auth.mjs';
import { activeUser, atomic, changed, DAY, fail, first, generationAssertion, nowIso, rows, run, securityState, stmt } from './task27-store.mjs';

const ADVICE_ID='task27-mfa-advice-v1';
const INBOX_SELECT=`SELECT 'security' AS source,n.id,n.message_type AS type,n.title,n.body,n.created_at,n.read_at,0 AS requires_confirmation,'' AS acknowledged_at
 FROM task27_notifications n WHERE n.user_id=?1
 UNION ALL
 SELECT 'admin' AS source,m.id,m.message_type AS type,m.title,m.body,m.created_at,COALESCE(r.read_at,'') AS read_at,m.requires_confirmation,COALESCE(r.acknowledged_at,'') AS acknowledged_at
 FROM admin_messages m JOIN admin_message_recipients target ON target.message_id=m.id AND target.user_id=?1
 LEFT JOIN admin_message_receipts r ON r.message_id=m.id AND r.user_id=?1
 WHERE m.delivery_channel='inbox' AND m.status='active' AND (m.expires_at='' OR m.expires_at>?2)`;
export async function maybePasswordAdvice(db,userId) {
  const state=await securityState(db,userId), now=nowIso(), cutoff=new Date(Date.now()-30*DAY).toISOString();
  const anchor=state.password_changed_at || state.password_age_start_at;
  if (!Number.isFinite(Date.parse(anchor)) || Date.parse(anchor)>Date.now()-30*DAY) return;
  if (state.password_notice_at && Date.parse(state.password_notice_at)>Date.now()-30*DAY) return;
  const id=crypto.randomUUID();
  await atomic(db,[stmt(db,`INSERT INTO task27_notifications(id,user_id,message_type,title,body,event_key,created_at)
    SELECT ?1,user_id,'password_advice','密码安全建议','您的密码已使用超过 30 天。可考虑更新为独立、足够长的密码。这只是建议，不会令密码到期、锁定账户或影响会员权益。',?1,?3
    FROM task27_security WHERE user_id=?2 AND (password_notice_at='' OR password_notice_at<=?4)
      AND CASE WHEN password_changed_at!='' THEN password_changed_at ELSE password_age_start_at END<=?4`,[id,userId,now,cutoff]),
    stmt(db,'UPDATE task27_security SET password_notice_at=?3 WHERE user_id=?2 AND EXISTS(SELECT 1 FROM task27_notifications WHERE id=?1)',[id,userId,now])]);
}
export async function mfaAdviceBroadcast(db,account) {
  const state=await securityState(db,account.id), cutoff=new Date(Date.now()-30*DAY).toISOString();
  if (state.mfa_method!=='none' || (state.mfa_broadcast_at && state.mfa_broadcast_at>cutoff)) return null;
  const when=nowIso();
  await run(db,`INSERT OR IGNORE INTO admin_messages(id,title,body,message_type,sender_user_id,sender_username,sender_role,target_scope,requires_confirmation,status,idempotency_key,created_at,updated_at,delivery_channel,purpose,audience_condition)
    SELECT ?1,'完善账户安全','建议在账户安全中心开启邮箱或验证器双重验证。此建议不强制开启，不影响会员权益，也不会进入个人通知收件箱。','account',id,username,'super_admin','all',0,'active','task27-mfa-advice-v1',?2,?2,'broadcast','mfa_advice','mfa_disabled'
    FROM task12_users WHERE role='super_admin' AND deleted=0 AND banned=0 LIMIT 1`,[ADVICE_ID,when]);
  const message=await first(db,"SELECT * FROM admin_messages WHERE id=?1 AND status='active'",[ADVICE_ID]);
  if (!message) return null;
  const result=await run(db,`UPDATE task27_security SET mfa_broadcast_at=?3 WHERE user_id=?1 AND mfa_method='none' AND (mfa_broadcast_at='' OR mfa_broadcast_at<=?2)`,[account.id,cutoff,when]);
  return changed(result)?message:null;
}
export async function inbox(db,account,query) {
  await maybePasswordAdvice(db,account.id);
  const filter=query.get('filter') || 'all';
  if (!['all','unread','read'].includes(filter)) fail('inbox_filter_invalid','通知筛选无效');
  const pageText=query.get('page') || '1';
  if (!/^[1-9]\d{0,5}$/.test(pageText)) fail('inbox_page_invalid','通知页码无效');
  const page=Number(pageText), now=nowIso();
  const all=await rows(db,`SELECT * FROM (${INBOX_SELECT}) WHERE (?3='all' OR (?3='unread' AND read_at='') OR (?3='read' AND read_at!=''))
    ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?4`,[account.id,now,filter,(page-1)*30]);
  const totals=await first(db,`SELECT COUNT(*) AS total,SUM(CASE WHEN read_at='' THEN 1 ELSE 0 END) AS unread FROM (${INBOX_SELECT})`,[account.id,now]);
  return {messages:all.map(row=>({...row,requires_confirmation:Boolean(row.requires_confirmation)})),unread_count:Number(totals.unread || 0),total:Number(totals.total),page};
}
export async function markRead(db,account,payload) {
  if (typeof payload.id!=='string' || payload.id.length>80 || !['security','admin'].includes(payload.source)) fail('notification_invalid','通知标识无效');
  const when=nowIso();
  if (payload.source==='security') {
    const target=await first(db,'SELECT id FROM task27_notifications WHERE id=?1 AND user_id=?2',[payload.id,account.id]);
    if (!target) fail('notification_not_found','通知不存在',404);
    await run(db,"UPDATE task27_notifications SET read_at=?3 WHERE id=?1 AND user_id=?2 AND read_at=''",[payload.id,account.id,when]);
  } else {
    const message=await first(db,`SELECT m.id FROM admin_messages m JOIN admin_message_recipients t ON t.message_id=m.id AND t.user_id=?2
      WHERE m.id=?1 AND m.delivery_channel='inbox' AND m.status='active' AND (m.expires_at='' OR m.expires_at>?3)`,[payload.id,account.id,when]);
    if (!message) fail('notification_not_found','通知不存在',404);
    await run(db,`INSERT INTO admin_message_receipts(message_id,user_id,read_at,updated_at) VALUES(?1,?2,?3,?3)
      ON CONFLICT(message_id,user_id) DO UPDATE SET read_at=CASE WHEN read_at='' THEN excluded.read_at ELSE read_at END,updated_at=excluded.updated_at`,[payload.id,account.id,when]);
  }
  return inbox(db,account,new URLSearchParams());
}
export async function previewReadAll(context,account) {
  const db=context.env.WYJ_DB, when=nowIso();
  await maybePasswordAdvice(db,account.id);
  const [n,m]=await Promise.all([
    first(db,'SELECT COALESCE(MAX(rowid),0) AS watermark FROM task27_notifications WHERE user_id=?1',[account.id]),
    first(db,'SELECT COALESCE(MAX(rowid),0) AS watermark FROM admin_messages')]);
  const count=await snapshotCount(db,account.id,n.watermark,m.watermark,when);
  const user=await activeUser(db,account.id), state=await securityState(db,account.id);
  const challenge=await createChallenge(db,{user,state,kind:'inbox_read_all',sessionDigest:await sessionStorageKey(task20TokenFromRequest(context.request)),data:{n:Number(n.watermark),m:Number(m.watermark),count,when}});
  return {count,confirmation:challenge.token,expires_at:challenge.expires_at};
}
async function snapshotCount(db,userId,n,m,when) {
  const result=await first(db,`SELECT
    (SELECT COUNT(*) FROM task27_notifications WHERE user_id=?1 AND rowid<=?2 AND read_at='')+
    (SELECT COUNT(*) FROM admin_messages a JOIN admin_message_recipients t ON t.message_id=a.id AND t.user_id=?1 LEFT JOIN admin_message_receipts r ON r.message_id=a.id AND r.user_id=?1
      WHERE a.rowid<=?3 AND a.delivery_channel='inbox' AND a.status='active' AND (a.expires_at='' OR a.expires_at>?4) AND COALESCE(r.read_at,'')='') AS count`,[userId,n,m,when]);
  return Number(result.count);
}
export async function confirmReadAll(context,account,payload) {
  if (payload.confirm!==true) fail('read_all_confirmation_required','请确认要标记已读的数量');
  const db=context.env.WYJ_DB;
  const row=await challengeRow(db,payload.confirmation,'inbox_read_all',await sessionStorageKey(task20TokenFromRequest(context.request)));
  if (row.user_id!==account.id) fail();
  const {user,state}=await challengeIdentity(db,row), snapshot=JSON.parse(row.context_json), when=nowIso();
  await atomic(db,[...generationAssertion(db,user,state),...challengeAssertion(db,row),
    stmt(db,'UPDATE task27_challenges SET consumed_at=?2 WHERE token_digest=?1',[row.token_digest,when]),
    stmt(db,"UPDATE task27_notifications SET read_at=?3 WHERE user_id=?1 AND rowid<=?2 AND read_at=''",[account.id,snapshot.n,when]),
    stmt(db,`INSERT INTO admin_message_receipts(message_id,user_id,read_at,updated_at)
      SELECT a.id,?1,?3,?3 FROM admin_messages a JOIN admin_message_recipients t ON t.message_id=a.id AND t.user_id=?1
      WHERE a.rowid<=?2 AND a.delivery_channel='inbox' AND a.status='active' AND (a.expires_at='' OR a.expires_at>?3)
      ON CONFLICT(message_id,user_id) DO UPDATE SET read_at=CASE WHEN read_at='' THEN excluded.read_at ELSE read_at END,updated_at=excluded.updated_at`,[account.id,snapshot.m,when])]);
  return {...await inbox(db,account,new URLSearchParams()),confirmed_count:snapshot.count};
}
