import assert from "node:assert/strict";

import { handleTask11Request } from "../functions/_lib/task11-api.mjs";

function contextFor(path, env = {}, options = {}) {
  return {
    env,
    data: { requestId: "task11-api-test" },
    request: new Request(`https://thewyj.uk${path}`, options),
    waitUntil() {},
  };
}

function schemaDatabase(routeFailure = "") {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("task11_metadata")) return { value: "1" };
              if (routeFailure) throw new Error(routeFailure);
              return null;
            },
            async all() {
              if (routeFailure) throw new Error(routeFailure);
              return { results: [] };
            },
            async run() {
              if (routeFailure) throw new Error(routeFailure);
              return { success: true };
            },
          };
        },
      };
    },
    async batch() { return []; },
  };
}

let completed = 0;

{
  let legacyCalls = 0;
  const response = await handleTask11Request(
    contextFor("/api/feedback/mine", {
      CLOUD_READS_ENABLED: "false",
      LEGACY_API_FALLBACK_ENABLED: "true",
    }, { headers: { "X-Session-Token": "test-token" } }),
    async () => {
      legacyCalls += 1;
      return Response.json({ ok: true, source: "legacy" });
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, "legacy");
  assert.equal(legacyCalls, 1);
  completed += 1;
}

{
  let legacyCalls = 0;
  const response = await handleTask11Request(
    contextFor("/api/learning/sync", {
      CLOUD_WRITES_ENABLED: "false",
      LEGACY_API_FALLBACK_ENABLED: "true",
    }, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": "test-token",
      },
      body: "{}",
    }),
    async () => {
      legacyCalls += 1;
      return Response.json({ ok: true, source: "legacy" });
    },
  );
  assert.equal((await response.json()).source, "legacy");
  assert.equal(legacyCalls, 1);
  completed += 1;
}

{
  const response = await handleTask11Request(
    contextFor("/api/changelog", { CLOUD_READS_ENABLED: "false" }),
    async () => {
      throw new Error("public changelog must use its static browser fallback");
    },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "cloud_reads_disabled");
  completed += 1;
}

{
  let legacyCalls = 0;
  const response = await handleTask11Request(
    contextFor("/api/feedback/mine", {
      CLOUD_READS_ENABLED: "true",
      LEGACY_API_FALLBACK_ENABLED: "true",
    }, { headers: { "X-Session-Token": "test-token" } }),
    async () => {
      legacyCalls += 1;
      return Response.json({ ok: true, source: "legacy-after-schema-failure" });
    },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, "legacy-after-schema-failure");
  assert.equal(legacyCalls, 1);
  completed += 1;
}

{
  const response = await handleTask11Request(
    contextFor("/api/changelog", {
      CLOUD_READS_ENABLED: "true",
      LEGACY_API_FALLBACK_ENABLED: "false",
    }),
    async () => { throw new Error("must not reach legacy"); },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "task11_database_unavailable");
  completed += 1;
}

{
  const response = await handleTask11Request(
    contextFor("/api/changelog", {
      CLOUD_READS_ENABLED: "true",
      LEGACY_API_FALLBACK_ENABLED: "false",
      WYJ_DB: {
        prepare() {
          return { bind: () => ({ first: async () => null }) };
        },
        async batch() { return []; },
      },
    }),
    async () => { throw new Error("must not reach legacy"); },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "task11_schema_not_ready");
  completed += 1;
}

{
  const response = await handleTask11Request(
    contextFor("/api/changelog", {
      CLOUD_READS_ENABLED: "true",
      LEGACY_API_FALLBACK_ENABLED: "false",
      D1_RATE_LIMIT_ENABLED: "false",
      WYJ_DB: schemaDatabase("D1 daily quota exceeded"),
    }),
    async () => { throw new Error("must not reach legacy"); },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "task11_quota_exhausted");
  completed += 1;
}

{
  const response = await handleTask11Request(
    contextFor("/api/telemetry", {
      CLOUD_WRITES_ENABLED: "true",
      LEGACY_API_FALLBACK_ENABLED: "false",
      D1_RATE_LIMIT_ENABLED: "false",
      WYJ_DB: schemaDatabase(),
    }, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature_id: "x".repeat(3000), outcome: "success" }),
    }),
    async () => { throw new Error("must not reach legacy"); },
  );
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "request_too_large");
  completed += 1;
}

{
  const response = await handleTask11Request(
    contextFor("/api/telemetry", { CLOUD_WRITES_ENABLED: "false" }, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature_id: "dashboard", outcome: "success" }),
    }),
    async () => {
      throw new Error("telemetry must not reach the legacy account backend");
    },
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    ok: true,
    recorded: false,
    reason: "cloud_writes_disabled",
    request_id: "task11-api-test",
  });
  completed += 1;
}

{
  const response = await handleTask11Request(
    contextFor("/api/feedback", {
      CLOUD_WRITES_ENABLED: "true",
      LEGACY_API_FALLBACK_ENABLED: "false",
    }, {
      method: "GET",
      headers: { "X-Session-Token": "test-token" },
    }),
    async () => {
      throw new Error("unsupported methods must not be proxied");
    },
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "POST");
  completed += 1;
}

console.log(`Task 11 API routing checks passed: ${completed}`);
