/** Shared, bounded validation and private-object policy. No identity/quota store. */
export const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
export const HEADER_BYTES = 4096;
// JSON.parse expands an object graph; never let a maximum-size part do so.
export const JSON_SYNTAX_BYTES = 1024 * 1024;
const ID = '[A-Za-z0-9_-]{16,80}';
const SCOPE = '(production|preview|development)';
const OBJECT = new RegExp(`^transfers/v2/${SCOPE}/objects/${ID}/file$`);
const PART = new RegExp(`^transfers/v2/${SCOPE}/files/${ID}/part-[1-9][0-9]{0,3}$`);
const TEMPORARY = new RegExp(`^temporary/v1/${SCOPE}/files/${ID}(?:/${ID})?$`);

export class SecureFileError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    this.name = 'SecureFileError';
    Object.assign(this, { code, status, retryable });
  }
}

export async function fileSha256Hex(bytes) {
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function requireObjectKey(key, family = 'transfer', environment = '') {
  const value = String(key || '');
  const match = (family === 'temporary' ? TEMPORARY : OBJECT).exec(value)
    || (family === 'transfer' ? PART.exec(value) : null);
  if (!match || (environment && match[1] !== environment)) {
    throw new SecureFileError('file_object_scope_invalid', '文件存储范围无效，操作已拒绝', 503);
  }
  return value;
}

export function isCanonicalObjectKey(key, family, environment) {
  try { requireObjectKey(key, family, environment); return true; } catch { return false; }
}

/** Preallocate at most one bounded part; reject lying/missing lengths before R2. */
export async function readBoundedBytes(request, maximum, exact = null) {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > MAX_BUFFER_BYTES) {
    throw new RangeError('Unbounded file read refused');
  }
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw new SecureFileError('request_too_large', '请求内容过大或大小无效', 413);
  }
  if (exact !== null && declared !== null && Number(declared) !== exact) {
    throw new SecureFileError('file_size_mismatch', '实际字节与声明大小不一致');
  }
  const bytes = new Uint8Array(exact === null ? maximum : exact);
  let length = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (length + value.byteLength > bytes.byteLength) {
          // Request.clone() tees the body for administrative audit. A tee's
          // cancel promise waits for its sibling; awaiting it here would stop
          // the audit from ever reaching and cancelling that sibling.
          void reader.cancel().catch(() => undefined);
          throw new SecureFileError('request_too_large', '上传内容超过允许大小', 413);
        }
        bytes.set(value, length);
        length += value.byteLength;
      }
    } finally { reader.releaseLock(); }
  }
  if (exact !== null && length !== exact) {
    throw new SecureFileError('file_size_mismatch', '实际字节与声明大小不一致');
  }
  return bytes.subarray(0, length);
}

export async function readFileJson(request, maximum) {
  const bytes = await readBoundedBytes(request, maximum);
  try {
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes) || '{}');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('object required');
    return payload;
  } catch { throw new SecureFileError('invalid_json', '请求 JSON 格式无效'); }
}

const signature = (bytes, values, offset = 0) => bytes.length >= values.length + offset
  && values.every((value, i) => bytes[offset + i] === value);
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));
const KNOWN = Object.freeze({
  '.png': ['image/png', b => signature(b, [137,80,78,71,13,10,26,10])],
  '.jpg': ['image/jpeg', b => signature(b, [255,216,255])],
  '.jpeg': ['image/jpeg', b => signature(b, [255,216,255])],
  '.gif': ['image/gif', b => ['GIF87a','GIF89a'].includes(ascii(b,0,6))],
  '.webp': ['image/webp', b => ascii(b,0,4) === 'RIFF' && ascii(b,8,12) === 'WEBP'],
  '.pdf': ['application/pdf', b => ascii(b,0,5) === '%PDF-'],
  '.zip': ['application/zip', b => signature(b,[80,75,3,4]) || signature(b,[80,75,5,6]) || signature(b,[80,75,7,8])],
  '.mp4': ['video/mp4', b => b.length >= 12 && ascii(b,4,8) === 'ftyp'],
  '.m4v': ['video/mp4', b => b.length >= 12 && ascii(b,4,8) === 'ftyp'],
  '.mov': ['video/quicktime', b => b.length >= 12 && ascii(b,4,8) === 'ftyp'],
  '.webm': ['video/webm', b => signature(b,[26,69,223,163])],
  '.wav': ['audio/wav', b => ascii(b,0,4) === 'RIFF' && ascii(b,8,12) === 'WAVE'],
  '.ogg': ['audio/ogg', b => ascii(b,0,4) === 'OggS'],
});
const TEXT = new Set(['.txt','.md','.csv','.json','.log']);
const ALIASES = Object.freeze({'.zip':['application/x-zip-compressed'],'.m4v':['video/x-m4v'],'.wav':['audio/x-wav','audio/wave']});

export function inspectFileBytes(fileName, declaredMime, bytes, { complete = false } = {}) {
  const ext = String(fileName).toLowerCase().match(/\.[a-z0-9]{1,16}$/)?.[0] || '';
  const mime = String(declaredMime || 'application/octet-stream').toLowerCase().split(';',1)[0].trim();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)) {
    throw new SecureFileError('file_mime_invalid', '文件类型声明无效');
  }
  const known = KNOWN[ext];
  if (known) {
    if (!known[1](bytes) || (mime !== known[0] && mime!=='application/octet-stream' && !ALIASES[ext]?.includes(mime))) {
      throw new SecureFileError('file_signature_invalid', '文件头、文件名与声明类型不一致');
    }
    return { validation_status: 'header_verified', detected_mime: known[0], preview_policy: ext === '.zip' ? 'download_only' : 'preview' };
  }
  if (TEXT.has(ext)) {
    const expected = ext === '.json' ? ['application/json','text/json','text/plain']
      : ext === '.csv' ? ['text/csv','application/csv','text/plain'] : ['text/plain','text/markdown','text/x-log'];
    if (!expected.includes(mime) && mime !== 'application/octet-stream') {
      throw new SecureFileError('file_signature_invalid', '文件名与声明类型不一致');
    }
    const sample=complete?bytes:bytes.subarray(0,HEADER_BYTES);
    const collect=complete && ext==='.json' && bytes.length<=JSON_SYNTAX_BYTES;
    let text='';
    try {
      const encoding = signature(bytes,[255,254]) ? 'utf-16le' : signature(bytes,[254,255]) ? 'utf-16be' : 'utf-8';
      const decoder=new TextDecoder(encoding,{fatal:true});
      for(let offset=0;offset<sample.length;offset+=65536) {
        const chunk=decoder.decode(sample.subarray(offset,offset+65536),{stream:true});
        if(chunk.includes('\0'))throw new Error('binary text');
        if(collect)text+=chunk;
      }
      if(complete){const tail=decoder.decode();if(tail.includes('\0'))throw new Error('binary text');if(collect)text+=tail;}
      if(collect)JSON.parse(text);
    } catch { throw new SecureFileError('file_signature_invalid', '文本文件损坏、编码无效或包含二进制内容'); }
    if(complete && ext==='.json' && !collect)return {validation_status:'download_only',detected_mime:'application/octet-stream',preview_policy:'download_only'};
    return { validation_status: complete ? 'content_verified' : 'header_verified', detected_mime: 'text/plain', preview_policy: 'preview' };
  }
  // A format without a reliable recognizer stays a general-purpose attachment.
  // In particular, HTML/SVG and a forged client MIME can never select inline execution.
  return { validation_status: 'download_only', detected_mime: 'application/octet-stream', preview_policy: 'download_only' };
}

export function secureDownloadHeaders(file) {
  const name = String(file.file_name || 'download').replace(/[\r\n\x00-\x1f\x7f]/g, '_');
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Headers({
    'Content-Type': file.detected_mime || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'private, no-store, no-transform',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Referrer-Policy': 'no-referrer',
    'Accept-Ranges': 'bytes',
  });
}

export function fileAuditStatement(db, actorRef, resourceId, action, outcome = 'ok', whenTable = '',proofDigest='',whenState='') {
  if (whenTable && !['task22_upload_sessions','task22_shares','task14_shares','task22_download_grants','task14_download_grants'].includes(whenTable)) throw new TypeError('Invalid audit resource');
  const values=[crypto.randomUUID(), String(actorRef || '').slice(0,96),String(resourceId).slice(0,80),action,outcome,new Date().toISOString()];
  if(whenTable)values.push(proofDigest || resourceId);if(whenState)values.push(whenState);
  const column=whenTable.endsWith('download_grants')?'token_digest':'id';
  return db.prepare(`INSERT INTO task28_file_events(id, actor_ref, resource_id, action, outcome, created_at)
    SELECT ?1,?2,?3,?4,?5,?6 ${whenTable ? `WHERE EXISTS(SELECT 1 FROM ${whenTable} WHERE ${column}=?7 ${whenState?'AND state=?8':''})` : ''}`).bind(...values);
}
