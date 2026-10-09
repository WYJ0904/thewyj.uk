import { Task25Error, TASK25_MAX_FLAGS, TASK25_SNAPSHOT_TTL_SECONDS, allowedFields, booleanInput,
  evaluateFlag, flagDefinition, flagKey, flagPayload, releaseChannel, revision } from './task25-model.mjs';

export async function ensureTask25Schema(db) {
  try { return (await db.prepare("SELECT value FROM task25_metadata WHERE key = 'schema_version'").first())?.value === '1'; }
  catch (_) { return false; }
}

function requireAdmin(actor) {
  if (!actor?.is_admin) throw new Task25Error('无管理员权限', 403, 'forbidden');
}

async function activeUser(db, id) {
  if (typeof id !== 'string' || id.length < 1 || id.length > 80) throw new Task25Error('用户标识无效');
  const row = await db.prepare('SELECT id FROM task12_users WHERE id = ?1 AND banned = 0 AND deleted = 0').bind(id).first();
  if (!row) throw new Task25Error('用户不存在或不可用', 404, 'task25_user_unavailable');
  return row.id;
}

export async function readFeatureSnapshot(db, userId, simulationChannel = null) {
  // One D1 transaction keeps flags, overrides and channel from one observation.
  const [flagRows, overrideRows, preferenceRows] = await db.batch([
    db.prepare('SELECT * FROM task25_feature_flags ORDER BY flag_key LIMIT ?1').bind(TASK25_MAX_FLAGS + 1),
    db.prepare('SELECT flag_key, enabled FROM task25_user_flag_overrides WHERE user_id = ?1 AND enabled IS NOT NULL').bind(userId),
    db.prepare('SELECT channel, revision FROM task25_release_preferences WHERE user_id = ?1').bind(userId),
  ]);
  if (flagRows.results.length > TASK25_MAX_FLAGS) throw new Task25Error('功能配置数量超出限制', 503, 'task25_configuration_unavailable');
  const preference = preferenceRows.results[0] || { channel: 'stable', revision: 0 };
  const channel = releaseChannel(simulationChannel ?? preference.channel);
  const overrides = new Map(overrideRows.results.map(row => [row.flag_key, row.enabled]));
  const flags = Object.fromEntries(await Promise.all(flagRows.results.map(async row =>
    [row.flag_key, await evaluateFlag(row, userId, channel, overrides.get(row.flag_key))])));
  const observedAt = new Date();
  return {
    schema_version: 1, account_id: userId, channel, channel_revision: preference.revision,
    observed_at: observedAt.toISOString(), expires_at: new Date(observedAt.getTime() + TASK25_SNAPSHOT_TTL_SECONDS * 1000).toISOString(),
    max_age_seconds: TASK25_SNAPSHOT_TTL_SECONDS, flags,
  };
}

export async function setReleasePreference(db, actor, input) {
  allowedFields(input, ['channel', 'expected_revision']);
  const channel = releaseChannel(input.channel), expected = revision(input.expected_revision);
  const result = await db.prepare(`INSERT INTO task25_release_preferences(user_id, channel, revision, updated_at)
    SELECT ?1, ?2, 1, ?3 WHERE ?4 = 0 OR EXISTS (
      SELECT 1 FROM task25_release_preferences WHERE user_id = ?1 AND revision = ?4)
    ON CONFLICT(user_id) DO UPDATE SET channel = excluded.channel,
      revision = task25_release_preferences.revision + 1, updated_at = excluded.updated_at
    WHERE task25_release_preferences.revision = ?4
    RETURNING channel, revision`).bind(actor.id, channel, new Date().toISOString(), expected).first();
  if (!result) throw new Task25Error('通道设置已变化，请刷新后重试', 409, 'task25_revision_conflict');
  return result;
}

export async function listFlags(db, actor) {
  requireAdmin(actor);
  const [flags, audit] = await db.batch([
    db.prepare('SELECT * FROM task25_feature_flags ORDER BY flag_key LIMIT 200'),
    db.prepare('SELECT * FROM task25_flag_audit ORDER BY id DESC LIMIT 100'),
  ]);
  return { flags: flags.results.map(flagPayload), audit: audit.results };
}

export async function saveFlag(db, actor, input, requestId) {
  requireAdmin(actor);
  const flag = flagDefinition(input), now = new Date().toISOString(), mutation = crypto.randomUUID();
  const args = [flag.flag_key, flag.description, Number(flag.enabled), Number(flag.kill_switch), JSON.stringify(flag.channels),
    flag.rollout_basis_points, now, actor.id, mutation, requestId];
  const statement = flag.expected_revision === 0
    ? db.prepare(`INSERT INTO task25_feature_flags(flag_key, description, enabled, kill_switch, channels_json,
        rollout_basis_points, updated_at, updated_by, mutation_id, request_id)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT(flag_key) DO NOTHING`).bind(...args)
    : db.prepare(`UPDATE task25_feature_flags SET description = ?2, enabled = ?3, kill_switch = ?4, channels_json = ?5,
        rollout_basis_points = ?6, updated_at = ?7, updated_by = ?8, mutation_id = ?9, request_id = ?10, revision = revision + 1
      WHERE flag_key = ?1 AND revision = ?11`).bind(...args, flag.expected_revision);
  const results = await db.batch([statement, db.prepare('SELECT * FROM task25_feature_flags WHERE flag_key = ?1').bind(flag.flag_key)]);
  if (!(results[0].meta.changes > 0)) throw new Task25Error('功能设置已变化，请刷新后重试', 409, 'task25_revision_conflict');
  return flagPayload(results[1].results[0]);
}

export async function setFlagOverride(db, actor, input, requestId) {
  requireAdmin(actor);
  allowedFields(input, ['flag_key', 'user_id', 'enabled', 'expected_revision']);
  const key = flagKey(input.flag_key), userId = await activeUser(db, input.user_id), expected = revision(input.expected_revision);
  const enabled = input.enabled === null ? null : Number(booleanInput(input.enabled));
  const mutation = crypto.randomUUID(), now = new Date().toISOString();
  // The nonce prevents a losing CAS from writing an override against the winner's revision.
  const results = await db.batch([
    db.prepare(`UPDATE task25_feature_flags SET revision = revision + 1, updated_at = ?1, updated_by = ?2,
      mutation_id = ?3, request_id = ?4 WHERE flag_key = ?5 AND revision = ?6`).bind(now, actor.id, mutation, requestId, key, expected),
    db.prepare(`INSERT INTO task25_user_flag_overrides(flag_key, user_id, enabled, updated_at, updated_by, request_id)
      SELECT flag_key, ?1, ?2, ?3, ?4, ?5 FROM task25_feature_flags WHERE flag_key = ?6 AND mutation_id = ?7
      ON CONFLICT(flag_key, user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at,
        updated_by = excluded.updated_by, request_id = excluded.request_id`).bind(userId, enabled, now, actor.id, requestId, key, mutation),
  ]);
  if (!(results[0].meta.changes > 0)) throw new Task25Error('功能设置已变化，请刷新后重试', 409, 'task25_revision_conflict');
  return { flag_key: key, user_id: userId, enabled: input.enabled, revision: expected + 1 };
}

export async function simulateFlags(db, actor, input) {
  requireAdmin(actor);
  allowedFields(input, ['user_id', 'channel']);
  const userId = await activeUser(db, input.user_id);
  return readFeatureSnapshot(db, userId, input.channel === undefined ? null : releaseChannel(input.channel));
}
