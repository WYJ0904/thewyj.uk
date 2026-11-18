/**
 * Task29 Versioned Authenticated Backup Container & Integrity Manifest Crypto.
 * Uses Web Crypto API exclusively (AES-256-GCM + PBKDF2-HMAC-SHA256) so it runs
 * identically in browsers and Cloudflare Workers (`workerd`).
 */

export const BACKUP_CONTAINER_FORMAT = "aeris-encrypted-backup";
export const BACKUP_CONTAINER_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = "aeris.backup.v1";
export const BACKUP_CIPHER = "AES-256-GCM";
export const BACKUP_KDF_ALGORITHM = "PBKDF2-HMAC-SHA256";
export const BACKUP_KDF_ITERATIONS = 100_000;
export const BACKUP_KDF_MAX_ITERATIONS = 600_000;
export const BACKUP_SALT_BYTES = 16;
export const BACKUP_IV_BYTES = 12;
export const BACKUP_TAG_BITS = 128;
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
export const MIN_PASSPHRASE_LENGTH = 10;
export const MAX_PASSPHRASE_LENGTH = 256;

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export class Task29Error extends Error {
  constructor(code, message, status = 400, retryable = false, details = undefined) {
    super(message);
    this.name = "Task29Error";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const pairs = [];
  for (const key of keys) {
    if (value[key] === undefined) continue;
    pairs.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  }
  return `{${pairs.join(",")}}`;
}

export async function sha256Hex(input) {
  const bytes = typeof input === "string" ? UTF8_ENCODER.encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function accountBindingDigest(accountId) {
  const normalized = String(accountId || "").trim();
  if (!normalized) {
    throw new Task29Error("authentication_required", "账户标识无效", 401);
  }
  return await sha256Hex(`aeris-backup-owner:v1:${normalized}`);
}

export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < view.length; i += chunkSize) {
    const slice = view.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(b64) {
  if (typeof b64 !== "string" || !b64.trim()) {
    throw new Task29Error("BACKUP_INVALID_CONTAINER", "加密容器缺少有效编码数据", 400);
  }
  try {
    const clean = b64.trim();
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (_) {
    throw new Task29Error("BACKUP_INVALID_CONTAINER", "加密容器 Base64 数据损坏", 400);
  }
}

export function validateBackupPassphrase(passphrase) {
  if (typeof passphrase !== "string") {
    throw new Task29Error("BACKUP_PASSPHRASE_REQUIRED", "请提供备份口令", 400);
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Task29Error(
      "BACKUP_PASSPHRASE_TOO_SHORT",
      `备份口令长度不能少于 ${MIN_PASSPHRASE_LENGTH} 个字符`,
      400,
    );
  }
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) {
    throw new Task29Error(
      "BACKUP_PASSPHRASE_TOO_LONG",
      `备份口令长度不能超过 ${MAX_PASSPHRASE_LENGTH} 个字符`,
      400,
    );
  }
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(passphrase)) {
    throw new Task29Error("BACKUP_PASSPHRASE_INVALID", "备份口令包含非法控制字符", 400);
  }
}

export function buildCanonicalAad(header) {
  const aadObj = {
    format: String(header.format || ""),
    container_version: Number(header.container_version || 0),
    schema_version: String(header.schema_version || ""),
    account_id_sha256: String(header.account_id_sha256 || ""),
    export_id: String(header.export_id || ""),
    created_at: String(header.created_at || ""),
    manifest_sha256: String(header.manifest_sha256 || ""),
  };
  return UTF8_ENCODER.encode(canonicalJson(aadObj));
}

/**
 * Derive an AES-256-GCM CryptoKey using PBKDF2-HMAC-SHA256.
 * To remain compatible with Cloudflare Workers (workerd limits a single PBKDF2
 * call to 100,000 iterations), 100,000 uses a direct single deriveKey call;
 * higher iteration counts up to 600,000 use standard 100k chaining via HMAC.
 */
export async function deriveBackupAesKey(passphrase, saltBytes, iterations = BACKUP_KDF_ITERATIONS, usages = ["encrypt", "decrypt"]) {
  if (!Number.isSafeInteger(iterations) || iterations < BACKUP_KDF_ITERATIONS || iterations > BACKUP_KDF_MAX_ITERATIONS) {
    throw new Task29Error("BACKUP_KDF_UNSUPPORTED", "加密容器 KDF 参数不受支持", 400);
  }
  const passphraseBytes = UTF8_ENCODER.encode(passphrase);
  if (iterations <= 100_000) {
    const baseKey = await crypto.subtle.importKey(
      "raw",
      passphraseBytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: saltBytes,
        iterations,
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      usages,
    );
  }

  // Fallback for higher iteration counts in constrained runtimes:
  // Chain chunks of up to 100,000 iterations via deriveBits.
  let remaining = iterations;
  let currentMaterial = passphraseBytes;
  while (remaining > 0) {
    const chunk = Math.min(100_000, remaining);
    const key = await crypto.subtle.importKey("raw", currentMaterial, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: saltBytes,
        iterations: chunk,
      },
      key,
      256,
    );
    currentMaterial = new Uint8Array(bits);
    remaining -= chunk;
  }
  return await crypto.subtle.importKey(
    "raw",
    currentMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

export async function computeSectionManifest(data, metadata = {}) {
  const sectionNames = Object.keys(data || {}).sort();
  const sections = {};
  let totalRecords = 0;
  for (const name of sectionNames) {
    const records = Array.isArray(data[name]) ? data[name] : [];
    totalRecords += records.length;
    sections[name] = {
      count: records.length,
      sha256: await sha256Hex(canonicalJson(records)),
    };
  }
  const manifest = {
    schema_version: BACKUP_SCHEMA_VERSION,
    export_id: String(metadata.export_id || ""),
    created_at: String(metadata.created_at || ""),
    account_id_sha256: String(metadata.account_id_sha256 || ""),
    scopes: Array.isArray(metadata.scopes) ? [...metadata.scopes].sort() : [],
    cutoff: metadata.cutoff || {},
    total_records: totalRecords,
    sections,
    payload_sha256: await sha256Hex(canonicalJson(data)),
  };
  const manifest_sha256 = await sha256Hex(canonicalJson(manifest));
  return { manifest, manifest_sha256 };
}

export async function verifyManifestIntegrity(manifest, expectedManifestSha256, data) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Task29Error("BACKUP_MANIFEST_MISMATCH", "备份完整性清单结构无效", 422);
  }
  if (expectedManifestSha256) {
    const computedManifestSha = await sha256Hex(canonicalJson(manifest));
    if (computedManifestSha !== expectedManifestSha256) {
      throw new Task29Error("BACKUP_MANIFEST_MISMATCH", "备份完整性清单摘要与头部签名不一致", 422);
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Task29Error("BACKUP_MANIFEST_MISMATCH", "备份正文结构无效", 422);
  }
  const payloadSha = await sha256Hex(canonicalJson(data));
  if (manifest.payload_sha256 !== payloadSha) {
    throw new Task29Error("BACKUP_MANIFEST_MISMATCH", "备份数据整体摘要校验失败，数据可能被篡改或截断", 422);
  }
  const expectedSections = manifest.sections || {};
  const dataKeys = Object.keys(data).sort();
  const manifestKeys = Object.keys(expectedSections).sort();
  if (canonicalJson(dataKeys) !== canonicalJson(manifestKeys)) {
    throw new Task29Error("BACKUP_MANIFEST_MISMATCH", "备份数据类别清单与实际数据不匹配", 422);
  }
  let actualTotal = 0;
  for (const name of manifestKeys) {
    const spec = expectedSections[name];
    const records = data[name];
    if (!Array.isArray(records) || !spec || typeof spec.count !== "number" || typeof spec.sha256 !== "string") {
      throw new Task29Error("BACKUP_MANIFEST_MISMATCH", `备份节 ${name} 格式无效`, 422);
    }
    actualTotal += records.length;
    if (records.length !== spec.count) {
      throw new Task29Error(
        "BACKUP_MANIFEST_MISMATCH",
        `备份节 ${name} 记录数校验失败：清单声明 ${spec.count} 条，实际 ${records.length} 条`,
        422,
      );
    }
    const sectionSha = await sha256Hex(canonicalJson(records));
    if (sectionSha !== spec.sha256) {
      throw new Task29Error(
        "BACKUP_MANIFEST_MISMATCH",
        `备份节 ${name} 内容摘要校验失败，请确认文件完整未被修改`,
        422,
      );
    }
  }
  if (actualTotal !== Number(manifest.total_records)) {
    throw new Task29Error("BACKUP_MANIFEST_MISMATCH", "备份总记录数与完整性清单不一致", 422);
  }
  return {
    verified: true,
    payload_sha256: payloadSha,
    manifest_sha256: expectedManifestSha256 || await sha256Hex(canonicalJson(manifest)),
  };
}

export async function encryptBackupPackage(envelope, passphrase) {
  validateBackupPassphrase(passphrase);
  if (!envelope || typeof envelope !== "object" || !envelope.manifest || !envelope.data) {
    throw new Task29Error("BACKUP_INVALID_ENVELOPE", "备份数据结构无效，无法加密", 400);
  }
  const manifest = envelope.manifest;
  const manifestSha = String(envelope.manifest_sha256 || await sha256Hex(canonicalJson(manifest)));
  const accountIdSha256 = String(envelope.account_binding?.account_id_sha256 || manifest.account_id_sha256 || "");
  if (!/^[0-9a-f]{64}$/.test(accountIdSha256)) {
    throw new Task29Error("BACKUP_INVALID_ENVELOPE", "备份缺少有效的账户绑定摘要", 400);
  }

  const salt = crypto.getRandomValues(new Uint8Array(BACKUP_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(BACKUP_IV_BYTES));
  const key = await deriveBackupAesKey(passphrase, salt, BACKUP_KDF_ITERATIONS, ["encrypt"]);

  const headerForAad = {
    format: BACKUP_CONTAINER_FORMAT,
    container_version: BACKUP_CONTAINER_VERSION,
    schema_version: String(envelope.schema_version || BACKUP_SCHEMA_VERSION),
    account_id_sha256: accountIdSha256,
    export_id: String(envelope.export_id || manifest.export_id || ""),
    created_at: String(envelope.created_at || manifest.created_at || ""),
    manifest_sha256: manifestSha,
  };
  const aad = buildCanonicalAad(headerForAad);

  const plaintextObj = {
    schema_version: headerForAad.schema_version,
    export_id: headerForAad.export_id,
    created_at: headerForAad.created_at,
    cutoff: envelope.cutoff || manifest.cutoff || {},
    account_binding: envelope.account_binding || { account_id_sha256: accountIdSha256, binding_version: 1 },
    scopes: envelope.scopes || manifest.scopes || [],
    privacy_declaration: envelope.privacy_declaration || {},
    capabilities_and_limitations: envelope.capabilities_and_limitations || {},
    manifest,
    data: envelope.data,
  };
  const plaintextBytes = UTF8_ENCODER.encode(JSON.stringify(plaintextObj));
  if (plaintextBytes.byteLength > MAX_BACKUP_BYTES) {
    throw new Task29Error("BACKUP_TOO_LARGE", "备份数据超过单包大小上限 (16 MiB)", 413);
  }

  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: aad,
      tagLength: BACKUP_TAG_BITS,
    },
    key,
    plaintextBytes,
  );

  return {
    format: BACKUP_CONTAINER_FORMAT,
    container_version: BACKUP_CONTAINER_VERSION,
    schema_version: headerForAad.schema_version,
    export_id: headerForAad.export_id,
    created_at: headerForAad.created_at,
    account_binding: {
      account_id_sha256: accountIdSha256,
      binding_version: 1,
    },
    manifest_sha256: manifestSha,
    privacy_declaration: envelope.privacy_declaration || {},
    crypto: {
      cipher: BACKUP_CIPHER,
      kdf: BACKUP_KDF_ALGORITHM,
      iterations: BACKUP_KDF_ITERATIONS,
      salt_b64: bytesToBase64(salt),
      iv_b64: bytesToBase64(iv),
      tag_bits: BACKUP_TAG_BITS,
      aad_fields: [
        "format",
        "container_version",
        "schema_version",
        "account_id_sha256",
        "export_id",
        "created_at",
        "manifest_sha256",
      ],
    },
    ciphertext_b64: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

export function validateEncryptedContainerStructure(container) {
  if (!container || typeof container !== "object" || Array.isArray(container)) {
    throw new Task29Error("BACKUP_INVALID_CONTAINER", "加密备份容器格式无效", 400);
  }
  if (container.format !== BACKUP_CONTAINER_FORMAT) {
    throw new Task29Error("BACKUP_INVALID_CONTAINER", "不是有效的 Aeris 加密备份文件", 400);
  }
  if (container.container_version !== BACKUP_CONTAINER_VERSION) {
    throw new Task29Error(
      "BACKUP_UNSUPPORTED_VERSION",
      `不支持的加密容器版本：${String(container.container_version ?? "unknown")}`,
      400,
    );
  }
  if (container.schema_version !== BACKUP_SCHEMA_VERSION) {
    throw new Task29Error(
      "BACKUP_UNSUPPORTED_SCHEMA",
      `不支持的备份数据 Schema 版本：${String(container.schema_version ?? "unknown")}`,
      400,
    );
  }
  const cryptoMeta = container.crypto;
  if (!cryptoMeta || typeof cryptoMeta !== "object") {
    throw new Task29Error("BACKUP_INVALID_CONTAINER", "加密容器缺少密码学元数据", 400);
  }
  if (cryptoMeta.cipher !== BACKUP_CIPHER) {
    throw new Task29Error("BACKUP_UNSUPPORTED_CIPHER", `不支持的加密算法：${String(cryptoMeta.cipher || "")}`, 400);
  }
  if (cryptoMeta.kdf !== BACKUP_KDF_ALGORITHM) {
    throw new Task29Error("BACKUP_UNSUPPORTED_KDF", `不支持的密钥派生算法：${String(cryptoMeta.kdf || "")}`, 400);
  }
  const iterations = Number(cryptoMeta.iterations);
  if (!Number.isSafeInteger(iterations) || iterations < BACKUP_KDF_ITERATIONS || iterations > BACKUP_KDF_MAX_ITERATIONS) {
    throw new Task29Error("BACKUP_KDF_UNSUPPORTED", "密钥派生迭代次数不在安全允许范围内", 400);
  }
  if (cryptoMeta.tag_bits !== BACKUP_TAG_BITS) {
    throw new Task29Error("BACKUP_INVALID_CONTAINER", "GCM 认证标签长度无效", 400);
  }
  const saltBytes = base64ToBytes(cryptoMeta.salt_b64);
  if (saltBytes.byteLength !== BACKUP_SALT_BYTES) {
    throw new Task29Error("BACKUP_INVALID_CONTAINER", "加密 Salt 长度无效", 400);
  }
  const ivBytes = base64ToBytes(cryptoMeta.iv_b64);
  if (ivBytes.byteLength !== BACKUP_IV_BYTES) {
    throw new Task29Error("BACKUP_INVALID_CONTAINER", "加密 Nonce/IV 长度无效", 400);
  }
  const cipherBytes = base64ToBytes(container.ciphertext_b64);
  if (cipherBytes.byteLength < 16 || cipherBytes.byteLength > MAX_BACKUP_BYTES + 1024) {
    throw new Task29Error("BACKUP_TOO_LARGE", "加密密文大小超出安全限制或已损坏", cipherBytes.byteLength < 16 ? 400 : 413);
  }
  const accountIdSha256 = String(container.account_binding?.account_id_sha256 || "");
  if (!/^[0-9a-f]{64}$/.test(accountIdSha256) || !/^[0-9a-f]{64}$/.test(String(container.manifest_sha256 || ""))) {
    throw new Task29Error("BACKUP_INVALID_CONTAINER", "加密容器缺少有效的账户或清单摘要绑定", 400);
  }
  return { saltBytes, ivBytes, cipherBytes, iterations, accountIdSha256 };
}

export async function decryptBackupPackage(container, passphrase) {
  validateBackupPassphrase(passphrase);
  const { saltBytes, ivBytes, cipherBytes, iterations, accountIdSha256 } = validateEncryptedContainerStructure(container);
  const aad = buildCanonicalAad({
    format: container.format,
    container_version: container.container_version,
    schema_version: container.schema_version,
    account_id_sha256: accountIdSha256,
    export_id: container.export_id,
    created_at: container.created_at,
    manifest_sha256: container.manifest_sha256,
  });

  const key = await deriveBackupAesKey(passphrase, saltBytes, iterations, ["decrypt"]);
  let plaintextBuffer;
  try {
    plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBytes,
        additionalData: aad,
        tagLength: BACKUP_TAG_BITS,
      },
      key,
      cipherBytes,
    );
  } catch (_) {
    throw new Task29Error(
      "BACKUP_DECRYPTION_FAILED",
      "解密失败：备份口令错误、容器头被修改或密文与认证标签已损坏",
      403,
    );
  }

  let envelope;
  try {
    const jsonText = UTF8_DECODER.decode(new Uint8Array(plaintextBuffer));
    envelope = JSON.parse(jsonText);
  } catch (_) {
    throw new Task29Error("BACKUP_CORRUPTED_PLAINTEXT", "解密后的备份内容不是有效的 UTF-8 JSON", 422);
  }

  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Task29Error("BACKUP_CORRUPTED_PLAINTEXT", "备份数据结构无效", 422);
  }
  if (envelope.account_binding?.account_id_sha256 !== accountIdSha256 ||
      envelope.manifest?.account_id_sha256 !== accountIdSha256) {
    throw new Task29Error("BACKUP_MANIFEST_MISMATCH", "容器头部账户绑定与密文内部清单不一致", 422);
  }

  const integrity = await verifyManifestIntegrity(envelope.manifest, container.manifest_sha256, envelope.data);
  return {
    envelope,
    integrity,
    container_version: container.container_version,
  };
}
