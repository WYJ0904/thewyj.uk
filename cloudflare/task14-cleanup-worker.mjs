import { cleanupExpiredShares, ensureTask14Schema } from "../functions/_lib/task14-service.mjs";

async function runCleanup(env) {
  if (!await ensureTask14Schema(env.WYJ_DB)) {
    return { ok: false, code: "task14_schema_not_ready" };
  }
  const cleanup = await cleanupExpiredShares(env.WYJ_DB, env.WYJ_STORAGE, {
    limit: 250,
    scanOrphans: true,
    environment: env.WYJ_ENVIRONMENT,
  });
  return { ok: true, cleanup };
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCleanup(env).catch((error) => {
      console.error(JSON.stringify({
        event: "task14_cleanup_failed",
        environment: String(env.WYJ_ENVIRONMENT || "unknown"),
        error_name: String(error?.name || "Error"),
      }));
    }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/health" || request.method !== "GET") return new Response("Not found", { status: 404 });
    return Response.json({
      ok: true,
      service: "wyj-task14-cleanup",
      environment: String(env.WYJ_ENVIRONMENT || "development"),
    }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  },
};

export const __testing = Object.freeze({ runCleanup });
