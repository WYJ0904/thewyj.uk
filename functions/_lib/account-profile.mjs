import { normalizeUsername, validateUsername } from './task12-model.mjs';
import { authorize } from './task27-security.mjs';
import { assertion, atomic, eventStatements, fail, first, stmt } from './task27-store.mjs';

export async function accountProfile(context, account) {
  const row = await first(context.env.WYJ_DB,
    'SELECT username,registered_at,updated_at,role FROM task12_users WHERE id=? AND banned=0 AND deleted=0', [account.id]);
  if (!row) fail('account_unavailable', '账户不可用', 403);
  return { username: row.username, registered_at: row.registered_at, revision: row.updated_at,
    username_editable: row.role !== 'super_admin' };
}

export async function changeAccountProfile(context, account, input) {
  const username = validateUsername(input.username);
  const { db, user, guards } = await authorize(context, account, input.grant, 'profile_change');
  if (user.role === 'super_admin') fail('profile_locked', '此账户无法在此修改账号名', 403);
  if (input.expected_revision !== user.updated_at) fail('profile_conflict', '资料已更新，请重新读取', 409);
  const stamp = new Date(Math.max(Date.now(), (Date.parse(user.updated_at) || 0) + 1)).toISOString();
  try {
    await atomic(db, [
      ...assertion(db, 'EXISTS (SELECT 1 FROM task12_users WHERE id=? AND updated_at=?)', [user.id, input.expected_revision]),
      ...guards,
      stmt(db, 'UPDATE task12_users SET username=?,username_normalized=?,updated_at=?,source_updated_at=? WHERE id=?',
        [username, normalizeUsername(username), stamp, stamp, user.id]),
      ...eventStatements(db, user.id, 'profile_changed', user.id, context.data?.requestId),
    ]);
  } catch (error) {
    if (/UNIQUE constraint failed: task12_users.username_normalized/.test(String(error?.message || ''))) {
      fail('username_unavailable', '账号名不可用', 409);
    }
    throw error;
  }
  return { username, registered_at: user.registered_at, revision: stamp, username_editable: true };
}
