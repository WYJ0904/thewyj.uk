import { sha256Hex } from './cloudflare-foundation.mjs';

export const RELEASE_CHANNELS = Object.freeze(['stable', 'beta', 'experimental']);
export const TASK25_SNAPSHOT_TTL_SECONDS = 30;
export const TASK25_MAX_FLAGS = 200;

export class Task25Error extends Error {
  constructor(message, status = 400, code = 'task25_invalid_input') {
    super(message); this.status = status; this.code = code;
  }
}

export function allowedFields(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) {
    throw new Task25Error('请求字段无效');
  }
}

export function releaseChannel(value) {
  if (!RELEASE_CHANNELS.includes(value)) throw new Task25Error('体验通道无效');
  return value;
}

export function flagKey(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9._-]{1,63}$/.test(value)) throw new Task25Error('功能标识无效');
  return value;
}

export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Task25Error('请提供当前版本号');
  return value;
}

export function booleanInput(value) {
  if (typeof value !== 'boolean') throw new Task25Error('开关值必须是布尔值');
  return value;
}

export function flagDefinition(input) {
  allowedFields(input, ['flag_key', 'description', 'enabled', 'kill_switch', 'channels', 'rollout_percentage', 'expected_revision']);
  const key = flagKey(input.flag_key);
  const description = input.description === undefined ? '' : input.description;
  if (typeof description !== 'string' || description.length > 500) throw new Task25Error('说明最多 500 字');
  const channels = input.channels === undefined ? ['experimental'] : input.channels;
  if (!Array.isArray(channels) || channels.length > 3 || new Set(channels).size !== channels.length) throw new Task25Error('通道列表无效');
  channels.forEach(releaseChannel);
  const percentage = input.rollout_percentage === undefined ? 100 : input.rollout_percentage;
  if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100 ||
      Math.abs(percentage * 100 - Math.round(percentage * 100)) > 1e-8) throw new Task25Error('放量比例必须在 0–100 之间，最多两位小数');
  return {
    flag_key: key, description,
    enabled: booleanInput(input.enabled === undefined ? false : input.enabled),
    kill_switch: booleanInput(input.kill_switch === undefined ? false : input.kill_switch),
    channels: RELEASE_CHANNELS.filter(channel => channels.includes(channel)),
    rollout_basis_points: Math.round(percentage * 100), expected_revision: revision(input.expected_revision),
  };
}

export function flagPayload(row) {
  return {
    flag_key: row.flag_key, description: row.description,
    enabled: row.enabled === 1, kill_switch: row.kill_switch === 1,
    channels: JSON.parse(row.channels_json), rollout_percentage: row.rollout_basis_points / 100,
    revision: row.revision, updated_at: row.updated_at,
  };
}

export async function deterministicBucket(key, userId) {
  const hash = await sha256Hex(`${flagKey(key)}\0${String(userId)}`);
  return Math.floor(Number.parseInt(hash.slice(0, 8), 16) * 10000 / 0x100000000);
}

/** Global OFF, kill switch and channel exclusion cannot be bypassed by overrides. */
export async function evaluateFlag(row, userId, channel, override = null) {
  const result = { enabled: false, reason: 'invalid_configuration', revision: Number(row?.revision || 0) };
  try {
    flagKey(row?.flag_key); releaseChannel(channel);
    const channels = JSON.parse(row.channels_json);
    if (!Array.isArray(channels) || channels.some(value => !RELEASE_CHANNELS.includes(value)) ||
        ![0, 1].includes(row.enabled) || ![0, 1].includes(row.kill_switch) ||
        !Number.isInteger(row.rollout_basis_points) || row.rollout_basis_points < 0 || row.rollout_basis_points > 10000) return result;
    if (row.kill_switch === 1) return { ...result, reason: 'kill_switch' };
    if (row.enabled !== 1) return { ...result, reason: 'global_off' };
    if (!channels.includes(channel)) return { ...result, reason: 'channel_excluded' };
    if (!userId) return { ...result, reason: 'identity_required' };
    if (override === 0 || override === 1) return { ...result, enabled: override === 1, reason: 'user_override' };
    const bucket = await deterministicBucket(row.flag_key, userId);
    return { ...result, enabled: bucket < row.rollout_basis_points, reason: 'percentage_rollout', bucket };
  } catch (_) { return result; }
}
