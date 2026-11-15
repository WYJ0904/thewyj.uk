import { Task12Error, isoNow } from './task12-model.mjs';

export const DAY = 86400000;
export const nowIso = () => isoNow();
export const stmt = (db, sql, args = []) => db.prepare(sql).bind(...args);
export const first = async (db, sql, args = []) => stmt(db, sql, args).first();
export const rows = async (db, sql, args = []) => (await stmt(db, sql, args).all()).results || [];
export const run = async (db, sql, args = []) => stmt(db, sql, args).run();
export const changed = result => Number(result?.meta?.changes || 0);
export const fail = (code = 'security_verification_failed', message = '验证无效、已使用或已过期，请重新开始', status = 400) => {
  throw new Task12Error(message, status, code);
};
export async function hasTask27(db) {
  if (!db?.prepare) return false;
  const marker = await first(db, "SELECT value FROM task12_metadata WHERE key = 'task27_schema_version'");
  if (marker?.value === '1') return true;
  const existing=await first(db,"SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='task27_security'");
  if (marker || existing) fail('task27_schema_not_ready','账户安全结构状态异常，请稍后重试',503);
  return false;
}
export async function securityState(db, userId) {
  await run(db, `INSERT OR IGNORE INTO task27_security(user_id,password_age_start_at)
    SELECT id,?2 FROM task12_users WHERE id = ?1`, [userId,nowIso()]);
  const state = await first(db, 'SELECT * FROM task27_security WHERE user_id = ?1', [userId]);
  if (!state) fail('user_not_found','账户不可用',403);
  return state;
}
export async function activeUser(db, userId) {
  const user = await first(db, `SELECT users.*,roles.role AS assigned_admin_role FROM task12_users users
    LEFT JOIN task18_admin_roles roles ON roles.user_id=users.id WHERE users.id=?1 AND users.deleted=0 AND users.banned=0`, [userId]);
  if (!user) fail('account_unavailable','账户不可用',403);
  return user;
}
export function assertion(db, condition, args = []) {
  const id = crypto.randomUUID();
  return [stmt(db, `INSERT INTO task27_atomic_guard(id,passed) SELECT ?,CASE WHEN (${condition}) THEN 1 ELSE 0 END`, [id,...args]),
    stmt(db, 'DELETE FROM task27_atomic_guard WHERE id=?1', [id])];
}
export function generationAssertion(db, user, state) {
  return assertion(db, `EXISTS(SELECT 1 FROM task12_users u JOIN task27_security s ON s.user_id=u.id
    WHERE u.id=? AND u.session_version=? AND u.password_hash=? AND u.deleted=0 AND u.banned=0 AND s.version=?
      AND u.role=? AND COALESCE((SELECT role FROM task18_admin_roles WHERE user_id=u.id),'')=?)`,
  [user.id,Number(user.session_version),user.password_hash,Number(state.version),user.role,String(user.assigned_admin_role || '')]);
}
export async function atomic(db, statements) {
  try { return await db.batch(statements); }
  catch (error) {
    if (/CHECK constraint failed: passed|task27_atomic_guard|passed = 1/.test(String(error?.message || ''))) {
      fail('security_state_changed','安全状态已变化或授权已使用，请重新验证',409);
    }
    throw error;
  }
}
export function revokeAllStatements(db, userId, when = nowIso()) {
  return [
    stmt(db, 'UPDATE task12_sessions SET revoked=1,revoked_at=?2 WHERE user_id=?1 AND revoked=0', [userId,when]),
    stmt(db, "UPDATE task20_device_sessions SET revoked=1,revoked_at=?2,revoke_reason='security_change' WHERE user_id=?1 AND revoked=0", [userId,when]),
    stmt(db, 'UPDATE task27_challenges SET consumed_at=?2 WHERE user_id=?1 AND consumed_at=\'\'', [userId,when]),
  ];
}
export const EVENT_TEXT = Object.freeze({
  password_changed:['登录密码已修改','您的登录密码已修改，旧的登录会话已撤销。'],
  password_reset:['登录密码已重置','管理员已重置您的密码。旧会话已撤销，下次登录完成原有双重验证后须设置新密码。'],
  password_recovered:['账户密码已恢复','您的密码已通过账户恢复流程修改。原有双重验证保留，旧会话已撤销。'],
  email_changed:['绑定邮箱已变更','账户的已验证邮箱已变更，旧登录会话已撤销。若非本人操作，请联系支持。'],
  mfa_enabled:['双重验证已开启','账户的双重验证已开启，旧登录会话已撤销。'],
  mfa_disabled:['双重验证已关闭','账户的双重验证已关闭，旧登录会话已撤销。若非本人操作，请联系支持。'],
  mfa_changed:['双重验证方式已变更','账户的双重验证方式已变更，旧登录会话已撤销。'],
  mfa_recovered:['双重验证已通过恢复程序关闭','账户使用密码及一次性恢复码完成独立恢复，旧会话与恢复码已撤销。'],
  recovery_used:['恢复码已使用','一个一次性恢复码已用于账户安全验证。该恢复码已失效。'],
  recovery_regenerated:['恢复码已重新生成','旧恢复码已全部撤销，请妥善保管本次显示的新恢复码。'],
  session_revoked:['登录会话已撤销','您选择的登录会话已在服务端撤销。'],
  refresh_reuse:['检测到刷新凭据重复使用','检测到设备刷新凭据重复使用，相关设备会话已撤销。请检查登录设备。'],
});
export function eventStatements(db, userId, event, actorId = userId, requestId = '') {
  if (!EVENT_TEXT[event]) throw new TypeError('Unknown security event');
  const id = crypto.randomUUID(), when = nowIso();
  const [title,body] = EVENT_TEXT[event];
  return [stmt(db, `INSERT INTO task27_events(id,user_id,actor_user_id,event_type,request_id,created_at) VALUES(?1,?2,?3,?4,?5,?6)`,
    [id,userId,actorId,event,String(requestId).slice(0,120),when]),
  stmt(db, `INSERT INTO task27_notifications(id,user_id,message_type,title,body,event_key,created_at) VALUES(?1,?2,'security',?3,?4,?5,?6)`,
    [id,userId,title,body,id,when])];
}
