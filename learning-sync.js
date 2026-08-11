(function learningSyncModule(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WYJLearningSync = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createLearningSyncApi(root) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const BACKUP_TYPE = "wyj-learning-data-backup";
  const STORE_PREFIX = "wyjLearningSync:v1:";
  const CLIENT_ID_KEY = "wyjLearningSyncClient:v1";
  const MAX_RECORDS = 8220;
  const MAX_CHANGE_COUNT = 200;
  const MAX_RECORD_BYTES = 384 * 1024;
  const MAX_REQUEST_BYTES = 440 * 1024;
  const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
  const DATA_TYPES = new Set([
    "wrong_book",
    "achievement",
    "test_history",
    "daily_goal",
    "language_settings",
    "learning_config",
  ]);
  const STATUS_LABELS = Object.freeze({
    synced: "已同步",
    pending: "等待同步",
    syncing: "正在同步",
    failed: "同步失败",
    merged: "已合并",
  });

  function utf8Bytes(value) {
    const text = String(value || "");
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
    if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(text, "utf8"));
    return Uint8Array.from(unescape(encodeURIComponent(text)), (character) => character.charCodeAt(0));
  }

  function encodeBase64Url(value) {
    const bytes = utf8Bytes(value);
    let encoded;
    if (typeof Buffer !== "undefined") encoded = Buffer.from(bytes).toString("base64");
    else {
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      encoded = btoa(binary);
    }
    return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeBase64Url(value) {
    const encoded = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    let bytes;
    if (typeof Buffer !== "undefined") bytes = Uint8Array.from(Buffer.from(padded, "base64"));
    else bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("utf8");
    return decodeURIComponent(escape(String.fromCharCode(...bytes)));
  }

  function makeRecordId(kind, components) {
    const cleanKind = String(kind || "").trim();
    if (!/^[a-z_]{2,30}$/.test(cleanKind)) throw new Error("学习记录类型无效");
    return ["v1", cleanKind, ...components.map((item) => encodeBase64Url(String(item || "")))].join("|");
  }

  function parseRecordId(recordId) {
    const parts = String(recordId || "").split("|");
    if (parts.length < 3 || parts[0] !== "v1" || !/^[a-z_]{2,30}$/.test(parts[1])) return null;
    try {
      return { kind: parts[1], components: parts.slice(2).map(decodeBase64Url) };
    } catch (_) {
      return null;
    }
  }

  function recordKey(dataType, recordId) {
    return `${dataType}\u001f${recordId}`;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function isoTimestamp(value, fallback = "") {
    const date = new Date(value || fallback);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }

  function compareRecords(left, right) {
    const leftTime = Date.parse(left?.updated_at || "") || 0;
    const rightTime = Date.parse(right?.updated_at || "") || 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left?.client_id || "").localeCompare(String(right?.client_id || ""));
  }

  function mergeUnique(left, right, limit = 2000) {
    const result = [];
    const seen = new Set();
    [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])].forEach((item) => {
      const marker = stableStringify(item);
      if (!seen.has(marker) && result.length < limit) {
        seen.add(marker);
        result.push(clone(item));
      }
    });
    return result;
  }

  function mergeMonotonic(current, incoming) {
    if (typeof current === "boolean" && typeof incoming === "boolean") return current || incoming;
    if (typeof current === "number" && typeof incoming === "number") return Math.max(current, incoming);
    if (Array.isArray(current) && Array.isArray(incoming)) return mergeUnique(current, incoming);
    if (current && incoming && typeof current === "object" && typeof incoming === "object") {
      const result = clone(current);
      Object.entries(incoming).forEach(([key, value]) => {
        result[key] = key in result ? mergeMonotonic(result[key], value) : clone(value);
      });
      return result;
    }
    return current === null || current === undefined || current === "" ? clone(incoming) : clone(current);
  }

  function mergeWrongPayload(current, incoming, incomingNewer = true) {
    const left = current && typeof current === "object" ? current : {};
    const right = incoming && typeof incoming === "object" ? incoming : {};
    const merged = incomingNewer ? { ...clone(left), ...clone(right) } : { ...clone(right), ...clone(left) };
    merged.wrong_count = Math.max(Number(left.wrong_count) || 0, Number(right.wrong_count) || 0);
    const accepted = mergeUnique(left.accepted, right.accepted, 50);
    if (accepted.length) merged.accepted = accepted;
    const leftRubric = left.rubric && typeof left.rubric === "object" ? left.rubric : {};
    const rightRubric = right.rubric && typeof right.rubric === "object" ? right.rubric : {};
    if (Object.keys(leftRubric).length || Object.keys(rightRubric).length) {
      merged.rubric = incomingNewer
        ? { ...clone(leftRubric), ...clone(rightRubric) }
        : { ...clone(rightRubric), ...clone(leftRubric) };
      const rubricAccepted = mergeUnique(leftRubric.accepted, rightRubric.accepted, 50);
      if (rubricAccepted.length) merged.rubric.accepted = rubricAccepted;
    }
    return merged;
  }

  function mergePayload(dataType, current, incoming, incomingNewer = true) {
    if (dataType === "achievement") return mergeMonotonic(current, incoming);
    if (dataType === "wrong_book") return mergeWrongPayload(current, incoming, incomingNewer);
    return clone(incomingNewer ? incoming : current);
  }

  function validJsonValue(value, depth = 0) {
    if (depth > 8) return false;
    if (value === null || typeof value === "boolean" || typeof value === "string") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.length <= 2000 && value.every((item) => validJsonValue(item, depth + 1));
    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      return entries.length <= 300 && entries.every(([key, item]) => (
        key.length > 0 && key.length <= 100 && validJsonValue(item, depth + 1)
      ));
    }
    return false;
  }

  function normalizeRecord(raw, options = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("学习记录格式无效");
    const dataType = String(raw.data_type || "").trim();
    const recordId = String(raw.record_id || "").trim();
    if (!DATA_TYPES.has(dataType)) throw new Error("学习数据类型无效");
    if (!/^[A-Za-z0-9._~|:-]{1,700}$/.test(recordId) || !parseRecordId(recordId)) {
      throw new Error("学习记录标识无效");
    }
    const deleted = raw.deleted === true;
    if (dataType === "achievement" && deleted) throw new Error("成就记录只能增加");
    const payload = deleted ? {} : clone(raw.payload || {});
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || !validJsonValue(payload)) {
      throw new Error("学习记录内容无效");
    }
    if (utf8Bytes(stableStringify(payload)).length > MAX_RECORD_BYTES) throw new Error("单项学习数据过大");
    const updatedAt = isoTimestamp(raw.updated_at, options.now || new Date().toISOString());
    if (!updatedAt || Date.parse(updatedAt) > Date.now() + 5 * 60 * 1000) throw new Error("学习记录更新时间无效");
    const serverVersion = Number.parseInt(raw.server_version, 10) || 0;
    if (serverVersion < 0) throw new Error("服务器同步版本无效");
    return {
      data_type: dataType,
      record_id: recordId,
      payload,
      updated_at: updatedAt,
      deleted,
      client_id: String(raw.client_id || options.clientId || "").slice(0, 80),
      client_version: String(raw.client_version || options.clientVersion || "").slice(0, 80),
      server_version: serverVersion,
      dirty: raw.dirty === true,
      revision: Math.max(0, Number.parseInt(raw.revision, 10) || 0),
    };
  }

  function randomClientId(cryptoObject) {
    if (cryptoObject?.randomUUID) return `client-${cryptoObject.randomUUID()}`;
    const bytes = new Uint8Array(16);
    if (cryptoObject?.getRandomValues) cryptoObject.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    return `client-${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }

  function parseStoredState(text, accountId) {
    try {
      const value = JSON.parse(text || "{}");
      if (value.schema_version !== SCHEMA_VERSION || value.account_id !== accountId) throw new Error();
      const records = {};
      Object.values(value.records || {}).slice(0, MAX_RECORDS).forEach((raw) => {
        const record = normalizeRecord(raw);
        records[recordKey(record.data_type, record.record_id)] = record;
      });
      return {
        schema_version: SCHEMA_VERSION,
        account_id: accountId,
        server_version: Math.max(0, Number.parseInt(value.server_version, 10) || 0),
        migration_complete: value.migration_complete === true,
        records,
      };
    } catch (_) {
      return {
        schema_version: SCHEMA_VERSION,
        account_id: accountId,
        server_version: 0,
        migration_complete: false,
        records: {},
      };
    }
  }

  function validateBackup(text, accountId) {
    if (utf8Bytes(text).length > MAX_BACKUP_BYTES) throw new Error("学习数据备份不能超过 5 MB");
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error("学习数据备份不是有效 JSON");
    }
    if (!data || data.type !== BACKUP_TYPE || data.schema_version !== SCHEMA_VERSION) {
      throw new Error("学习数据备份格式或版本不受支持");
    }
    if (String(data.account_id || "") !== String(accountId || "")) {
      throw new Error("该备份不属于当前登录账号");
    }
    if (!Array.isArray(data.records) || data.records.length > MAX_RECORDS) {
      throw new Error("学习数据备份记录数量无效");
    }
    const seen = new Set();
    const records = data.records.map((raw) => {
      const record = normalizeRecord(raw);
      const key = recordKey(record.data_type, record.record_id);
      if (seen.has(key)) throw new Error("学习数据备份包含重复记录");
      seen.add(key);
      return record;
    });
    return { data, records };
  }

  class LearningSyncManager {
    constructor(options = {}) {
      this.storage = options.storage || root.localStorage;
      this.transport = options.transport;
      this.applyRecord = options.applyRecord || (() => {});
      this.onStatus = options.onStatus || (() => {});
      this.onlineSource = options.onlineSource || root;
      this.crypto = options.crypto || root.crypto;
      this.accountId = "";
      this.clientVersion = "";
      this.clientId = "";
      this.state = null;
      this.syncPromise = null;
      this.timer = null;
      this.retryCount = 0;
      this.status = "synced";
      this.lastDetail = "";
      this.generation = 0;
      this.boundOnline = () => this.schedule(50);
      this.onlineSource?.addEventListener?.("online", this.boundOnline);
    }

    start({ accountId, clientVersion, legacyRecords = [] }) {
      this.stop(false);
      this.generation += 1;
      this.accountId = String(accountId || "");
      this.clientVersion = String(clientVersion || "").slice(0, 80);
      if (!this.accountId || !this.clientVersion) throw new Error("同步账号或客户端版本无效");
      this.clientId = String(this.storage.getItem(CLIENT_ID_KEY) || "");
      if (!/^[A-Za-z0-9._~:-]{8,80}$/.test(this.clientId)) {
        this.clientId = randomClientId(this.crypto).slice(0, 80);
        this.storage.setItem(CLIENT_ID_KEY, this.clientId);
      }
      this.state = parseStoredState(this.storage.getItem(this.storageKey()), this.accountId);
      if (!this.state.migration_complete) {
        legacyRecords.slice(0, MAX_RECORDS).forEach((raw) => this.upsert(raw, { schedule: false, migrate: true }));
        this.state.migration_complete = true;
        this.persist();
      }
      this.emitStatus(this.dirtyRecords().length ? "pending" : "synced");
      this.schedule(400);
      return this.snapshot();
    }

    stop(clearIdentity = true) {
      this.generation += 1;
      clearTimeout(this.timer);
      this.timer = null;
      this.syncPromise = null;
      this.retryCount = 0;
      if (clearIdentity) {
        this.accountId = "";
        this.clientVersion = "";
        this.clientId = "";
        this.state = null;
      }
    }

    destroy() {
      this.stop();
      this.onlineSource?.removeEventListener?.("online", this.boundOnline);
    }

    storageKey() {
      return `${STORE_PREFIX}${encodeURIComponent(this.accountId)}`;
    }

    snapshot() {
      return clone(this.state);
    }

    persist() {
      if (!this.state) return false;
      try {
        this.storage.setItem(this.storageKey(), JSON.stringify(this.state));
        return true;
      } catch (_) {
        this.emitStatus("failed", "浏览器存储空间不足");
        return false;
      }
    }

    emitStatus(status, detail = "") {
      this.status = status;
      this.lastDetail = String(detail || "").slice(0, 160);
      this.onStatus({
        status,
        label: STATUS_LABELS[status] || status,
        detail: this.lastDetail,
        pending: this.dirtyRecords().length,
        server_version: this.state?.server_version || 0,
      });
    }

    dirtyRecords() {
      return Object.values(this.state?.records || {}).filter((record) => record.dirty);
    }

    upsert(raw, options = {}) {
      if (!this.state) return null;
      const record = normalizeRecord({
        ...raw,
        client_id: this.clientId,
        client_version: this.clientVersion,
        updated_at: raw.updated_at || new Date().toISOString(),
      }, { clientId: this.clientId, clientVersion: this.clientVersion });
      const key = recordKey(record.data_type, record.record_id);
      const existing = this.state.records[key];
      if (existing?.deleted && options.migrate && !record.deleted) return existing;
      const unchanged = existing
        && existing.deleted === record.deleted
        && stableStringify(existing.payload) === stableStringify(record.payload);
      if (unchanged) return existing;
      if (!existing && Object.keys(this.state.records).length >= MAX_RECORDS) throw new Error("本地学习同步记录数量已达上限");
      const next = {
        ...record,
        server_version: existing?.server_version || 0,
        dirty: true,
        revision: (existing?.revision || 0) + 1,
      };
      this.state.records[key] = next;
      this.persist();
      this.emitStatus("pending");
      if (options.schedule !== false) this.schedule(900);
      return next;
    }

    replaceGroup(dataType, groupPrefix, records) {
      if (!this.state) return;
      const incoming = new Set();
      records.forEach((raw) => {
        incoming.add(raw.record_id);
        this.upsert({ ...raw, data_type: dataType }, { schedule: false });
      });
      Object.values(this.state.records).forEach((existing) => {
        if (
          existing.data_type === dataType
          && existing.record_id.startsWith(groupPrefix)
          && !existing.deleted
          && !incoming.has(existing.record_id)
        ) {
          this.upsert({
            data_type: dataType,
            record_id: existing.record_id,
            payload: {},
            deleted: true,
            updated_at: new Date().toISOString(),
          }, { schedule: false });
        }
      });
      this.schedule(900);
    }

    schedule(delayMs = 900) {
      if (!this.state || !this.accountId) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.syncNow().catch(() => {});
      }, Math.max(0, delayMs));
    }

    requestBatch() {
      const selected = [];
      let totalBytes = 0;
      for (const record of this.dirtyRecords().sort((a, b) => compareRecords(a, b))) {
        const change = {
          data_type: record.data_type,
          record_id: record.record_id,
          payload: record.deleted ? {} : record.payload,
          updated_at: record.updated_at,
          deleted: record.deleted,
          base_server_version: record.server_version || 0,
        };
        const bytes = utf8Bytes(JSON.stringify(change)).length;
        if (selected.length && totalBytes + bytes > MAX_REQUEST_BYTES) break;
        if (bytes > MAX_RECORD_BYTES + 4096) throw new Error("单项学习数据过大");
        selected.push({ change, revision: record.revision, key: recordKey(record.data_type, record.record_id) });
        totalBytes += bytes;
        if (selected.length >= MAX_CHANGE_COUNT) break;
      }
      return selected;
    }

    applyServerRecord(raw, submittedRevisions = new Map()) {
      const remote = normalizeRecord(raw, { clientId: this.clientId, clientVersion: this.clientVersion });
      const key = recordKey(remote.data_type, remote.record_id);
      const local = this.state.records[key];
      const submittedRevision = submittedRevisions.get(key);
      let next = { ...remote, dirty: false, revision: (local?.revision || 0) + 1 };
      const changedDuringRequest = local?.dirty && submittedRevision !== undefined && local.revision !== submittedRevision;
      const unsentLocal = local?.dirty && submittedRevision === undefined;
      const unseenRemoteDeletion = local
        && !local.deleted
        && remote.deleted
        && Number(local.server_version || 0) < Number(remote.server_version || 0);
      if (local && !unseenRemoteDeletion && (changedDuringRequest || unsentLocal)) {
        const localNewer = compareRecords(local, remote) > 0;
        if (remote.data_type === "wrong_book" || remote.data_type === "achievement") {
          const payload = remote.deleted
            ? (localNewer ? local.payload : {})
            : mergePayload(remote.data_type, remote.payload, local.payload, localNewer);
          const keepLocal = localNewer || stableStringify(payload) !== stableStringify(remote.payload);
          next = keepLocal
            ? {
              ...local,
              payload,
              deleted: remote.deleted && !localNewer,
              server_version: Math.max(local.server_version || 0, remote.server_version || 0),
              dirty: true,
            }
            : next;
        } else if (localNewer) {
          next = {
            ...local,
            server_version: Math.max(local.server_version || 0, remote.server_version || 0),
            dirty: true,
          };
        }
      }
      this.state.records[key] = next;
      this.applyRecord(clone(next));
      return next;
    }

    async syncNow() {
      if (!this.state || !this.accountId || typeof this.transport !== "function") return { ok: false };
      if (this.syncPromise) return this.syncPromise;
      if (this.onlineSource?.navigator?.onLine === false) {
        this.emitStatus("pending", "离线时已保存在本机，联网后自动同步");
        return { ok: false, offline: true };
      }
      const syncGeneration = this.generation;
      const operation = (async () => {
        this.emitStatus("syncing");
        let mergedCount = 0;
        let loops = 0;
        do {
          const batch = this.requestBatch();
          const submitted = new Map(batch.map((item) => [item.key, item.revision]));
          const response = await this.transport({
            schema_version: SCHEMA_VERSION,
            client_id: this.clientId,
            client_version: this.clientVersion,
            since_version: this.state.server_version || 0,
            changes: batch.map((item) => item.change),
          });
          if (syncGeneration !== this.generation) return { ok: false, cancelled: true };
          if (!response || response.schema_version !== SCHEMA_VERSION) throw new Error("服务器同步响应版本无效");
          const remoteByKey = new Map();
          [...(response.results || []), ...(response.changes || [])].forEach((record) => {
            const key = recordKey(record.data_type, record.record_id);
            const previous = remoteByKey.get(key);
            if (!previous || Number(record.server_version) >= Number(previous.server_version)) remoteByKey.set(key, record);
          });
          [...remoteByKey.values()]
            .sort((left, right) => Number(left.server_version) - Number(right.server_version))
            .forEach((record) => this.applyServerRecord(record, submitted));
          this.state.server_version = Math.max(0, Number.parseInt(response.next_since_version, 10) || 0);
          mergedCount += Number.parseInt(response.merged_count, 10) || 0;
          this.persist();
          loops += 1;
          if (!response.has_more && !this.dirtyRecords().length) break;
        } while (loops < 20);
        this.retryCount = 0;
        const pending = this.dirtyRecords().length;
        this.emitStatus(mergedCount ? "merged" : pending ? "pending" : "synced", mergedCount ? `已合并 ${mergedCount} 项设备变更` : "");
        if (pending) this.schedule(500);
        return { ok: !pending, merged_count: mergedCount, pending };
      })().catch((error) => {
        if (syncGeneration !== this.generation || !this.state || !this.accountId) {
          return { ok: false, cancelled: true };
        }
        this.retryCount += 1;
        this.emitStatus("failed", String(error?.message || "网络暂时不可用").slice(0, 160));
        const delay = Math.min(60_000, 1000 * (2 ** Math.min(this.retryCount, 6))) + Math.floor(Math.random() * 500);
        this.schedule(delay);
        return { ok: false, error };
      });
      this.syncPromise = operation;
      operation.finally(() => {
        if (this.syncPromise === operation) this.syncPromise = null;
      });
      return operation;
    }

    exportBackup() {
      if (!this.state) throw new Error("请先登录后再导出学习数据");
      return JSON.stringify({
        type: BACKUP_TYPE,
        schema_version: SCHEMA_VERSION,
        account_id: this.accountId,
        client_version: this.clientVersion,
        server_version: this.state.server_version || 0,
        exported_at: new Date().toISOString(),
        records: Object.values(this.state.records).map((record) => ({
          data_type: record.data_type,
          record_id: record.record_id,
          payload: record.deleted ? {} : record.payload,
          updated_at: record.updated_at,
          deleted: record.deleted,
          server_version: record.server_version || 0,
        })),
      }, null, 2);
    }

    importBackup(text) {
      if (!this.state) throw new Error("请先登录后再导入学习数据");
      const { records } = validateBackup(text, this.accountId);
      let imported = 0;
      let ignored = 0;
      records.forEach((backupRecord) => {
        const key = recordKey(backupRecord.data_type, backupRecord.record_id);
        const local = this.state.records[key];
        if (local?.deleted && !backupRecord.deleted && (local.server_version || 0) >= (backupRecord.server_version || 0)) {
          ignored += 1;
          return;
        }
        const backupNewer = !local || compareRecords(local, backupRecord) < 0;
        if (local && !backupNewer && !["wrong_book", "achievement"].includes(backupRecord.data_type)) {
          ignored += 1;
          return;
        }
        const payload = local && !local.deleted && !backupRecord.deleted
          ? mergePayload(backupRecord.data_type, local.payload, backupRecord.payload, backupNewer)
          : backupRecord.payload;
        const updatedAt = backupNewer ? backupRecord.updated_at : local?.updated_at;
        const importedRecord = this.upsert({
          ...backupRecord,
          payload,
          updated_at: updatedAt,
          server_version: local?.server_version || 0,
        }, { schedule: false });
        if (importedRecord) this.applyRecord(clone(importedRecord));
        imported += 1;
      });
      this.persist();
      if (imported) {
        this.emitStatus("pending", `已导入 ${imported} 项，等待同步`);
        this.schedule(50);
      }
      return { imported, ignored };
    }
  }

  return {
    BACKUP_TYPE,
    DATA_TYPES,
    LearningSyncManager,
    MAX_BACKUP_BYTES,
    MAX_RECORDS,
    SCHEMA_VERSION,
    STATUS_LABELS,
    makeRecordId,
    mergePayload,
    normalizeRecord,
    parseRecordId,
    recordKey,
    stableStringify,
    validateBackup,
  };
}));
