import { handleInboundSupportEmail } from "../../functions/_lib/email-inbound.mjs";

const HEALTH_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function isFlagEnabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function buildHealthPayload(env) {
  const hasRestApi =
    String(env?.EMAIL_SEND_API_TOKEN || "").trim().length > 0 &&
    String(env?.EMAIL_CLOUDFLARE_ACCOUNT_ID || "").trim().length > 0;
  return {
    ok: true,
    service: "thewyj-support-inbound",
    environment: String(env?.WYJ_ENVIRONMENT || "development"),
    readiness: {
      d1_bound: Boolean(env?.WYJ_DB && typeof env.WYJ_DB.prepare === "function"),
      forward_target_configured: String(env?.EMAIL_FORWARD_TO_ADDRESS || "").trim().length > 0,
      email_binding_configured: Boolean(env?.EMAIL && typeof env.EMAIL.send === "function"),
      rest_api_configured: hasRestApi,
      email_sending_enabled: isFlagEnabled(env?.EMAIL_SENDING_ENABLED),
      auto_ack_enabled: isFlagEnabled(env?.EMAIL_INBOUND_AUTO_ACK_ENABLED),
    },
  };
}

export default {
  async email(message, env, ctx) {
    return handleInboundSupportEmail(message, env, ctx);
  },

  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (request.method !== "GET" || pathname !== "/health") {
      return Response.json(
        { ok: false, error: "not_found" },
        { status: 404, headers: HEALTH_HEADERS }
      );
    }
    return Response.json(buildHealthPayload(env), {
      status: 200,
      headers: HEALTH_HEADERS,
    });
  },
};
