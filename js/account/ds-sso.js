import { accountSessionHeaders, restoreAccountSession, subscribeAccountSessionChanges } from "../core/session.js?release=20261118-aeris-task30-web-release";

const status = document.querySelector("#sso-status");
const account = document.querySelector("#sso-account");
const approvalForm = document.querySelector("#sso-approval");
const mfaForm = document.querySelector("#sso-mfa");
const passwordField = document.querySelector("#sso-password");
const codeField = document.querySelector("#sso-mfa-code");
const mfaLabel = document.querySelector("#sso-mfa-label");
const cancel = new URL(document.querySelector("#sso-cancel").href);
const submitButtons = document.querySelectorAll("button[type=submit]");
let flow;

async function post(path, data, session) {
  if (session !== restoreAccountSession()) throw new Error("account_changed");
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Aeris-SSO": "1", ...accountSessionHeaders(session) },
    body: JSON.stringify(data),
    redirect: "error",
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.code || "sso_unavailable");
  return result;
}

function errorMessage(error) {
  switch (error.message) {
    case "authentication_required":
    case "canonical_session_invalid":
    case "session_expired":
    case "account_changed":
    case "password_change_required":
    case "policy_consent_required":
      return "请在 Aeris 登录并完成所需的账户安全确认。";
    case "task27_rate_limited":
      return "请求过于频繁，请稍后重试。";
    default:
      return "验证未完成。请检查身份信息，或从 DS 重新发起登录。";
  }
}

async function prepare() {
  approvalForm.hidden = true;
  mfaForm.hidden = true;
  passwordField.value = "";
  codeField.value = "";
  const next = { session: restoreAccountSession(), nonce: "", challenge: "" };
  flow = next;
  if (!Object.keys(accountSessionHeaders(next.session)).length) {
    status.textContent = "请在 Aeris 登录后返回此页。";
    return;
  }
  status.textContent = "正在检查 Aeris 登录状态…";
  try {
    const result = await post("/api/sso/ds/prepare" + window.location.search, {}, next.session);
    if (flow !== next) return;
    next.nonce = result.authorization;
    account.textContent = result.account;
    status.textContent = "确认当前账户后，重新验证身份以授权 DS 登录。";
    approvalForm.hidden = false;
  } catch (error) {
    if (flow === next) status.textContent = errorMessage(error);
  }
}

async function authorize(current, grant) {
  const result = await post("/api/sso/ds/approve", { authorization: current.nonce, grant, confirm: true }, current.session);
  if (flow !== current) return;
  const next = new URL(result.redirect);
  if (next.origin !== cancel.origin || next.pathname !== cancel.pathname || next.hash) {
    throw new Error("invalid_callback");
  }
  status.textContent = "正在返回 DS…";
  window.location.replace(next.href);
}

async function submit(event, verify) {
  event.preventDefault();
  const current = flow;
  if (!current?.nonce || (verify && !current.challenge)) return;
  const input = verify ? codeField : passwordField;
  const value = input.value;
  input.value = "";
  for (const button of submitButtons) button.disabled = true;
  try {
    const proof = verify
      ? await post("/api/security/stepup/verify", { challenge: current.challenge, code: value }, current.session)
      : await post("/api/security/stepup", { password: value, scope: "ds_sso_authorize:" + current.nonce }, current.session);
    if (flow !== current) return;
    if (proof.grant) {
      await authorize(current, proof.grant);
    } else if (!verify && proof.challenge) {
      current.challenge = proof.challenge;
      mfaLabel.textContent = proof.method === "email" ? "Aeris 邮箱验证码" : "Aeris 双重验证代码";
      approvalForm.hidden = true;
      mfaForm.hidden = false;
      status.textContent = "请完成 Aeris 双重验证。";
      codeField.focus();
    } else {
      throw new Error("sso_unavailable");
    }
  } catch (error) {
    if (flow === current) {
      if (error.message === "account_changed") await prepare();
      else status.textContent = errorMessage(error);
    }
  } finally {
    for (const button of submitButtons) button.disabled = false;
  }
}

approvalForm.addEventListener("submit", (event) => void submit(event, false));
mfaForm.addEventListener("submit", (event) => void submit(event, true));
subscribeAccountSessionChanges(() => void prepare());
window.addEventListener("pageshow", (event) => { if (event.persisted) void prepare(); });
void prepare();
