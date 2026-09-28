import { cleanupExpiredTransfers, ensureTask22Schema } from "../functions/_lib/task22-service.mjs";

async function runCleanup(env) {
  if (!await ensureTask22Schema(env.WYJ_DB)) {
    return { ok: false, code: "task22_schema_not_ready" };
  }
  const cleanup = await cleanupExpiredTransfers(env.WYJ_DB, env.WYJ_STORAGE, {
    limit: 250,
    scanOrphans: true,
    environment: env.WYJ_ENVIRONMENT,
  });
  if (cleanup.sessions_cleanup_pending || cleanup.sessions_retry_failed || cleanup.shares_failed) {
    console.error(JSON.stringify({
      event: "task22_cleanup_pending",
      environment: String(env.WYJ_ENVIRONMENT || "unknown"),
      sessions_cleanup_pending: cleanup.sessions_cleanup_pending,
      sessions_retry_failed: cleanup.sessions_retry_failed,
      shares_failed: cleanup.shares_failed,
    }));
  }
  return { ok: true, cleanup };
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCleanup(env).catch((error) => {
      console.error(JSON.stringify({
        event: "task22_cleanup_failed",
        environment: String(env.WYJ_ENVIRONMENT || "unknown"),
        error_name: String(error?.name || "Error"),
      }));
    }));
  },

  async fetch(request, env) {
    if (request.method !== "GET" || new URL(request.url).pathname !== "/health") {
      return new Response("Not found", { status: 404 });
    }
    return Response.json({
      ok: true,
      service: "wyj-task22-cleanup",
      environment: String(env.WYJ_ENVIRONMENT || "development"),
    }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  },
};

export const __testing = Object.freeze({ runCleanup });
