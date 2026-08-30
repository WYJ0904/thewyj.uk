import assert from "node:assert/strict";

const BASE_URL = process.env.WYJ_TEST_BASE || "http://127.0.0.1:8894";
const CDP_URL = process.env.WYJ_CDP_URL || "http://127.0.0.1:9225";
const ADMIN_SECRET = String(process.env.WYJ_TEST_ADMIN_SECRET || "");
const RUN_ID = Date.now().toString(36);
const USERNAME = `task18ui${RUN_ID}`.slice(0, 32);
const USER_SECRET = "Task18-Browser-User-2026!";
const XSS_BODY = '<img src=x onerror="globalThis.task18Xss=1"><script>globalThis.task18Xss=2</script>';

assert.ok(ADMIN_SECRET.length >= 16, "WYJ_TEST_ADMIN_SECRET is required");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), 10_000);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP websocket error")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  send(method, params = {}, sessionId = "") {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.socket?.close();
  }
}

async function api(pathname, payload = null, token = "") {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: payload === null ? "GET" : "POST",
    headers: {
      ...(payload === null ? {} : { "Content-Type": "application/json" }),
      ...(token ? { "X-Session-Token": token } : {}),
    },
    body: payload === null ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function main() {
  const adminLogin = await api("/api/login", { username: "wyj", secret: ADMIN_SECRET });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
  const adminSession = adminLogin.data.session;
  const adminUserId = String(adminLogin.data.account?.id || "");
  assert.ok(adminSession?.length > 20);
  assert.ok(adminUserId, "owner user ID is required");

  const version = await fetch(`${CDP_URL}/json/version`).then((response) => response.json());
  const client = new CdpClient(version.webSocketDebuggerUrl);
  await client.connect();
  const context = await client.send("Target.createBrowserContext");
  const target = await client.send("Target.createTarget", { url: "about:blank", browserContextId: context.browserContextId });
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  const send = (method, params = {}) => client.send(method, params, sessionId);
  const runtimeErrors = [];

  client.listeners.add((message) => {
    if (message.sessionId && message.sessionId !== sessionId) return;
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "runtime exception");
    }
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      const text = String(message.params.entry.text || "");
      if (!/^Failed to load resource: the server responded with a status of \d+/.test(text)) runtimeErrors.push(text);
    }
  });

  await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable"), send("Network.enable")]);
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Network.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
    acceptLanguage: "zh-CN,zh;q=0.9",
    platform: "Android",
  });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluation failed");
    return result.result?.value;
  };
  const waitFor = async (condition, timeout = 15_000, label = condition) => {
    const deadline = Date.now() + timeout;
    let lastError = "";
    while (Date.now() < deadline) {
      try { if (await evaluate(`Boolean(${condition})`)) return; }
      catch (error) { lastError = error.message; }
      await delay(80);
    }
    throw new Error(`timeout waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
  };
  const navigate = async (pathname) => {
    const result = await send("Page.navigate", { url: `${BASE_URL}${pathname}` });
    if (result.errorText) throw new Error(result.errorText);
    await waitFor("document.readyState !== 'loading' && document.querySelector('#appShell')", 20_000, pathname);
    await waitFor("!document.querySelector('#appShell')?.classList.contains('app-shell-pending')", 20_000, `${pathname} initialized`);
  };
  const setFields = async (fields) => evaluate(`(() => {
    const fields = ${JSON.stringify(fields)};
    for (const [selector, value] of Object.entries(fields)) {
      const element = document.querySelector(selector);
      if (!element) throw new Error('missing field ' + selector);
      element.value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`);
  const click = async (selector) => evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('missing element ' + ${JSON.stringify(selector)});
    if (element.disabled) throw new Error('disabled element ' + ${JSON.stringify(selector)});
    element.click();
    return true;
  })()`);
  const useSession = async (token, pathname) => {
    await evaluate(`localStorage.setItem('wyjAccountSession', ${JSON.stringify(token)}); true`);
    await navigate(pathname);
  };

  const checks = [];
  const check = async (name, action) => {
    const started = Date.now();
    await action();
    checks.push({ name, milliseconds: Date.now() - started });
    process.stdout.write(`[task18-browser] PASS ${name}\n`);
  };

  try {
    await check("mobile registration and session restore", async () => {
      await navigate(`/register?task18=${RUN_ID}`);
      await setFields({
        "#registerUsernameInput": USERNAME,
        "#registerSecretInput": USER_SECRET,
        "#registerConfirmInput": USER_SECRET,
      });
      await click("#registerSubmitBtn");
      await waitFor(
        "location.pathname === '/login' && !document.querySelector('#loginForm')?.classList.contains('hidden')",
        15_000,
        "registration completed and login form visible",
      );
      await setFields({ "#usernameInput": USERNAME, "#secretInput": USER_SECRET });
      await click("#loginSubmitBtn");
      await waitFor("location.pathname === '/select' && !document.querySelector('#modulePicker')?.classList.contains('hidden')", 15_000, "user dashboard");
    });

    const userSession = await evaluate("localStorage.getItem('wyjAccountSession')");
    const me = await api("/api/me", null, userSession);
    assert.equal(me.status, 200, JSON.stringify(me.data));
    const userId = me.data.account.id;

    await check("required XSS message uses trusted visible Modal and repeats after close", async () => {
      const created = await api("/api/admin/messages", {
        title: "需要确认的重要通知",
        body: XSS_BODY,
        message_type: "important",
        target_scope: "single",
        target_user_ids: [userId],
        expires_at: "",
        requires_confirmation: true,
        confirm_bulk_send: false,
        idempotency_key: `task18-browser-required:${RUN_ID}`,
      }, adminSession);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      await navigate(`/select?message=${RUN_ID}`);
      await waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 15_000, "required message modal");
      assert.equal(await evaluate("document.querySelector('#siteMessageSource').textContent"), "thewyj 管理员通知");
      assert.equal(await evaluate("document.querySelector('#siteMessageBody').textContent"), XSS_BODY);
      assert.equal(await evaluate("typeof globalThis.task18Xss"), "undefined");
      assert.equal(await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true);
      await click("#siteMessageCloseBtn");
      await waitFor("document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 8_000, "required message closed");
      await navigate(`/select?message-repeat=${RUN_ID}`);
      await waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 15_000, "required message repeats");
      await click("#siteMessageAcknowledgeBtn");
      await waitFor("document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 8_000, "required message acknowledged");
      await navigate(`/select?message-acked=${RUN_ID}`);
      await delay(1_000);
      assert.equal(await evaluate("document.querySelector('#siteMessageModal')?.classList.contains('hidden')"), true);
    });

    await check("ordinary message dismissal persists across refresh", async () => {
      const created = await api("/api/admin/messages", {
        title: "普通通知",
        body: "关闭后不再重复显示",
        message_type: "normal",
        target_scope: "single",
        target_user_ids: [userId],
        expires_at: "",
        requires_confirmation: false,
        confirm_bulk_send: false,
        idempotency_key: `task18-browser-dismiss:${RUN_ID}`,
      }, adminSession);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      await navigate(`/select?ordinary=${RUN_ID}`);
      await waitFor("!document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 15_000, "ordinary message modal");
      await click("#siteMessageCloseIcon");
      await waitFor("document.querySelector('#siteMessageModal')?.classList.contains('hidden')", 8_000, "ordinary message dismissed");
      await navigate(`/select?ordinary-dismissed=${RUN_ID}`);
      await delay(1_000);
      assert.equal(await evaluate("document.querySelector('#siteMessageModal')?.classList.contains('hidden')"), true);
    });

    await check("owner role UI grants admin and ordinary admin cannot manage roles", async () => {
      await useSession(adminSession, `/admin?task18-owner=${RUN_ID}`);
      await waitFor("location.pathname === '/admin' && !document.querySelector('#adminPanel')?.classList.contains('hidden')", 15_000, "owner admin panel");
      assert.equal(await evaluate("document.querySelector('#adminRolesTab')?.classList.contains('hidden')"), false);
      assert.equal(await evaluate("Boolean(document.querySelector('#adminMessageForm'))"), true);
      await click("#adminRolesTab");
      await waitFor(`Array.from(document.querySelector('#adminRoleUserSelect')?.options || []).some((option) => option.value === ${JSON.stringify(userId)})`, 8_000, "role candidate");
      await setFields({ "#adminRoleUserSelect": userId, "#adminRoleNote": "Task 18 browser role grant" });
      await click("#grantAdminRoleBtn");
      await waitFor("!document.querySelector('#confirmModal')?.classList.contains('hidden')", 5_000, "grant confirmation");
      await click("#acceptConfirmBtn");
      await waitFor(`Boolean(document.querySelector('[data-admin-role-user-id=${JSON.stringify(userId)}]'))`, 12_000, "granted admin row");
      assert.equal((await api("/api/me", null, userSession)).data.account.role, "admin");

      await useSession(userSession, `/admin?task18-admin=${RUN_ID}`);
      await waitFor("location.pathname === '/admin' && !document.querySelector('#adminPanel')?.classList.contains('hidden')", 15_000, "ordinary admin panel");
      assert.equal(await evaluate("document.querySelector('#adminRolesTab')?.classList.contains('hidden')"), true);
      assert.equal(await evaluate("Boolean(document.querySelector('#adminMessageForm'))"), true);
      const ownerEditSelector = `[data-user-id="${adminUserId}"] [data-admin-edit]`;
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(ownerEditSelector)}))`, 12_000, "protected owner card");
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(ownerEditSelector)})?.disabled`), true);

      await useSession(adminSession, `/admin?task18-revoke=${RUN_ID}`);
      await waitFor("!document.querySelector('#adminPanel')?.classList.contains('hidden')", 15_000, "owner panel after switch");
      await click("#adminRolesTab");
      await waitFor(`Boolean(document.querySelector('[data-admin-role-user-id=${JSON.stringify(userId)}] [data-revoke-admin-role]'))`, 8_000, "revoke admin button");
      await click(`[data-admin-role-user-id="${userId}"] [data-revoke-admin-role]`);
      await waitFor("!document.querySelector('#confirmModal')?.classList.contains('hidden')", 5_000, "revoke confirmation");
      await click("#acceptConfirmBtn");
      await waitFor(`!document.querySelector('[data-admin-role-user-id=${JSON.stringify(userId)}]')`, 12_000, "admin revoked");
      assert.equal((await api("/api/me", null, userSession)).data.account.role, "user");
    });

    await check("owner bulk-send UI requires confirmation", async () => {
      await click("#adminMessagesTab");
      await setFields({
        "#adminMessageScope": "all",
        "#adminMessageType": "maintenance",
        "#adminMessageTitle": `全站维护通知 ${RUN_ID}`,
        "#adminMessageBody": "Task 18 浏览器全站发送确认测试",
      });
      await click("#sendAdminMessageBtn");
      await waitFor("!document.querySelector('#confirmModal')?.classList.contains('hidden')", 5_000, "bulk send confirmation");
      assert.match(await evaluate("document.querySelector('#confirmMessage').textContent"), /全部用户/);
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelector('#adminMessageFormStatus')?.textContent.includes('已发送')", 12_000, "bulk message sent");
    });

    assert.deepEqual(runtimeErrors, []);
    process.stdout.write(`Task 18 browser tests passed (${checks.length} flows, 390x844 mobile viewport).\n`);
  } finally {
    await client.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
    await client.send("Target.disposeBrowserContext", { browserContextId: context.browserContextId }).catch(() => {});
    client.close();
  }
}

await main();
