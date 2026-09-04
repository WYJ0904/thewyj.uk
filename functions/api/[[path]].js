import { apiError } from "../_lib/cloudflare-foundation.mjs";
import { handleTask11Request } from "../_lib/task11-api.mjs";
import { handleTask12Request } from "../_lib/task12-api.mjs";
import { handleTask13Request } from "../_lib/task13-api.mjs";
import { handleTask14Request } from "../_lib/task14-api.mjs";
import { handleTask15Request } from "../_lib/task15-api.mjs";
import { handleTask16Request } from "../_lib/task16-api.mjs";
import { handleTask18Request } from "../_lib/task18-api.mjs";
import { handleTask20Request } from "../_lib/task20-api.mjs";
import { resolveTask12Account } from "../_lib/task12-auth.mjs";
import { recordAdminAction } from "../_lib/task18-service.mjs";

const SENSITIVE_ADMIN_ACTIONS = Object.freeze({
  "/api/admin/secret": ["password_reset", "user", "user_id"],
  "/api/admin/ban": ["user_ban_state", "user", "user_id"],
  "/api/admin/logout-user": ["user_force_logout", "user", "user_id"],
  "/api/admin/delete-user": ["user_delete", "user", "user_id"],
  "/api/admin/recharge/process": ["payment_review", "payment_order", "request_id"],
  "/api/admin/membership/manage": ["membership_manage", "user", "user_id"],
  "/api/admin/membership": ["membership_manage_legacy", "user", "user_id"],
  "/api/admin/entitlement": ["entitlement_manage", "user", "user_id"],
  "/api/admin/feedback/update": ["feedback_manage", "feedback", "feedback_id"],
  "/api/admin/task11/import": ["task11_import", "migration", "source_key"],
  "/api/admin/task13/import": ["task13_import", "migration", "source_key"],
  "/api/admin/task14/cleanup": ["task14_cleanup", "operation", "mode"],
  "/api/admin/task14/import": ["task14_import", "migration", "source_key"],
  "/api/admin/task14/import/rollback": ["task14_import_rollback", "migration", "source_key"],
  "/api/admin/task15/import": ["task15_import", "migration", "source_key"],
  "/api/admin/task15/import/rollback": ["task15_import_rollback", "migration", "source_key"],
  "/api/admin/task16/import": ["task16_import", "migration", "source_key"],
  "/api/admin/task16/import/rollback": ["task16_import_rollback", "migration", "source_key"],
});

async function auditSensitiveAdminRequest(context, response, bodyRequest, descriptor) {
  if (!descriptor || !context.env?.WYJ_DB) return;
  try {
    const authenticated = await resolveTask12Account(context, { touch: false });
    if (!authenticated.authenticated || !authenticated.account.is_admin) return;
    let payload = {};
    try { payload = await bodyRequest.json(); } catch (_) { payload = {}; }
    const [action, targetType, targetField] = descriptor;
    let errorCode = "";
    if (!response.ok) {
      try {
        const errorPayload = await response.clone().json();
        errorCode = String(errorPayload?.code || errorPayload?.error?.code || "admin_request_failed");
      }
      catch (_) { errorCode = "admin_request_failed"; }
    }
    await recordAdminAction(context.env.WYJ_DB, authenticated.account, {
      targetType,
      targetId: String(payload?.[targetField] || "").slice(0, 120),
      targetLabel: action,
      action,
      success: response.ok,
      after: { http_status: response.status },
      errorCode,
      requestId: context.data?.requestId || "",
    });
  } catch (_) {
    // Auditing must not replace the original API response during staged schema rollout.
  }
}

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  const sensitiveDescriptor = context.request.method.toUpperCase() === "POST"
    ? SENSITIVE_ADMIN_ACTIONS[pathname]
    : null;
  const bodyRequest = sensitiveDescriptor ? context.request.clone() : null;
  const response = await handleTask12Request(context)
    || await handleTask20Request(context)
    || await handleTask18Request(context)
    || await handleTask13Request(context)
    || await handleTask14Request(context)
    || await handleTask11Request(context)
    || await handleTask15Request(context)
    || await handleTask16Request(context)
    || apiError("api_route_not_found", "接口不存在", 404, context.data?.requestId || "");
  if (sensitiveDescriptor) {
    await auditSensitiveAdminRequest(context, response, bodyRequest, sensitiveDescriptor);
  }
  return response;
}
