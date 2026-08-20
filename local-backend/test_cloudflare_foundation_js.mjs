import assert from "node:assert/strict";
import {
  apiError,
  cloudMiddleware,
  cloudStatusResponse,
  enforceCloudRateLimit,
  featureFlags,
  requestIdFor,
  sameOriginResult,
  statusRouteResponse,
  statusSourceFor,
  withSecurityHeaders,
} from "../functions/_lib/cloudflare-foundation.mjs";

let completed = 0;

{
  const flags = featureFlags({
    CLOUD_FOUNDATION_ENABLED: "yes",
    CLOUD_READS_ENABLED: "1",
    CLOUD_WRITES_ENABLED: "false",
    TASK11_CLOUD_READS_ENABLED: "false",
    TASK11_CLOUD_WRITES_ENABLED: "true",
    CLOUD_STATUS_MODE: "CLOUD",
    CLOUD_RATE_LIMIT_REQUESTS: "9999",
    CLOUD_RATE_LIMIT_WINDOW_SECONDS: "1",
  });
  assert.equal(flags.cloudFoundation, true);
  assert.equal(flags.cloudReads, true);
  assert.equal(flags.cloudWrites, false);
  assert.equal(flags.task11CloudReads, false);
  assert.equal(flags.task11CloudWrites, true);
  assert.equal(flags.statusMode, "cloud");
  assert.equal(flags.rateLimit, 600);
  assert.equal(flags.rateWindowSeconds, 10);
  completed += 1;
}

{
  let legacyCalls = 0;
  const legacyProxy = async () => {
    legacyCalls += 1;
    return new Response(JSON.stringify({ ok: true, source: "legacy" }));
  };
  const legacyResponse = await statusRouteResponse({
    env: { CLOUD_STATUS_MODE: "legacy" },
    data: {},
    request: new Request("https://thewyj.uk/api/status"),
  }, legacyProxy);
  assert.equal((await legacyResponse.json()).source, "legacy");
  assert.equal(legacyCalls, 1);

  const disabled = await statusRouteResponse({
    env: { CLOUD_FOUNDATION_ENABLED: "false" },
    data: {},
    request: new Request("https://thewyj.uk/api/status?source=cloud"),
  }, legacyProxy);
  assert.equal(disabled.status, 404);
  assert.equal((await disabled.json()).code, "cloud_foundation_disabled");

  const method = await statusRouteResponse({
    env: { CLOUD_FOUNDATION_ENABLED: "true" },
    data: {},
    request: new Request("https://thewyj.uk/api/status?source=cloud", { method: "POST" }),
  }, legacyProxy);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("Allow"), "GET, HEAD");
  completed += 1;
}

{
  const valid = new Request("https://thewyj.uk/api/status", { headers: { "X-Request-ID": "client-request-123" } });
  assert.equal(requestIdFor(valid), "client-request-123");
  const generated = requestIdFor(new Request("https://thewyj.uk/api/status", { headers: { "X-Request-ID": "bad id" } }));
  assert.match(generated, /^[0-9a-f-]{36}$/i);
  completed += 1;
}

{
  assert.equal(sameOriginResult(new Request("https://thewyj.uk/api/status")).allowed, true);
  assert.equal(sameOriginResult(new Request("https://thewyj.uk/api/write", {
    method: "POST",
    headers: { Origin: "https://thewyj.uk" },
  })).allowed, true);
  assert.equal(sameOriginResult(new Request("https://thewyj.uk/api/write", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
  })).allowed, false);
  assert.equal(sameOriginResult(new Request("https://thewyj.uk/api/write", {
    method: "POST",
    headers: { "Sec-Fetch-Site": "same-site" },
  })).allowed, false);
  assert.equal(sameOriginResult(new Request("https://thewyj.uk/api/write", { method: "POST" })).allowed, true);
  completed += 1;
}

{
  const error = apiError("example_error", "Example", 503, "request-123", { retryable: true });
  assert.equal(error.status, 503);
  assert.deepEqual(await error.json(), {
    ok: false,
    error: "Example",
    code: "example_error",
    retryable: true,
    request_id: "request-123",
  });
  const secured = withSecurityHeaders(new Response("ok"), "request-123", true);
  assert.equal(secured.headers.get("X-Request-ID"), "request-123");
  assert.equal(secured.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(secured.headers.get("Cache-Control"), "no-store");
  completed += 1;
}

function fakeRateLimitDatabase({ fail = "", schemaVersion = "1" } = {}) {
  let count = 0;
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (fail) throw new Error(fail);
              if (sql.includes("cloud_runtime_metadata")) return { value: schemaVersion };
              count += 1;
              return { request_count: count, expires_at: Math.floor(Date.now() / 1000) + 60 };
            },
            async run() {
              if (fail) throw new Error(fail);
              return { success: true };
            },
          };
        },
      };
    },
  };
}

{
  const waits = [];
  const context = {
    env: { WYJ_DB: fakeRateLimitDatabase() },
    request: new Request("https://thewyj.uk/api/status"),
    waitUntil(promise) { waits.push(promise); },
  };
  const flags = { d1RateLimit: true, rateLimit: 1, rateWindowSeconds: 60 };
  const first = await enforceCloudRateLimit(context, flags);
  const second = await enforceCloudRateLimit(context, flags);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  await Promise.all(waits);
  completed += 1;
}

{
  const result = await enforceCloudRateLimit({
    env: { WYJ_DB: fakeRateLimitDatabase({ fail: "D1 daily quota exceeded" }) },
    request: new Request("https://thewyj.uk/api/status"),
    waitUntil() {},
  }, { d1RateLimit: true, rateLimit: 120, rateWindowSeconds: 60 });
  assert.equal(result.allowed, true, "quota exhaustion must not take the legacy application offline");
  assert.equal(result.degraded, true);
  assert.equal(result.reason, "quota_exhausted");
  completed += 1;
}

{
  const env = {
    WYJ_ENVIRONMENT: "preview",
    CLOUD_FOUNDATION_ENABLED: "true",
    CLOUD_STATUS_MODE: "cloud",
    CLOUD_DEEP_HEALTH_CHECKS: "true",
    D1_RATE_LIMIT_ENABLED: "false",
    WYJ_DB: fakeRateLimitDatabase(),
    WYJ_STORAGE: {},
    AI: {},
  };
  const request = new Request("https://preview.example/api/status?source=cloud", {
    headers: { "X-Request-ID": "status-request-123" },
  });
  const response = await cloudStatusResponse({ env, request, data: {} });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.status, "ok");
  assert.equal(data.environment, "preview");
  assert.equal(data.request_id, "status-request-123");
  assert.equal(data.auth, false);
  assert.equal(data.features.payment_cloud_migration, false);
  assert.deepEqual(data.bindings, { d1: true, r2: true, workers_ai: true });

  const localWithoutAiResponse = await cloudStatusResponse({
    env: {
      WYJ_ENVIRONMENT: "development",
      CLOUD_DEEP_HEALTH_CHECKS: "true",
      WORKERS_AI_ENABLED: "false",
      D1_RATE_LIMIT_ENABLED: "false",
      WYJ_DB: fakeRateLimitDatabase(),
      WYJ_STORAGE: {},
    },
    request: new Request("http://127.0.0.1:8788/api/status?source=cloud"),
    data: {},
  });
  const localWithoutAi = await localWithoutAiResponse.json();
  assert.equal(localWithoutAi.status, "ok");
  assert.equal(localWithoutAi.bindings.workers_ai, false);

  const degradedResponse = await cloudStatusResponse({
    env: { CLOUD_FOUNDATION_ENABLED: "true", D1_RATE_LIMIT_ENABLED: "false" },
    request: new Request("https://thewyj.uk/api/status?source=cloud"),
    data: {},
  });
  const degraded = await degradedResponse.json();
  assert.equal(degradedResponse.status, 200);
  assert.equal(degraded.status, "degraded");
  assert.ok(degraded.degraded_reasons.includes("d1_binding_missing"));

  const task11SchemaFailureResponse = await cloudStatusResponse({
    env: {
      CLOUD_FOUNDATION_ENABLED: "true",
      CLOUD_READS_ENABLED: "false",
      CLOUD_WRITES_ENABLED: "false",
      TASK11_CLOUD_READS_ENABLED: "true",
      TASK11_CLOUD_WRITES_ENABLED: "false",
      CLOUD_DEEP_HEALTH_CHECKS: "true",
      D1_RATE_LIMIT_ENABLED: "false",
      WYJ_STORAGE: {},
      WYJ_DB: {
        prepare(sql) {
          return {
            bind() {
              return {
                async first() {
                  if (sql.includes("task11_metadata")) throw new Error("no such table: task11_metadata");
                  return { value: "1" };
                },
              };
            },
          };
        },
      },
    },
    request: new Request("https://preview.example/api/status?source=cloud"),
    data: {},
  });
  const task11SchemaFailure = await task11SchemaFailureResponse.json();
  assert.equal(task11SchemaFailure.status, "degraded");
  assert.ok(task11SchemaFailure.degraded_reasons.includes("task11_binding_unavailable"));
  completed += 1;
}

{
  const legacyRequest = new Request("https://thewyj.uk/api/status");
  assert.equal(statusSourceFor(legacyRequest, { CLOUD_STATUS_MODE: "legacy" }), "legacy");
  assert.equal(statusSourceFor(legacyRequest, { CLOUD_STATUS_MODE: "cloud" }), "cloud");
  assert.equal(statusSourceFor(new Request("https://thewyj.uk/api/status?source=cloud"), {}), "cloud");
  assert.equal(statusSourceFor(new Request("https://thewyj.uk/api/status?source=legacy"), { CLOUD_STATUS_MODE: "cloud" }), "legacy");
  completed += 1;
}

{
  const crossOrigin = await cloudMiddleware({
    env: {},
    data: {},
    request: new Request("https://thewyj.uk/api/write", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    }),
    async next() { throw new Error("must not run"); },
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).code, "cross_origin_rejected");

  const ok = await cloudMiddleware({
    env: {},
    data: {},
    request: new Request("https://thewyj.uk/api/status"),
    async next() { return new Response("ready"); },
  });
  assert.equal(await ok.text(), "ready");
  assert.equal(ok.headers.get("X-Frame-Options"), "DENY");

  const originalError = console.error;
  console.error = () => {};
  try {
    const failed = await cloudMiddleware({
      env: {},
      data: {},
      request: new Request("https://thewyj.uk/api/status"),
      async next() { throw new Error("secret stack details"); },
    });
    const payload = await failed.json();
    assert.equal(failed.status, 500);
    assert.equal(payload.code, "internal_error");
    assert.doesNotMatch(JSON.stringify(payload), /secret stack details/);
  } finally {
    console.error = originalError;
  }
  completed += 1;
}

console.log(`Cloudflare foundation checks passed: ${completed}`);
