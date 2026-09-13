import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Small shared CDP harness for the Task 24 browser regressions.
 *
 * It is deliberately dependency-free (a raw WebSocket to the already-running
 * headless Chrome the CI jobs start) so the same code runs in the Browser flow
 * job and in the Cloud-only Preview job.
 */

export const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class CdpClient {
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

/** Opens one page in its own browser context and returns the page helpers. */
export async function openPage({ cdpUrl, baseUrl, width = 412, height = 915, mobile = true }) {
  const version = await fetch(`${cdpUrl}/json/version`).then((response) => response.json());
  const client = new CdpClient(version.webSocketDebuggerUrl);
  await client.connect();
  const { browserContextId } = await client.send("Target.createBrowserContext");
  const runtimeErrors = [];
  const dialogs = [];
  let sessionId = "";
  let targetId = "";

  const send = (method, params = {}) => client.send(method, params, sessionId);
  const evaluate = async (expression, returnByValue = true) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue, userGesture: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluation failed");
    }
    return returnByValue ? result.result?.value : result.result;
  };
  const waitFor = async (condition, timeout = 20_000, label = condition) => {
    const deadline = Date.now() + timeout;
    let lastError = "";
    while (Date.now() < deadline) {
      try {
        if (await evaluate(`Boolean(${condition})`)) return true;
      } catch (error) {
        lastError = error.message;
      }
      await delay(80);
    }
    throw new Error(`timeout waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
  };

  const target = await client.send("Target.createTarget", { url: "about:blank", browserContextId });
  targetId = target.targetId;
  const attached = await client.send("Target.attachToTarget", { targetId, flatten: true });
  sessionId = attached.sessionId;
  await Promise.all([
    send("Page.enable"),
    send("DOM.enable"),
    send("Runtime.enable"),
    send("Log.enable"),
    send("Network.enable"),
    send("ServiceWorker.enable"),
  ]);
  // The app registers a service worker with a release-scoped Cache Storage.
  // Without clearing it (and the HTTP cache) a test run can execute yesterday's
  // bundle, which is how a wired handler can look dead in the browser.
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "Object.defineProperty(globalThis, '__WYJ_TEST_MODE__', { configurable: true, value: true });",
  });
  client.listeners.add((message) => {
    if (message.sessionId && message.sessionId !== sessionId) return;
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "runtime exception");
    }
    if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      const text = String(message.params.entry.text || "");
      if (!/^Failed to load resource: the server responded with a status of \d+/.test(text)) runtimeErrors.push(text);
    }
    if (message.method === "Page.javascriptDialogOpening") {
      dialogs.push(String(message.params?.message || ""));
      client.send("Page.handleJavaScriptDialog", { accept: true }, message.sessionId || sessionId).catch(() => {});
    }
  });
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "all" });
  await send("Storage.clearDataForOrigin", { origin: baseUrl, storageTypes: "cache_storage" });

  const navigate = async (pathname) => {
    const result = await send("Page.navigate", { url: `${baseUrl}${pathname}` });
    if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`);
    await waitFor("document.readyState !== 'loading' && document.querySelector('#appShell')", 25_000, pathname);
    await waitFor(
      "!document.querySelector('#appShell')?.classList.contains('app-shell-pending')",
      25_000,
      `${pathname} initialized`,
    );
  };
  const setFields = (fields) => evaluate(`(() => {
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
  const click = (selector) => evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('missing button ' + ${JSON.stringify(selector)});
    if (element.disabled) throw new Error('disabled button ' + ${JSON.stringify(selector)});
    element.click();
    return true;
  })()`);
  /**
   * Attaches files to an `<input type=file>` and delivers exactly one
   * input+change pair. `DOM.setFileInputFiles` sometimes fires the native events
   * and sometimes not; letting both the native event and a manual dispatch run
   * makes the transfer controller queue the same file twice, which breaks the
   * session's declared file_count and leaves the upload unfinished. The native
   * events are suppressed and replayed once (same pattern as the toolbox suite).
   */
  const setFile = async (selector, files) => {
    const result = await evaluate(`document.querySelector(${JSON.stringify(selector)})`, false);
    assert.ok(result?.objectId, `missing file input ${selector}`);
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const suppress = (event) => event.stopImmediatePropagation();
      input.__wyjHarnessSuppressFileEvents = suppress;
      input.addEventListener('input', suppress, true);
      input.addEventListener('change', suppress, true);
      return true;
    })()`);
    await send("DOM.setFileInputFiles", {
      objectId: result.objectId,
      files: Array.isArray(files) ? files : [files],
    });
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const suppress = input.__wyjHarnessSuppressFileEvents;
      input.removeEventListener('input', suppress, true);
      input.removeEventListener('change', suppress, true);
      delete input.__wyjHarnessSuppressFileEvents;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  };
  const setDownloadBehavior = async (downloadPath) => {
    fs.mkdirSync(downloadPath, { recursive: true });
    await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath });
  };
  const throttle = (latencyMs, throughputBytesPerSecond = 1_500_000) =>
    send("Network.emulateNetworkConditions", {
      offline: false,
      latency: latencyMs,
      downloadThroughput: throughputBytesPerSecond,
      uploadThroughput: throughputBytesPerSecond,
    });
  const clearThrottle = () =>
    send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

  /**
   * Deterministic response stubs for a few API routes (CDP Fetch interception).
   *
   * Used by the membership feedback case: the Preview D1 has no purchasable plan
   * catalog, and a test must never write business rows into Preview/Production
   * just to get a plan. Each rule matches a URL substring and answers from the
   * test process; everything else continues to the real server.
   */
  const interceptRules = [];
  const intercept = async (rules) => {
    for (const rule of rules) interceptRules.push(rule);
    await send("Fetch.enable", {
      patterns: rules.map((rule) => ({ urlPattern: `*${rule.match}*`, requestStage: "Request" })),
    });
    return {
      setState: (state) => {
        for (const rule of rules) rule.state = state;
      },
    };
  };
  client.listeners.add(async (message) => {
    if (message.method !== "Fetch.requestPaused") return;
    const requestId = message.params.requestId;
    const url = String(message.params.request?.url || "");
    const rule = interceptRules.find((entry) => url.includes(entry.match));
    try {
      if (!rule) {
        await send("Fetch.continueRequest", { requestId });
        return;
      }
      const outcome = await rule.respond({
        url,
        method: message.params.request?.method || "GET",
        postData: message.params.request?.postData || "",
        state: rule.state,
      });
      if (!outcome || outcome.continue) {
        await send("Fetch.continueRequest", { requestId });
        return;
      }
      if (outcome.delayMs) await delay(outcome.delayMs);
      const body = outcome.bodyBase64
        || Buffer.from(typeof outcome.body === "string" ? outcome.body : JSON.stringify(outcome.body ?? {})).toString("base64");
      await send("Fetch.fulfillRequest", {
        requestId,
        responseCode: outcome.status || 200,
        responseHeaders: [
          { name: "Content-Type", value: outcome.contentType || "application/json" },
          { name: "Cache-Control", value: "no-store" },
        ],
        body,
      });
    } catch (_) {
      await send("Fetch.continueRequest", { requestId }).catch(() => {});
    }
  });

  /**
   * Records the real HTTP answers for URLs containing [pattern], so a test can
   * assert what the server actually did instead of trusting a localized toast.
   */
  const responseWatchers = [];
  client.listeners.add((message) => {
    if (message.method !== "Network.responseReceived") return;
    const url = String(message.params?.response?.url || "");
    const status = Number(message.params?.response?.status || 0);
    for (const watcher of responseWatchers) {
      if (url.includes(watcher.pattern)) watcher.entries.push({ url, status });
    }
  });
  const watchResponses = (pattern) => {
    const watcher = { pattern: String(pattern), entries: [] };
    responseWatchers.push(watcher);
    return {
      get entries() {
        return watcher.entries.slice();
      },
      statuses: () => watcher.entries.map((entry) => entry.status),
      count: () => watcher.entries.length,
    };
  };

  return {
    client,
    send,
    evaluate,
    waitFor,
    navigate,
    setFields,
    click,
    setFile,
    setDownloadBehavior,
    throttle,
    clearThrottle,
    intercept,
    watchResponses,
    runtimeErrors,
    dialogs,
    targetId,
    close: () => client.close(),
  };
}

/** Waits until [filePath] exists and its size stops growing. */
export async function waitForDownloadedFile(filePath, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const size = fs.statSync(filePath).size;
      if (size > 0 && size === lastSize) return size;
      lastSize = size;
    }
    await delay(150);
  }
  throw new Error(`download did not finish: ${path.basename(filePath)}`);
}

/** Feedback probe: click and read the pending state in the same JS task. */
export const CLICK_AND_PROBE = (selector) => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return { ok: false, reason: "missing element" };
  const started = performance.now();
  element.click();
  const pending = element.dataset.pending === "true"
    || element.getAttribute("aria-busy") === "true"
    || element.disabled === true;
  return { ok: true, pending, elapsedMs: performance.now() - started };
})()`;

/**
 * Creates a fresh member and signs in - as an explicit state machine.
 *
 * The previous version retried the *whole* attempt when the localized
 * 「注册成功」 indicator was slow. The server had already answered
 * `POST /api/register 201`, so the second attempt produced `409 Conflict` and
 * the failure looked like a transfer problem although the upload never ran
 * (main CI run 34741604805).
 *
 * Rules now:
 *  1. `POST /api/register` is sent at most once per created account. A retry is
 *     only allowed when **no answer at all** was observed for that request.
 *  2. The real HTTP status is the evidence (201 = created, 409 = the account
 *     already exists). A localized toast is an assertion on top, never the only
 *     reason to re-register.
 *  3. Whatever the UI said, the account must be usable: the helper signs in and
 *     requires the authenticated `/select` dashboard.
 */
export async function registerAndSignIn(page, { username, secret, label = "member", uiTimeoutMs = 45_000 } = {}) {
  const registerResponses = page.watchResponses("/api/register");
  const registrationSuccessExpression =
    "location.pathname === '/login' && document.querySelector('#loginError')?.textContent.includes('注册成功')";

  await page.navigate(`/register?rc=${encodeURIComponent(username)}`);
  await page.waitFor("!document.querySelector('#registerForm')?.classList.contains('hidden')", 20_000, "register form");
  await page.setFields({
    "#registerUsernameInput": username,
    "#registerSecretInput": secret,
    "#registerConfirmInput": secret,
  });
  await page.click("#registerSubmitBtn");

  // The UI indicator is a UI assertion; the HTTP answer is the evidence.
  let uiObserved = true;
  try {
    await page.waitFor(registrationSuccessExpression, uiTimeoutMs, "registration success indicator");
  } catch (_) {
    uiObserved = false;
  }

  const observedStatuses = registerResponses.statuses();
  const created = observedStatuses.some((status) => status >= 200 && status < 300);

  if (!created && observedStatuses.length === 0) {
    // The click never reached the server (no answer at all). Exactly one retry of
    // the same request is allowed, and only while the form is still there.
    const formStillThere = await page
      .evaluate("Boolean(document.querySelector('#registerSubmitBtn'))")
      .catch(() => false);
    if (formStillThere) {
      console.log(`[browser-harness] no /api/register answer observed for ${label}; retrying the same request once`);
      await page.click("#registerSubmitBtn").catch(() => {});
      try {
        await page.waitFor(registrationSuccessExpression, 20_000, "registration success indicator (retry)");
        uiObserved = true;
      } catch (_) {
        uiObserved = false;
      }
    }
  } else if (!created && observedStatuses.includes(409)) {
    // The account already exists (for example a previous partially completed
    // run). This is reported, never silently treated as a fresh creation; the
    // credentials below still have to work.
    console.log(`[browser-harness] /api/register answered 409 for ${label}; verifying the existing account by signing in`);
  }

  const finalStatuses = registerResponses.statuses();
  const duplicateRegistrationObserved = finalStatuses.includes(409);
  const registrationCreated = finalStatuses.some((status) => status >= 200 && status < 300);

  // Sign in with the submitted credentials. This is the part that actually
  // proves "fresh user creation → authenticated session".
  await page.navigate(`/login?rc=${encodeURIComponent(username)}`);
  await page.waitFor("!document.querySelector('#loginForm')?.classList.contains('hidden')", 20_000, "login form");
  await page.setFields({ "#usernameInput": username, "#secretInput": secret });
  await page.click("#loginSubmitBtn");
  try {
    await page.waitFor(
      "location.pathname === '/select' && !document.querySelector('#modulePicker')?.classList.contains('hidden')",
      45_000,
      `${label} dashboard`,
    );
  } catch (error) {
    const loginError = await page
      .evaluate("document.querySelector('#loginError')?.textContent || ''")
      .catch(() => "");
    throw new Error(
      `${label} could not sign in after registration `
        + `(register statuses: ${JSON.stringify(finalStatuses)}, uiObserved: ${uiObserved}, login error: ${loginError || "none"}): ${error.message}`,
    );
  }

  return {
    registrationStatuses: finalStatuses,
    registrationCreated,
    duplicateRegistrationObserved,
    uiObserved,
    recoveredFromUiTimeout: !uiObserved,
  };
}
