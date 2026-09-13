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
  const setFile = async (selector, files) => {
    const result = await evaluate(`document.querySelector(${JSON.stringify(selector)})`, false);
    assert.ok(result?.objectId, `missing file input ${selector}`);
    await send("DOM.setFileInputFiles", {
      objectId: result.objectId,
      files: Array.isArray(files) ? files : [files],
    });
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change', { bubbles: true }))`);
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
