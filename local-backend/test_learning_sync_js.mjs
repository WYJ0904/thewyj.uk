import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sync = require("../learning-sync.js");

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }
}

class OnlineSource {
  constructor(online = true) {
    this.navigator = { onLine: online };
    this.listeners = new Map();
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  removeEventListener(name) {
    this.listeners.delete(name);
  }

  reconnect() {
    this.navigator.onLine = true;
    this.listeners.get("online")?.();
  }
}

function serverFixture() {
  let version = 0;
  const records = new Map();
  const changes = [];
  return async (request) => {
    const results = [];
    request.changes.forEach((incoming) => {
      version += 1;
      const record = {
        ...incoming,
        client_id: request.client_id,
        client_version: request.client_version,
        server_version: version,
        server_updated_at: new Date().toISOString(),
      };
      records.set(`${record.data_type}\u001f${record.record_id}`, record);
      changes.push(record);
      results.push(record);
    });
    return {
      schema_version: 1,
      server_version: version,
      next_since_version: version,
      has_more: false,
      merged_count: 0,
      results,
      changes: changes.filter((record) => record.server_version > request.since_version),
    };
  };
}

const wrongId = sync.makeRecordId("wrong", ["默认", "history", "電話"]);
assert.deepEqual(sync.parseRecordId(wrongId), {
  kind: "wrong",
  components: ["默认", "history", "電話"],
});

const mergedWrong = sync.mergePayload(
  "wrong_book",
  { wrong_count: 2, accepted: ["电话"], correct_answer: "电话" },
  { wrong_count: 5, accepted: ["电话", "电话机"], last_answer: "手机" },
  true,
);
assert.equal(mergedWrong.wrong_count, 5);
assert.deepEqual(mergedWrong.accepted, ["电话", "电话机"]);
assert.equal(mergedWrong.correct_answer, "电话");

const storage = new MemoryStorage();
const online = new OnlineSource(false);
const statuses = [];
const applied = [];
const manager = new sync.LearningSyncManager({
  storage,
  onlineSource: online,
  crypto: globalThis.crypto,
  transport: serverFixture(),
  applyRecord: (record) => applied.push(record),
  onStatus: (status) => statuses.push(status.status),
});
manager.start({
  accountId: "account-one",
  clientVersion: "test-client",
  legacyRecords: [{
    data_type: "wrong_book",
    record_id: wrongId,
    payload: { wrong_count: 1, correct_answer: "电话" },
    updated_at: new Date().toISOString(),
  }],
});
manager.stop(false);
assert.equal(manager.dirtyRecords().length, 1);
assert.equal((await manager.syncNow()).offline, true);
assert.equal(manager.dirtyRecords().length, 1);
online.reconnect();
manager.stop(false);
const synced = await manager.syncNow();
assert.equal(synced.ok, true);
assert.equal(manager.dirtyRecords().length, 0);
assert.ok(applied.some((record) => record.record_id === wrongId));
assert.ok(statuses.includes("pending"));
assert.ok(statuses.includes("synced"));

const backupText = manager.exportBackup();
const backup = JSON.parse(backupText);
assert.equal(backup.type, sync.BACKUP_TYPE);
assert.equal(backup.account_id, "account-one");
assert.ok(!backupText.includes("vocabRuntime"));
assert.throws(
  () => sync.validateBackup(backupText, "different-account"),
  /不属于当前登录账号/,
);

const tombstone = {
  data_type: "wrong_book",
  record_id: wrongId,
  payload: {},
  updated_at: new Date(Date.now() + 1000).toISOString(),
  deleted: true,
  client_id: "remote-client",
  client_version: "remote",
  server_version: 9,
};
manager.applyServerRecord(tombstone);
const staleBackup = JSON.stringify({
  ...backup,
  records: [{
    data_type: "wrong_book",
    record_id: wrongId,
    payload: { wrong_count: 99, correct_answer: "旧设备" },
    updated_at: backup.records[0].updated_at,
    deleted: false,
    server_version: 1,
  }],
});
const imported = manager.importBackup(staleBackup);
assert.equal(imported.imported, 0);
assert.equal(imported.ignored, 1);
assert.equal(manager.state.records[sync.recordKey("wrong_book", wrongId)].deleted, true);

const importedGoalId = sync.makeRecordId("goal", ["默认", "english"]);
const appliedBeforeImport = applied.length;
const offlineImport = manager.importBackup(JSON.stringify({
  ...backup,
  records: [{
    data_type: "daily_goal",
    record_id: importedGoalId,
    payload: { goal: 36 },
    updated_at: new Date().toISOString(),
    deleted: false,
    server_version: 0,
  }],
}));
assert.equal(offlineImport.imported, 1);
assert.equal(applied.length, appliedBeforeImport + 1);
assert.equal(applied.at(-1).payload.goal, 36);
assert.equal(manager.state.records[sync.recordKey("daily_goal", importedGoalId)].dirty, true);

const staleDevice = new sync.LearningSyncManager({
  storage: new MemoryStorage(),
  onlineSource: new OnlineSource(false),
  crypto: globalThis.crypto,
  transport: serverFixture(),
});
staleDevice.start({ accountId: "stale-device-account", clientVersion: "test-client" });
staleDevice.stop(false);
const staleWrongId = sync.makeRecordId("wrong", ["默认", "history", "古い端末"]);
const staleLocal = staleDevice.upsert({
  data_type: "wrong_book",
  record_id: staleWrongId,
  payload: { wrong_count: 3, correct_answer: "旧设备" },
  updated_at: new Date(Date.now() + 30_000).toISOString(),
});
staleDevice.applyServerRecord({
  data_type: "wrong_book",
  record_id: staleWrongId,
  payload: {},
  updated_at: new Date().toISOString(),
  deleted: true,
  client_id: "deleting-device",
  client_version: "remote",
  server_version: 12,
}, new Map([[sync.recordKey("wrong_book", staleWrongId), staleLocal.revision]]));
const deletionWinner = staleDevice.state.records[sync.recordKey("wrong_book", staleWrongId)];
assert.equal(deletionWinner.deleted, true);
assert.equal(deletionWinner.dirty, false);

const inFlightDelete = new sync.LearningSyncManager({
  storage: new MemoryStorage(),
  onlineSource: new OnlineSource(false),
  crypto: globalThis.crypto,
  transport: serverFixture(),
});
inFlightDelete.start({ accountId: "in-flight-delete", clientVersion: "test-client" });
inFlightDelete.stop(false);
const inFlightWrongId = sync.makeRecordId("wrong", ["默认", "history", "hello"]);
const submittedRecord = inFlightDelete.upsert({
  data_type: "wrong_book",
  record_id: inFlightWrongId,
  payload: { wrong_count: 1, correct_answer: "你好" },
  updated_at: new Date().toISOString(),
});
inFlightDelete.upsert({
  data_type: "wrong_book",
  record_id: inFlightWrongId,
  payload: {},
  deleted: true,
  updated_at: new Date(Date.now() + 1000).toISOString(),
});
inFlightDelete.applyServerRecord({
  data_type: "wrong_book",
  record_id: inFlightWrongId,
  payload: { wrong_count: 1, correct_answer: "你好" },
  updated_at: submittedRecord.updated_at,
  deleted: false,
  client_id: "same-device-old-request",
  client_version: "test-client",
  server_version: 4,
}, new Map([[sync.recordKey("wrong_book", inFlightWrongId), submittedRecord.revision]]));
const preservedDelete = inFlightDelete.state.records[sync.recordKey("wrong_book", inFlightWrongId)];
assert.equal(preservedDelete.deleted, true);
assert.equal(preservedDelete.dirty, true);

const submittedDelete = inFlightDelete.upsert({
  data_type: "wrong_book",
  record_id: inFlightWrongId,
  payload: {},
  deleted: true,
  updated_at: new Date(Date.now() + 2000).toISOString(),
});
inFlightDelete.upsert({
  data_type: "wrong_book",
  record_id: inFlightWrongId,
  payload: { wrong_count: 2, correct_answer: "重新导入" },
  deleted: false,
  updated_at: new Date(Date.now() + 3000).toISOString(),
});
inFlightDelete.applyServerRecord({
  data_type: "wrong_book",
  record_id: inFlightWrongId,
  payload: {},
  updated_at: new Date(Date.now() + 60_000).toISOString(),
  deleted: true,
  client_id: "same-device-old-delete",
  client_version: "test-client",
  server_version: 5,
}, new Map([[sync.recordKey("wrong_book", inFlightWrongId), submittedDelete.revision]]));
const preservedRestore = inFlightDelete.state.records[sync.recordKey("wrong_book", inFlightWrongId)];
assert.equal(preservedRestore.deleted, false);
assert.equal(preservedRestore.payload.correct_answer, "重新导入");
assert.equal(preservedRestore.dirty, true);

let stoppedSignal = null;
let releaseStoppedSync;
const stoppedTransport = new Promise((resolve) => { releaseStoppedSync = resolve; });
const stoppable = new sync.LearningSyncManager({
  storage: new MemoryStorage(),
  onlineSource: new OnlineSource(true),
  crypto: globalThis.crypto,
  transport: (_payload, options) => {
    stoppedSignal = options.signal;
    return stoppedTransport;
  },
});
stoppable.start({ accountId: "stop-in-flight", clientVersion: "test-client" });
stoppable.stop(false);
stoppable.upsert({
  data_type: "daily_goal",
  record_id: sync.makeRecordId("goal", ["默认", "english"]),
  payload: { goal: 22 },
});
const stoppedOperation = stoppable.syncNow();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(stoppedSignal?.aborted, false);
stoppable.stop();
assert.equal(stoppedSignal?.aborted, true);
releaseStoppedSync({ schema_version: sync.SCHEMA_VERSION, results: [], changes: [], next_since_version: 0, has_more: false });
assert.equal((await stoppedOperation).cancelled, true);

manager.destroy();
staleDevice.destroy();
inFlightDelete.destroy();
stoppable.destroy();
console.log("learning sync JS tests passed (local-first, backup validation, in-flight delete/restore safety)");
