import { apiError, featureFlags, jsonResponse } from "../_lib/cloudflare-foundation.mjs";
import { handleTask11Request } from "../_lib/task11-api.mjs";
import { handleTask12Request } from "../_lib/task12-api.mjs";
import { handleTask13Request } from "../_lib/task13-api.mjs";
import { handleTask14Request } from "../_lib/task14-api.mjs";
import { handleTask15Request } from "../_lib/task15-api.mjs";
import { handleTask16Request } from "../_lib/task16-api.mjs";
import { handleTask18Request } from "../_lib/task18-api.mjs";
import { handleTask20Request } from "../_lib/task20-api.mjs";
import { handleTask21Request } from "../_lib/task21-api.mjs";
import { handleTask22Request } from "../_lib/task22-api.mjs";
import { handleSecureFileRequest } from '../_lib/secure-file-api.mjs';
import { readFileJson } from '../_lib/secure-file-policy.mjs';
import { handleTask25Request } from "../_lib/task25-api.mjs";
import { handlePublicUiRequest } from "../_lib/p07-ui-api.mjs";
import { handleTask26Request } from "../_lib/task26-api.mjs";
import { handleTtsRequest } from "../_lib/tts-api.mjs";
import { handleEmailRequest } from "../_lib/email-api.mjs";
import { cookieOnlyWebSession, resolveTask12Account, WEB_SESSION_CONTEXT_HEADER, webSessionContext } from "../_lib/task12-auth.mjs";
import { recordAdminAction } from "../_lib/task18-service.mjs";

import { handleTask27Request } from '../_lib/task27-api.mjs';
import { handleTask27EmailRequest } from '../_lib/task27-email-gateway.mjs';
import { handleTask29Request } from '../_lib/task29-backup-api.mjs';
import { handleTask30Request } from '../_lib/task30-privacy-api.mjs';
import { handleDsNativeRequest } from '../_lib/ds-native-api.mjs';

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
  "/api/admin/task22/cleanup": ["task22_cleanup", "operation", "mode"],
  "/api/admin/email/test-send": ["email_test_send", "email", "recipient"],
  "/api/admin/email/send": ["email_admin_send", "email_batch", "preview_token"],
  "/api/admin/email/deliveries/retry": ["email_delivery_retry", "email_delivery", "delivery_id"],
  "/api/admin/email/inbound/reply": ["email_inbound_reply", "email_thread", "thread_id"],
  "/api/admin/email/inbound/status": ["email_inbound_status", "email_thread", "thread_id"],
  "/api/admin/email/templates": ["email_template_update", "email_template", "template_key"],
  "/api/admin/email/user-binding": ["email_user_binding_update", "user", "user_id"],
});

async function auditSensitiveAdminRequest(context, response, bodyRequest, descriptor) {
  if (!descriptor || !context.env?.WYJ_DB) return;
  try {
    const authenticated = await resolveTask12Account(context, { touch: false });
    if (!authenticated.authenticated || !authenticated.account.is_admin) return;
    let payload = {};
    try { payload = await readFileJson(bodyRequest,512*1024); } catch (_) { payload = {}; }
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
  const url = new URL(context.request.url);
  const pathname = url.pathname;
  const requestedContext = context.request.headers.get(WEB_SESSION_CONTEXT_HEADER);
  const requestId = context.data?.requestId || "";
  if (pathname === "/api/auth/session") {
    if (context.request.method !== "GET") return apiError("method_not_allowed", "仅支持读取会话", 405, requestId, { headers: { Allow: "GET" } });
    const token = requestedContext === "restore" && !url.search && cookieOnlyWebSession(context.request);
    if (!token) return apiError("authentication_required", "请先登录", 401, requestId);
    if (!featureFlags(context.env).task12CloudAccounts) return apiError("cloud_accounts_disabled", "云端账户服务当前未启用", 503, requestId);
    const auth = await resolveTask12Account(context, { token, touch: false });
    if (!auth.authenticated) return apiError(auth.code, "账户会话不可用", auth.status, requestId);
    return jsonResponse({ account_context: await webSessionContext(token) }, 200, requestId);
  }
  if (requestedContext !== null) {
    const token = cookieOnlyWebSession(context.request);
    if (!token || requestedContext !== await webSessionContext(token)) {
      return apiError("canonical_session_invalid", "登录会话已变更，请重新验证", 401, requestId);
    }
    // Use the already verified session through the existing API and step-up guards.
    const headers = new Headers(context.request.headers);
    headers.delete(WEB_SESSION_CONTEXT_HEADER);
    headers.set("X-Session-Token", token);
    context = { ...context, request: new Request(context.request, { headers }) };
  }
  const sensitiveDescriptor = context.request.method.toUpperCase() === "POST"
    ? SENSITIVE_ADMIN_ACTIONS[pathname]
    : null;
  const bodyRequest = sensitiveDescriptor ? context.request.clone() : null;
  const response = await handleDsNativeRequest(context)
    || await handleTask27EmailRequest(context,handleEmailRequest)
    || await handleTask27Request(context)
    || await handleTask29Request(context)
    || await handleTask30Request(context)
    || await handleTask12Request(context)
    || await handleTask20Request(context)
    || await handleTask18Request(context)
    || await handleTask25Request(context)
    || await handlePublicUiRequest(context)
    || await handleTask26Request(context)
    || await handleTask21Request(context)
    || await handleSecureFileRequest(context)
    || await handleTask22Request(context)
    || await handleTtsRequest(context)
    || await handleEmailRequest(context)
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
