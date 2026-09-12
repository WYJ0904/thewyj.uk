import assert from "node:assert/strict";
import path from "node:path";

const BASE_URL = process.env.WYJ_TEST_BASE || "http://127.0.0.1:8892";
const CDP_URL = process.env.WYJ_CDP_URL || "http://127.0.0.1:9223";
const ROOT = path.resolve(import.meta.dirname, "..");
const ADMIN_USERNAME = process.env.WYJ_TEST_ADMIN_USERNAME || "wyj";
const ADMIN_SECRET = process.env.WYJ_TEST_ADMIN_SECRET || "";
const RUN_ID = Date.now().toString(36);
const USERNAME = `responsive${RUN_ID}`.slice(0, 32);
const USER_SECRET = "Responsive-Matrix-2026!";

async function api(pathname, payload, token = "", expected = [200]) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: payload === null ? "GET" : "POST",
    headers: {
      ...(payload === null ? {} : { "Content-Type": "application/json" }),
      ...(token ? { "X-Session-Token": token } : {}),
    },
    body: payload === null ? undefined : JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  assert.ok(expected.includes(response.status), `${pathname} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function createMember() {
  await api("/api/register", { username: USERNAME, secret: USER_SECRET, confirm_secret: USER_SECRET }, "", [201]);
  const login = await api("/api/login", { username: USERNAME, secret: USER_SECRET });
  const admin = await api("/api/login", { username: ADMIN_USERNAME, secret: ADMIN_SECRET });
  await api("/api/admin/membership/manage", {
    user_id: login.account.id,
    action: "grant",
    plan_code: "all_access_lifetime",
    note: "transfer responsive matrix",
  }, admin.session);
  const refreshed = await api("/api/me", null, login.session);
  return { session: login.session, account: refreshed.account };
}

const VIEWPORTS = Object.freeze([
  { name: "360x800", width: 360, height: 800, mobile: true },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "412x915", width: 412, height: 915, mobile: true },
  { name: "320x640", width: 320, height: 640, mobile: true },
  { name: "desktop-1366", width: 1366, height: 768, mobile: false },
]);

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        if (message.method === "Runtime.exceptionThrown" || message.method === "Log.entryAdded") {
          this.events.push(message);
          if (this.events.length > 40) this.events.shift();
        }
        return;
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result || {});
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), 10_000);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener("error", (event) => { clearTimeout(timer); reject(event.error || new Error("CDP error")); }, { once: true });
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
    this.socket.close();
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MEASURE = `(() => {
  const root = document.documentElement;
  const viewportWidth = root.clientWidth;
  const offenders = [];
  for (const element of document.querySelectorAll("#transferPage *")) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right <= viewportWidth + 1 && rect.left >= -1) continue;
    offenders.push({
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      className: String(element.className || "").slice(0, 80),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      text: (element.textContent || "").trim().slice(0, 40),
    });
    if (offenders.length >= 8) break;
  }
  const rectOf = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
    };
  };
  return {
    viewportWidth,
    scrollWidth: root.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    offenders,
    back: rectOf("#transferBackBtn"),
    dropZone: rectOf("#transferDropZone"),
    quota: rectOf("#transferQuotaBar"),
    config: rectOf(".transfer-config"),
    message: rectOf("#transferMessage"),
    viewportHeight: window.innerHeight,
  };
})()`;

async function main() {
  assert.ok(ADMIN_SECRET, "WYJ_TEST_ADMIN_SECRET is required for the isolated browser test server");
  const member = await createMember();
  const version = await fetch(`${CDP_URL}/json/version`).then((response) => response.json());
  const client = new CdpClient(version.webSocketDebuggerUrl);
  await client.connect();
  const context = await client.send("Target.createBrowserContext");
  const browserContextId = context.browserContextId;
  const target = await client.send("Target.createTarget", { url: "about:blank", browserContextId });
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  const send = (method, params = {}) => client.send(method, params, sessionId);
  await Promise.all([send("Page.enable"), send("DOM.enable"), send("Runtime.enable")]);

  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result?.value;
  };
  const waitFor = async (condition, timeout = 20_000, description = condition) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(`Boolean(${condition})`)) return;
      } catch (_) {
        // keep waiting
      }
      await delay(100);
    }
    throw new Error(`timeout waiting for ${description}`);
  };

  try {
    const report = [];
    // Boot once at the default (desktop) viewport exactly like a real user:
    // login → workspace → 工具箱 → 文件传输. The per-viewport measurements then
    // resize the live page, which is what a phone rotation/resize also does.
    await send("Page.navigate", { url: `${BASE_URL}/login?responsive=${Date.now()}` });
    await waitFor("document.querySelector('#usernameInput')", 25_000, "login page");
    await evaluate(`localStorage.setItem('wyjAccountSession', ${JSON.stringify(member.session)}); location.href = '/tools?responsive=${Date.now()}'; true`);
    await waitFor(
      "window.WYJTools?.tools?.length >= 100 && !document.querySelector('#toolsPanel')?.classList.contains('hidden')",
      40_000,
      "toolbox boot",
    ).catch(async (error) => {
      const diagnostic = await evaluate(`({
        href: location.href,
        shell: document.querySelector('#appShell')?.className || '',
        hasTools: Boolean(window.WYJTools),
        toolCount: window.WYJTools?.tools?.length ?? -1,
        sessionStored: Boolean(localStorage.getItem('wyjAccountSession')),
      })`).catch(() => ({}));
      const events = client.events.map((event) => {
        if (event.method === "Runtime.exceptionThrown") {
          return event.params?.exceptionDetails?.exception?.description || event.params?.exceptionDetails?.text || "exception";
        }
        return event.params?.entry?.text || "log";
      }).slice(-6);
      throw new Error(`${error.message} :: ${JSON.stringify(diagnostic)} :: events=${JSON.stringify(events)}`);
    });
    await evaluate("window.WYJTools.openTool('file-transfer', false); true");
    await waitFor(
      "location.pathname === '/transfer' && !document.querySelector('#transferPage')?.classList.contains('hidden')",
      25_000,
      "transfer page",
    ).catch(async (error) => {
      const diagnostic = await evaluate(`({
        href: location.href,
        shell: document.querySelector('#appShell')?.className || '',
        transferVisible: !document.querySelector('#transferPage')?.classList.contains('hidden'),
        toolsVisible: !document.querySelector('#toolsPanel')?.classList.contains('hidden'),
      })`).catch(() => ({}));
      throw new Error(`${error.message} :: ${JSON.stringify(diagnostic)}`);
    });

    for (const viewport of VIEWPORTS) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.mobile ? 2 : 1,
        mobile: viewport.mobile,
      });
      await waitFor(
        "!document.querySelector('#transferPage')?.classList.contains('hidden') && document.querySelector('#transferPage')",
        15_000,
        `transfer page at ${viewport.name}`,
      );
      await delay(350);
      const layout = await evaluate(MEASURE);
      report.push({ viewport: viewport.name, ...layout });

      const label = `${viewport.name}: scrollWidth=${layout.scrollWidth} clientWidth=${layout.viewportWidth}`;
      assert.ok(layout.scrollWidth <= layout.viewportWidth + 1, `${label} - horizontal overflow: ${JSON.stringify(layout.offenders)}`);
      assert.ok(layout.bodyScrollWidth <= layout.viewportWidth + 1, `${label} - body overflows: ${JSON.stringify(layout.offenders)}`);
      assert.deepEqual(layout.offenders, [], `${viewport.name}: elements overflow the viewport`);
      for (const [name, rect] of Object.entries({ backButton: layout.back, dropZone: layout.dropZone, quota: layout.quota, config: layout.config })) {
        assert.ok(rect, `${viewport.name}: ${name} is missing`);
        assert.ok(
          rect.left >= -1 && rect.right <= layout.viewportWidth + 1,
          `${viewport.name}: ${name} is outside the viewport (${JSON.stringify(rect)})`,
        );
      }
      assert.ok(layout.message, `${viewport.name}: transfer message line is missing`);
      // Bottom guard: scroll to the very end and prove the last content row is
      // still fully visible (the shell reserves safe-area/bottom padding for the
      // native bottom navigation instead of letting it cover content).
      const bottomGuard = await evaluate(`(() => {
        window.scrollTo(0, document.body.scrollHeight);
        const page = document.querySelector("#transferPage");
        const last = page.lastElementChild;
        const lastRect = last.getBoundingClientRect();
        const shellStyle = getComputedStyle(document.querySelector("#appShell"));
        const pageStyle = getComputedStyle(page);
        return {
          lastBottom: Math.round(lastRect.bottom),
          viewportHeight: window.innerHeight,
          shellPaddingBottom: shellStyle.paddingBottom,
          pagePaddingBottom: pageStyle.paddingBottom,
          scrollY: Math.round(window.scrollY),
        };
      })()`);
      assert.ok(
        bottomGuard.lastBottom <= bottomGuard.viewportHeight + 1,
        `${viewport.name}: content is still cut off after scrolling to the end (${JSON.stringify(bottomGuard)})`,
      );
      assert.ok(
        Number.parseFloat(bottomGuard.shellPaddingBottom) >= 16 || Number.parseFloat(bottomGuard.pagePaddingBottom) >= 16,
        `${viewport.name}: no bottom/safe-area padding reserved (${JSON.stringify(bottomGuard)})`,
      );
      report.at(-1).bottomGuard = bottomGuard;
    }

    console.log(JSON.stringify({ checked: report.length, widths: report.map((entry) => ({ viewport: entry.viewport, scrollWidth: entry.scrollWidth, clientWidth: entry.viewportWidth })) }, null, 2));
    console.log("Transfer responsive checks passed (320/360/390/412 mobile + desktop, no horizontal overflow, controls inside the viewport).");
  } finally {
    await client.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
    await client.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
