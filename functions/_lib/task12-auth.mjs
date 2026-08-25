import { Task12Error } from "./task12-model.mjs";
import { ensureTask12Schema, resolveSessionState } from "./task12-service.mjs";

export async function resolveTask12Account(context, options = {}) {
  const token = String(context.request.headers.get("X-Session-Token") || "").trim();
  if (!token) return { authenticated: false, status: 401, code: "authentication_required" };
  if (!await ensureTask12Schema(context.env?.WYJ_DB)) {
    throw new Task12Error("云端账户数据结构尚未就绪", 503, "task12_schema_not_ready", true);
  }
  const state = await resolveSessionState(context.env.WYJ_DB, token, { touch: options.touch !== false });
  if (!state.account) return { authenticated: false, status: state.status, code: state.code };
  return { authenticated: true, account: state.account };
}
