import { hasTask30, runPrivacyRetentionCleanup } from '../functions/_lib/task30-privacy-service.mjs';

async function runRetention(env) {
  const environment = String(env?.WYJ_ENVIRONMENT || 'development');
  if (!env?.WYJ_DB || typeof env.WYJ_DB.prepare !== 'function') {
    return { ok: false, code: 'd1_binding_missing', environment };
  }
  if (!(await hasTask30(env.WYJ_DB))) {
    return { ok: false, code: 'task30_schema_not_ready', environment };
  }
  const cleanup = await runPrivacyRetentionCleanup(
    { env, data: { requestId: `cron:${crypto.randomUUID()}` } },
    {
      triggerSource: 'scheduled',
      triggeredBy: 'worker:thewyj-task30-retention',
      limit: 25,
      includeLegacyShareSweep: false,
      forceRetry: false,
    },
  );
  const summary = cleanup.summary || {};
  console.log(
    JSON.stringify({
      event: 'task30_retention_scheduled',
      environment,
      run_id: cleanup.run_id,
      status: cleanup.status,
      pending_erasure_requests_retried: Number(summary.pending_erasure_requests_retried || 0),
      interrupted_account_erasures_resumed: Number(summary.interrupted_account_erasures_resumed || 0),
      failed_erasure_requests: Number(summary.failed_erasure_requests || 0),
      email_inbound_expired_deleted: Number(summary.email_inbound_expired_deleted || 0),
      task12_expired_sessions_deleted: Number(summary.task12_expired_sessions_deleted || 0),
      error_count: Array.isArray(summary.errors) ? summary.errors.length : 0,
    }),
  );
  if (cleanup.status !== 'completed') {
    console.error(
      JSON.stringify({
        event: 'task30_retention_partial_or_failed',
        environment,
        run_id: cleanup.run_id,
        failed_erasure_requests: Number(summary.failed_erasure_requests || 0),
        error_count: Array.isArray(summary.errors) ? summary.errors.length : 0,
      }),
    );
  }
  return { ok: true, cleanup };
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runRetention(env).catch((error) => {
        console.error(
          JSON.stringify({
            event: 'task30_retention_worker_failed',
            environment: String(env?.WYJ_ENVIRONMENT || 'unknown'),
            error_name: String(error?.name || 'Error'),
          }),
        );
      }),
    );
  },

  async fetch(request, env) {
    if (request.method !== 'GET' || new URL(request.url).pathname !== '/health') {
      return new Response('Not found', { status: 404 });
    }
    const schemaReady = await hasTask30(env?.WYJ_DB).catch(() => false);
    return Response.json(
      {
        ok: true,
        service: 'thewyj-task30-retention',
        environment: String(env?.WYJ_ENVIRONMENT || 'development'),
        schema_ready: schemaReady,
      },
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  },
};

export const __testing = Object.freeze({ runRetention });
