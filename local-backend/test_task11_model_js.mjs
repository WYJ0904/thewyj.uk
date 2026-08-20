import assert from "node:assert/strict";
import {
  Task11Error,
  mergeLearningRecord,
  validateFeedbackInput,
  validateLearningSyncRequest,
  validateTelemetryInput,
} from "../functions/_lib/task11-model.mjs";

let completed = 0;

function change(overrides = {}) {
  return {
    data_type: "daily_goal",
    record_id: "goal|2026-08-20",
    payload: { target: 20 },
    updated_at: "2026-08-20T08:00:00Z",
    deleted: false,
    base_server_version: 0,
    ...overrides,
  };
}

function request(changes) {
  return {
    schema_version: 1,
    client_id: "client-one-2026",
    client_version: "test-1",
    since_version: 0,
    changes,
  };
}

{
  const feedback = validateFeedbackInput({
    type: "feature_suggestion",
    title: "  更清楚的统计  ",
    content: "希望显示每周学习摘要。",
    route: "/select",
    tool_id: "",
    app_version: "2026.08.20",
    browser_info: "Chrome Mobile",
    error_code: "",
  });
  assert.equal(feedback.title, "更清楚的统计");
  assert.equal(feedback.feedback_type, "feature_suggestion");
  assert.throws(
    () => validateFeedbackInput({
      type: "other",
      title: "包含令牌",
      content: "session=abcdefghijklmno",
    }),
    (error) => error instanceof Task11Error && error.code === "feedback_sensitive_data",
  );
  completed += 1;
}

{
  const cleaned = validateLearningSyncRequest(request([change()]));
  assert.equal(cleaned.changes.length, 1);
  assert.equal(cleaned.changes[0].updated_at, "2026-08-20T08:00:00Z");
  assert.throws(
    () => validateLearningSyncRequest(request([change(), change()])),
    (error) => error.code === "learning_sync_duplicate_change",
  );
  assert.throws(
    () => validateLearningSyncRequest(request([change({ data_type: "achievement", deleted: true })])),
    (error) => error.code === "learning_sync_achievement_monotonic",
  );
  completed += 1;
}

{
  const existing = {
    data_type: "achievement",
    record_id: "achievement|first-test",
    payload_json: JSON.stringify({ unlocked: true, count: 5, tiers: ["bronze"] }),
    updated_at: "2026-08-20T08:00:00Z",
    deleted: 0,
    client_id: "client-one-2026",
    client_version: "test-1",
    server_version: 3,
    created_at: "2026-08-20T08:00:01Z",
    server_updated_at: "2026-08-20T08:00:01Z",
  };
  const result = mergeLearningRecord(existing, {
    ...change({
      data_type: "achievement",
      record_id: "achievement|first-test",
      payload: { unlocked: false, count: 2, tiers: ["silver"] },
      base_server_version: 2,
      client_id: "client-two-2026",
      client_version: "test-2",
      updated_at: "2026-08-20T09:00:00Z",
    }),
  });
  assert.equal(result.canonical.payload.unlocked, true);
  assert.equal(result.canonical.payload.count, 5);
  assert.deepEqual(result.canonical.payload.tiers, ["bronze", "silver"]);
  assert.equal(result.merged, true);
  completed += 1;
}

{
  const existing = {
    data_type: "wrong_book",
    record_id: "wrong|japanese|電話",
    payload_json: JSON.stringify({ wrong_count: 4, accepted: ["电话"], rubric: { accepted: ["电话"] } }),
    updated_at: "2026-08-20T08:00:00Z",
    deleted: 0,
    client_id: "client-one-2026",
    client_version: "test-1",
    server_version: 8,
    created_at: "2026-08-20T08:00:01Z",
    server_updated_at: "2026-08-20T08:00:01Z",
  };
  const result = mergeLearningRecord(existing, {
    ...change({
      data_type: "wrong_book",
      record_id: "wrong|japanese|電話",
      payload: { wrong_count: 2, accepted: ["電話"], rubric: { accepted: ["電話"] } },
      base_server_version: 7,
      client_id: "client-two-2026",
      client_version: "test-2",
      updated_at: "2026-08-20T09:00:00Z",
    }),
  });
  assert.equal(result.canonical.payload.wrong_count, 4);
  assert.deepEqual(result.canonical.payload.accepted, ["电话", "電話"]);
  assert.equal(result.merged, true);
  completed += 1;
}

{
  const tombstone = {
    data_type: "test_history",
    record_id: "history|one",
    payload_json: "{}",
    updated_at: "2026-08-20T10:00:00Z",
    deleted: 1,
    client_id: "client-two-2026",
    client_version: "test-2",
    server_version: 12,
    created_at: "2026-08-20T10:00:01Z",
    server_updated_at: "2026-08-20T10:00:01Z",
  };
  const result = mergeLearningRecord(tombstone, {
    ...change({
      data_type: "test_history",
      record_id: "history|one",
      payload: { score: 99 },
      base_server_version: 4,
      client_id: "client-old-2026",
      client_version: "old",
      updated_at: "2026-08-20T09:00:00Z",
    }),
  });
  assert.equal(result.changed, false);
  assert.equal(result.canonical.deleted, true);
  assert.equal(result.merged, true);
  completed += 1;
}

{
  assert.deepEqual(validateTelemetryInput({
    feature_id: "learning.sync",
    outcome: "success",
    latency_ms: 620,
    error_code: "",
  }), {
    feature_id: "learning.sync",
    outcome: "success",
    latency_bucket: "500_1999",
    error_code: "",
  });
  assert.throws(
    () => validateTelemetryInput({
      feature_id: "learning.sync",
      outcome: "failure",
      latency_ms: 20,
      raw_text: "private input",
    }),
    (error) => error.code === "telemetry_fields_forbidden",
  );
  completed += 1;
}

console.log(`Task 11 model checks passed: ${completed}`);
