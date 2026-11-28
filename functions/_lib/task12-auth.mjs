import { Task12Error } from "./task12-model.mjs";
import { ensureTask12Schema, resolveSessionState } from "./task12-service.mjs";
import { task20TokenFromRequest, isTask20AndroidClient, webDownloadCookieName } from "./task20-model.mjs";
import { sha256Hex } from "./cloudflare-foundation.mjs";
import { policyReacceptRequired } from './task27-policy.mjs';

export const WEB_SESSION_CONTEXT_HEADER = "X-Aeris-Session-Context";

export function cookieOnlyWebSession(request) {
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  const matchingOrigin = origin === new URL(request.url).origin;
  if ((site && site !== "same-origin") || (origin && !matchingOrigin)
    || (!["GET", "HEAD"].includes(request.method) && site !== "same-origin" && !matchingOrigin)
    || request.headers.has("X-Session-Token") || isTask20AndroidClient(request)) return "";
  const prefix = webDownloadCookieName(request) + "=";
  const cookies = (request.headers.get("Cookie") || "").split(";").map(entry => entry.trim());
  const matching = cookies.filter(entry => entry.startsWith(prefix));
  const token = matching.length === 1 ? matching[0].slice(prefix.length) : "";
  return /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : "";
}

export const webSessionContext = token => sha256Hex("aeris-web-session-context-v1:" + token);

export async function resolveTask12Account(context, options = {}) {
  const token = options.token !== undefined ? String(options.token || "") : task20TokenFromRequest(context.request);
  if (!token) return { authenticated: false, status: 401, code: "authentication_required" };
  if (!await ensureTask12Schema(context.env?.WYJ_DB)) {
    throw new Task12Error("云端账户数据结构尚未就绪", 503, "task12_schema_not_ready", true);
  }
  const state = await resolveSessionState(context.env.WYJ_DB, token, { touch: options.touch !== false });
  if (!state.account) return { authenticated: false, status: state.status, code: state.code };
  const path = new URL(context.request.url).pathname;
  if (path !== '/api/policies/accept' && await policyReacceptRequired(context.env.WYJ_DB,state.account.id)) {
    return {authenticated:false,status:428,code:'policy_consent_required'};
  }
  return { authenticated: true, account: state.account, token };
}
