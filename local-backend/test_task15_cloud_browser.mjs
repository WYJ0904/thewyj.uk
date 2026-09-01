import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE_URL = process.env.WYJ_TEST_BASE || "http://127.0.0.1:8894";
const CDP_URL = process.env.WYJ_CDP_URL || "http://127.0.0.1:9225";
const EXPECT_AI_MODE = process.env.WYJ_EXPECT_AI_MODE || "disabled";
const RUN_ID = Date.now().toString(36);
const USERNAME = `cloudonly${RUN_ID}`.slice(0, 32);
const USER_SECRET = "Cloud-Only-Browser-2026!";
const TEST_ROOT = path.join(ROOT, ".tool-e2e");
const ARTIFACT_ROOT = path.resolve(ROOT, process.env.WYJ_TEST_ARTIFACT_DIR || ".tool-e2e");
const ENGLISH_WORDS = path.join(TEST_ROOT, `task15-english-${RUN_ID}.txt`);
const JAPANESE_WORDS = path.join(TEST_ROOT, `task15-japanese-${RUN_ID}.txt`);

fs.mkdirSync(TEST_ROOT, { recursive: true });
fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
fs.writeFileSync(ENGLISH_WORDS, "hello\nworld\n", "utf8");
fs.writeFileSync(JAPANESE_WORDS, "電話\n齟齬\n", "utf8");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function inspectPdfArtifact(bytes) {
  const text = bytes.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"), "browser PDF header is missing");
  assert.ok(text.endsWith("%%EOF"), "browser PDF trailer is missing");
  const startXref = /startxref\n(\d+)\n%%EOF$/u.exec(text);
  assert.ok(startXref, "browser PDF startxref is missing");
  assert.equal(text.slice(Number(startXref[1]), Number(startXref[1]) + 4), "xref");
  const pageCount = Number(/\/Type \/Pages \/Count (\d+)/u.exec(text)?.[1] || 0);
  assert.ok(pageCount >= 1, "browser PDF has no pages");
  assert.equal((text.match(/\/Type \/Page(?!s)\b/gu) || []).length, pageCount);
  assert.equal((text.match(/\/Subtype \/Image\b/gu) || []).length, pageCount);
  assert.equal((text.match(/\xff\xd8/gu) || []).length, pageCount);
  return pageCount;
}

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

async function request(pathname, payload = null, token = "") {
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
  const status = await request("/api/status?source=cloud");
  assert.equal(status.status, 200, JSON.stringify(status.data));
  assert.equal(status.data.task15?.cloud_only, true);
  assert.equal(status.data.features?.legacy_api_fallback, false);
  assert.equal(status.data.bindings?.d1, true);
  assert.equal(status.data.bindings?.r2, true);

  const version = await fetch(`${CDP_URL}/json/version`).then((response) => response.json());
  const client = new CdpClient(version.webSocketDebuggerUrl);
  await client.connect();
  const context = await client.send("Target.createBrowserContext");
  const browserContextId = context.browserContextId;
  let targetId = "";
  let sessionId = "";
  const runtimeErrors = [];
  const externalRuntimeRequests = [];
  const dialogs = [];

  const send = (method, params = {}) => client.send(method, params, sessionId);
  const attachPage = async (url) => {
    const target = await client.send("Target.createTarget", { url, browserContextId });
    targetId = target.targetId;
    const attached = await client.send("Target.attachToTarget", { targetId, flatten: true });
    sessionId = attached.sessionId;
    await Promise.all([
      send("Page.enable"),
      send("DOM.enable"),
      send("Runtime.enable"),
      send("Log.enable"),
      send("Network.enable"),
    ]);
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: "Object.defineProperty(globalThis, '__WYJ_TEST_MODE__', { configurable: true, value: true });",
    });
    await send("Network.setCacheDisabled", { cacheDisabled: true });
  };

  client.listeners.add((message) => {
    if (message.sessionId && message.sessionId !== sessionId) return;
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "runtime exception");
    }
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      const text = String(message.params.entry.text || "");
      if (!/^Failed to load resource: the server responded with a status of \d+/.test(text)) runtimeErrors.push(text);
    }
    if (message.method === "Network.requestWillBeSent") {
      const requestUrl = String(message.params?.request?.url || "");
      if (/api\.thewyj\.uk|(?:127\.0\.0\.1|localhost):(?:8765|11434)/iu.test(requestUrl)) {
        externalRuntimeRequests.push(requestUrl);
      }
    }
    if (message.method === "Page.javascriptDialogOpening") {
      dialogs.push(String(message.params?.message || ""));
      client.send("Page.handleJavaScriptDialog", { accept: true }, message.sessionId || sessionId).catch(() => {});
    }
  });

  await attachPage("about:blank");
  await send("Storage.clearDataForOrigin", { origin: BASE_URL, storageTypes: "all" });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  const evaluate = async (expression, returnByValue = true) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue, userGesture: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluation failed");
    }
    return returnByValue ? result.result?.value : result.result;
  };
  const waitFor = async (condition, timeout = 15_000, label = condition) => {
    const deadline = Date.now() + timeout;
    let lastError = "";
    while (Date.now() < deadline) {
      try {
        if (await evaluate(`Boolean(${condition})`)) return;
      } catch (error) {
        lastError = error.message;
      }
      await delay(80);
    }
    throw new Error(`timeout waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
  };
  const navigate = async (pathname) => {
    const result = await send("Page.navigate", { url: `${BASE_URL}${pathname}` });
    if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`);
    await waitFor("document.readyState !== 'loading' && document.querySelector('#appShell')", 20_000, pathname);
    await waitFor("!document.querySelector('#entryScreen') && !document.querySelector('#appShell')?.classList.contains('app-shell-pending')", 20_000, `${pathname} initialized`);
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
    if (!element) throw new Error('missing button ' + ${JSON.stringify(selector)});
    if (element.disabled) throw new Error('disabled button ' + ${JSON.stringify(selector)});
    element.click();
    return true;
  })()`);
  const setFile = async (selector, filename) => {
    const result = await evaluate(`document.querySelector(${JSON.stringify(selector)})`, false);
    assert.ok(result?.objectId, `missing file input ${selector}`);
    await send("DOM.setFileInputFiles", { objectId: result.objectId, files: [filename] });
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change', { bubbles: true }))`);
  };

  const checks = [];
  const check = async (name, action) => {
    const started = Date.now();
    await action();
    checks.push({ name, milliseconds: Date.now() - started });
    process.stdout.write(`[task15-cloud-browser] PASS ${name}\n`);
  };

  try {
    await check("register and canonical D1 login", async () => {
      await navigate(`/register?task15=${RUN_ID}`);
      await waitFor("location.pathname === '/register' && !document.querySelector('#registerForm')?.classList.contains('hidden')", 12_000, "register form");
      await setFields({
        "#registerUsernameInput": USERNAME,
        "#registerSecretInput": USER_SECRET,
        "#registerConfirmInput": USER_SECRET,
      });
      await click("#registerSubmitBtn");
      await waitFor("location.pathname === '/login' && document.querySelector('#loginError')?.textContent.includes('注册成功')", 15_000, "registration success");
      await setFields({ "#usernameInput": USERNAME, "#secretInput": USER_SECRET });
      await click("#loginSubmitBtn");
      await waitFor("location.pathname === '/select' && !document.querySelector('#modulePicker')?.classList.contains('hidden')", 15_000, "dashboard after login");
      assert.ok((await evaluate("localStorage.getItem('wyjAccountSession') || ''")).length > 20);
    });

    const originalSession = await evaluate("localStorage.getItem('wyjAccountSession')");
    const me = await request("/api/me", null, originalSession);
    assert.equal(me.status, 200, JSON.stringify(me.data));
    assert.equal(me.data.account?.username, USERNAME);

    await check("hard refresh preserves the canonical session", async () => {
      await send("Page.reload", { ignoreCache: true });
      await waitFor("location.pathname === '/select' && !document.querySelector('#modulePicker')?.classList.contains('hidden')", 20_000, "dashboard after hard refresh");
      assert.equal(await evaluate("localStorage.getItem('wyjAccountSession')"), originalSession);
    });

    await check("closing and reopening a tab preserves the session", async () => {
      await client.send("Target.closeTarget", { targetId });
      await attachPage(`${BASE_URL}/select?reopen=${RUN_ID}`);
      await waitFor("document.readyState !== 'loading' && document.querySelector('#appShell')", 20_000, "reopened app shell");
      await waitFor("location.pathname === '/select' && !document.querySelector('#modulePicker')?.classList.contains('hidden')", 20_000, "dashboard after tab reopen");
      assert.equal(await evaluate("localStorage.getItem('wyjAccountSession')"), originalSession);
    });

    await check("membership business failure does not clear login", async () => {
      await click('[data-module="tools"]');
      await waitFor("!document.querySelector('#membershipModal')?.classList.contains('hidden')", 12_000, "membership modal");
      assert.equal(await evaluate("localStorage.getItem('wyjAccountSession')"), originalSession);
      assert.equal((await request("/api/me", null, originalSession)).status, 200);
      await click('[data-close-modal="membershipModal"]');
    });

    await check("English file import starts question one without logout", async () => {
      await click('[data-module="language"]');
      await waitFor("location.pathname === '/language'", 8_000, "language picker");
      await click('[data-project="english"]');
      await waitFor("location.pathname === '/language/english' && !document.querySelector('#workspace')?.classList.contains('hidden')", 12_000, "English workspace");
      await setFile("#wordFileInput", ENGLISH_WORDS);
      await waitFor("document.querySelector('#wordInput')?.value.includes('hello')", 5_000, "English import");
      await click("#startBtn");
      await waitFor("document.querySelector('#quizView')?.classList.contains('active') && document.querySelector('#progressLabel')?.textContent === '1/2'", 20_000, "English first question");
      assert.equal(await evaluate("localStorage.getItem('wyjAccountSession')"), originalSession);
    });

    await check("Japanese file import starts question one without logout", async () => {
      await navigate(`/language/japanese?task15=${RUN_ID}`);
      await waitFor("location.pathname === '/language/japanese' && !document.querySelector('#workspace')?.classList.contains('hidden')", 12_000, "Japanese workspace");
      await setFile("#wordFileInput", JAPANESE_WORDS);
      await waitFor("document.querySelector('#wordInput')?.value.includes('電話')", 5_000, "Japanese import");
      await click("#startBtn");
      try {
        await waitFor("document.querySelector('#quizView')?.classList.contains('active') && document.querySelector('#progressLabel')?.textContent === '1/2'", 20_000, "Japanese first question");
      } catch (error) {
        const diagnostic = await evaluate(`({
          path: location.pathname,
          currentProject,
          backendAvailable,
          roundActive: state.roundActive,
          practiceMode: state.practiceMode,
          words: state.words,
          quizSession: Boolean(state.quizSession),
          readings: state.japaneseReadings,
          writtenForms: state.japaneseWrittenForms,
          activeView: document.querySelector('.view.active')?.id || '',
          progress: document.querySelector('#progressLabel')?.textContent || '',
          setupMessage: document.querySelector('#setupMessage')?.textContent || '',
        })`);
        throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}; dialogs=${JSON.stringify(dialogs)}`);
      }
      assert.equal(await evaluate("localStorage.getItem('wyjAccountSession')"), originalSession);
      const aiUnavailable = dialogs.some(
        (message) => message.includes("AI 暂时不可用") && message.includes("释义练习仍可继续"),
      );
      if (EXPECT_AI_MODE === "disabled") {
        assert.equal(aiUnavailable, true, "disabled Workers AI must degrade without ending the quiz");
      } else if (EXPECT_AI_MODE === "enabled") {
        assert.equal(aiUnavailable, false, "enabled Workers AI must resolve the Japanese enrichment path");
        const cloudStatus = await request("/api/status?source=cloud");
        assert.equal(cloudStatus.data.ai_ready, true);
      } else {
        assert.equal(EXPECT_AI_MODE, "either", `unsupported WYJ_EXPECT_AI_MODE: ${EXPECT_AI_MODE}`);
      }
    });

    await check("real browser canvas produces a parseable semantic PDF", async () => {
      const generated = await evaluate(`(async () => {
        const drawn = [];
        const originalFillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
          drawn.push(String(value));
          return originalFillText.call(this, value, ...args);
        };
        try {
          const { createWrongBookPdf } = await import('/js/language/pdf.js');
          const blob = await createWrongBookPdf({
            '電話': {
              accepted: ['电话', '電話'],
              correct_answer: '电话',
              last_answer: '电活',
              last_time: '2026-08-25T12:00:00.000Z',
              skipped: false,
              wrong_count: 2,
            },
            'advisor': {
              accepted: ['顾问'],
              correct_answer: '顾问',
              last_answer: '（跳过）',
              last_time: '2026-08-25T12:01:00.000Z',
              skipped: true,
              wrong_count: 1,
            },
          }, {
            title: 'Task 15 浏览器 PDF 验收',
            meta: { language: '英语与日语', profile: '隔离测试账户', scope: '错题' },
          });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          }
          return { base64: btoa(binary), type: blob.type, size: blob.size, drawn };
        } finally {
          CanvasRenderingContext2D.prototype.fillText = originalFillText;
        }
      })()`);
      assert.equal(generated.type, "application/pdf");
      assert.ok(generated.size > 1_000, "browser PDF is unexpectedly small");
      const drawn = generated.drawn.join("\n");
      const compactDrawn = generated.drawn.join("");
      const containsDrawnText = (value) => drawn.includes(value) || compactDrawn.includes(value);
      const drawSummary = JSON.stringify(generated.drawn);
      assert.ok(containsDrawnText("Task 15 浏览器 PDF 验收"), drawSummary);
      assert.ok(containsDrawnText("正确答案:电话"), drawSummary);
      assert.ok(containsDrawnText("我的答案:已跳过"), drawSummary);
      assert.ok(containsDrawnText("正确答案:顾问"), drawSummary);
      const bytes = Buffer.from(generated.base64, "base64");
      assert.equal(bytes.length, generated.size);
      const pageCount = inspectPdfArtifact(bytes);
      const output = path.join(ARTIFACT_ROOT, `task15-browser-wrong-book-${RUN_ID}.pdf`);
      fs.writeFileSync(output, bytes);
      assert.equal(fs.statSync(output).size, generated.size);
      process.stdout.write(`[task15-cloud-browser] PDF ${output} (${pageCount} page(s), ${generated.size} bytes)\n`);
    });

    await check("offline and reconnect preserve the session", async () => {
      await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
      await delay(350);
      assert.equal(await evaluate("localStorage.getItem('wyjAccountSession')"), originalSession);
      await send("Network.emulateNetworkConditions", { offline: false, latency: 25, downloadThroughput: 1_000_000, uploadThroughput: 500_000 });
      const current = await evaluate(`(async () => {
        const delays = [100, 200, 400, 800, 1600];
        let lastError = '';
        for (let attempt = 0; attempt < delays.length; attempt += 1) {
          try {
            const response = await fetch('/api/me', { headers: { 'X-Session-Token': localStorage.getItem('wyjAccountSession') } });
            const data = await response.json();
            if (response.status === 200) return { status: response.status, data, attempts: attempt + 1 };
            lastError = data?.error || ('HTTP ' + response.status);
          } catch (error) {
            lastError = error?.message || String(error);
          }
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        }
        return { status: 0, data: { error: lastError } };
      })()`);
      assert.equal(current.status, 200, JSON.stringify(current.data));
      assert.equal(current.data.account?.username, USERNAME);
    });

    assert.deepEqual(externalRuntimeRequests, [], `legacy runtime request(s): ${JSON.stringify(externalRuntimeRequests)}`);
    assert.deepEqual(runtimeErrors, [], `browser runtime error(s): ${JSON.stringify(runtimeErrors)}`);
    process.stdout.write(`${JSON.stringify({ ok: true, checks, cloudOnly: true, legacyRequests: 0 }, null, 2)}\n`);
  } finally {
    if (targetId) await client.send("Target.closeTarget", { targetId }).catch(() => {});
    await client.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
