import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE_URL = process.env.WYJ_TEST_BASE || "http://127.0.0.1:8892";
const CDP_URL = process.env.WYJ_CDP_URL || "http://127.0.0.1:9223";
const ADMIN_SECRET = process.env.WYJ_TEST_ADMIN_SECRET || "";
const TEST_ROOT = path.join(ROOT, ".tool-e2e");
const RUN_ID = Date.now().toString(36);
const DOWNLOAD_ROOT = path.join(TEST_ROOT, `app-downloads-${RUN_ID}`);
const USERNAME = `appmatrix${RUN_ID}`.slice(0, 32);
const USER_SECRET = "App-Matrix-User-2026!";
const USER_SECRET_NEW = "App-Matrix-New-2026!";

fs.mkdirSync(DOWNLOAD_ROOT, { recursive: true });
const wordsFile = path.join(TEST_ROOT, `app-words-${RUN_ID}.txt`);
const wrongFile = path.join(TEST_ROOT, `app-wrong-${RUN_ID}.json`);
const trialImageFile = path.join(TEST_ROOT, `app-trial-${RUN_ID}.png`);
fs.writeFileSync(wordsFile, "hello\nworld\nstudy\n", "utf8");
fs.writeFileSync(wrongFile, JSON.stringify({
  type: "vocab-wrong-book",
  version: 1,
  language: "english",
  currentWrongBook: {
    hello: { last_answer: "你好", original_answer: "你好", correct_answer: "你好", accepted: ["您好"], wrong_count: 1 },
  },
  historyWrongBook: {
    hello: { last_answer: "你好", original_answer: "你好", correct_answer: "你好", accepted: ["您好"], wrong_count: 2 },
  },
}, null, 2), "utf8");
fs.writeFileSync(
  trialImageFile,
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
);

async function request(pathname, payload = null, token = "") {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: payload === null ? "GET" : "POST",
    headers: {
      ...(payload === null ? {} : { "Content-Type": "application/json" }),
      ...(token ? { "X-Session-Token": token } : {}),
    },
    body: payload === null ? undefined : JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, headers: response.headers };
}

async function api(pathname, payload = null, token = "", expected = [200]) {
  const result = await request(pathname, payload, token);
  assert.ok(expected.includes(result.status), `${pathname}: HTTP ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}

async function createUser(prefix, secret = USER_SECRET) {
  const username = `${prefix}${RUN_ID}`.slice(0, 32);
  await api("/api/register", { username, secret, confirm_secret: secret }, "", [201]);
  const login = await api("/api/login", { username, secret });
  return { username, secret, ...login };
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
      this.socket.addEventListener("error", (event) => { clearTimeout(timer); reject(event.error || new Error("CDP websocket error")); }, { once: true });
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

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function connectBrowser() {
  const version = await fetch(`${CDP_URL}/json/version`).then((response) => response.json());
  const client = new CdpClient(version.webSocketDebuggerUrl);
  await client.connect();
  const context = await client.send("Target.createBrowserContext");
  const browserContextId = context.browserContextId;
  const target = await client.send("Target.createTarget", { url: "about:blank", browserContextId });
  const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  const send = (method, params = {}) => client.send(method, params, sessionId);
  await Promise.all([send("Page.enable"), send("DOM.enable"), send("Runtime.enable"), send("Log.enable"), send("Network.enable")]);
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Network.setBypassServiceWorker", { bypass: false });
  await client.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DOWNLOAD_ROOT,
    eventsEnabled: true,
    browserContextId,
  });
  return { client, browserContextId, targetId: target.targetId, sessionId, send };
}

async function main() {
  assert.ok(ADMIN_SECRET, "WYJ_TEST_ADMIN_SECRET is required for the isolated browser test server");
  const admin = await api("/api/login", { username: "wyj", secret: ADMIN_SECRET });
  const browser = await connectBrowser();
  const { client, browserContextId, send, targetId } = browser;
  const runtimeErrors = [];
  const networkHttpErrors = [];
  const networkRequests = [];
  const dialogs = [];
  const checks = [];
  await send("Storage.clearDataForOrigin", { origin: BASE_URL, storageTypes: "all" });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression, returnByValue = true) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue, userGesture: true });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
      throw new Error(detail || "browser evaluation failed");
    }
    return returnByValue ? response.result?.value : response.result;
  };

  client.listeners.add((message) => {
    if (message.sessionId && message.sessionId !== browser.sessionId) return;
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails;
      runtimeErrors.push(details?.exception?.description || details?.text || "runtime exception");
    }
    if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params?.entry?.level)) {
      const value = message.params.entry.text || "browser log error";
      const expectedCancellation = /^Failed to load resource: net::ERR_(?:ABORTED|CONNECTION_ABORTED)$/.test(value);
      if (!expectedCancellation && !/^Failed to load resource: the server responded with a status of \d+/.test(value)) {
        runtimeErrors.push(value);
      }
    }
    if (message.method === "Network.responseReceived" && Number(message.params?.response?.status) >= 400) {
      networkHttpErrors.push({
        status: Number(message.params.response.status),
        url: message.params.response.url,
      });
    }
    if (message.method === "Network.requestWillBeSent") {
      networkRequests.push({
        method: message.params?.request?.method || "GET",
        url: message.params?.request?.url || "",
      });
    }
    if (message.method === "Page.javascriptDialogOpening") {
      dialogs.push(message.params.message || "");
      send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
  });

  const waitFor = async (condition, timeout = 15_000, description = condition) => {
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
    throw new Error(`timeout waiting for ${description}${lastError ? `: ${lastError}` : ""}`);
  };

  const setFields = async (fields) => evaluate(`(() => {
    const fields = ${JSON.stringify(fields)};
    for (const [selector, value] of Object.entries(fields)) {
      const element = document.querySelector(selector);
      if (!element) throw new Error('missing field ' + selector);
      if (element.type === 'checkbox') element.checked = Boolean(value);
      else element.value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`);

  const contrastRatio = async (selector, pseudo = "") => evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('missing contrast target: ' + ${JSON.stringify(selector)});
    const parse = (value) => (String(value).match(/[0-9.]+/g) || []).map(Number);
    const luminance = (rgb) => {
      const channels = rgb.slice(0, 3).map((part) => {
        const value = part / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const foreground = parse(getComputedStyle(element, ${JSON.stringify(pseudo || null)}).color);
    let current = element;
    let background = [255, 255, 255, 1];
    while (current) {
      const candidate = parse(getComputedStyle(current).backgroundColor);
      if (candidate.length >= 3 && (candidate.length < 4 || candidate[3] > 0.98)) {
        background = candidate;
        break;
      }
      current = current.parentElement;
    }
    const fg = luminance(foreground);
    const bg = luminance(background);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  })()`);

  const assertReadable = async (selector, pseudo = "") => {
    const ratio = await contrastRatio(selector, pseudo);
    assert.ok(ratio >= 4.5, `${selector}${pseudo || ""} contrast ${ratio.toFixed(2)} is below WCAG AA`);
  };

  const auditVisibleTextContrast = async (rootSelector) => evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    if (!root) throw new Error('missing contrast root: ' + ${JSON.stringify(rootSelector)});
    const parse = (value) => {
      const parts = (String(value).match(/[0-9.]+/g) || []).map(Number);
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts.length > 3 ? parts[3] : 1];
    };
    const blend = (top, bottom) => {
      const alpha = Math.max(0, Math.min(1, top[3]));
      return [
        top[0] * alpha + bottom[0] * (1 - alpha),
        top[1] * alpha + bottom[1] * (1 - alpha),
        top[2] * alpha + bottom[2] * (1 - alpha),
        1,
      ];
    };
    const luminance = (rgba) => {
      const channels = rgba.slice(0, 3).map((part) => {
        const value = part / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const backgroundFor = (element) => {
      const chain = [];
      for (let current = element; current; current = current.parentElement) chain.push(current);
      let background = [255, 255, 255, 1];
      chain.reverse().forEach((current) => {
        background = blend(parse(getComputedStyle(current).backgroundColor), background);
      });
      return background;
    };
    const candidates = [...root.querySelectorAll('button,input,textarea,select,p,span,small,strong,h1,h2,h3,h4,label,td,th,dt,dd')];
    const violations = [];
    for (const element of candidates) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (element.classList.contains('visually-hidden') || rect.width < 1 || rect.height < 1) continue;
      let rendered = true;
      for (let current = element; current && current !== root.parentElement; current = current.parentElement) {
        const currentStyle = getComputedStyle(current);
        if (current.hidden || currentStyle.display === 'none' || currentStyle.visibility === 'hidden' || Number(currentStyle.opacity) <= 0.01) {
          rendered = false;
          break;
        }
      }
      if (!rendered || style.display === 'none' || style.visibility === 'hidden') continue;
      const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (!ownText && !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) continue;
      const background = backgroundFor(element);
      let foreground = blend(parse(style.color), background);
      let opacity = 1;
      for (let current = element; current && current !== root.parentElement; current = current.parentElement) {
        opacity *= Number(getComputedStyle(current).opacity) || 0;
      }
      foreground = blend([foreground[0], foreground[1], foreground[2], opacity], background);
      const fg = luminance(foreground);
      const bg = luminance(background);
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      if (ratio < 4.5) violations.push({
        selector: element.id ? '#' + element.id : element.className ? element.tagName.toLowerCase() + '.' + String(element.className).trim().replace(/\\s+/g, '.') : element.tagName.toLowerCase(),
        text: (element.value || element.textContent || '').trim().slice(0, 40),
        ratio: Number(ratio.toFixed(2)),
        color: style.color,
        background: getComputedStyle(element).backgroundColor,
        opacity: Number(opacity.toFixed(2)),
      });
    }
    return violations;
  })()`);

  const click = async (selector) => evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('missing button ${selector}');
    if (element.disabled) throw new Error('disabled button ${selector}');
    element.click();
    return true;
  })()`);

  const tap = async (selector) => {
    await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('missing touch target ${selector}');
      if (element.disabled) throw new Error('disabled touch target ${selector}');
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      document.body.style.setProperty('scroll-behavior', 'auto', 'important');
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      return true;
    })()`);
    await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 1 || rect.height < 1) {
        throw new Error('hidden touch target ${selector}');
      }
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
    })()`);
    await delay(400);
    const settledPoint = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit !== element && !element.contains(hit)) {
        const hitRect = hit?.getBoundingClientRect?.();
        const navRect = document.querySelector('#accountBar')?.getBoundingClientRect?.();
        throw new Error('covered touch target ${selector}: ' + JSON.stringify({
          hit: hit?.id || hit?.className || hit?.tagName || 'none',
          target: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          hitRect: hitRect ? { left: hitRect.left, top: hitRect.top, right: hitRect.right, bottom: hitRect.bottom } : null,
          navRect: navRect ? { left: navRect.left, top: navRect.top, right: navRect.right, bottom: navRect.bottom } : null,
          viewport: { width: innerWidth, height: innerHeight, scrollY },
        }));
      }
      return { x, y, width: rect.width, height: rect.height };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: settledPoint.x, y: settledPoint.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: settledPoint.x, y: settledPoint.y, button: "left", buttons: 1, clickCount: 1 });
    await delay(60);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: settledPoint.x, y: settledPoint.y, button: "left", buttons: 0, clickCount: 1 });
    return settledPoint;
  };

  const setFiles = async (selector, files) => {
    const result = await evaluate(`document.querySelector(${JSON.stringify(selector)})`, false);
    assert.ok(result?.objectId, `missing file input ${selector}`);
    await send("DOM.setFileInputFiles", { objectId: result.objectId, files });
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change', { bubbles: true }))`);
  };

  const downloadedFiles = () => new Set(fs.readdirSync(DOWNLOAD_ROOT));
  const verifyDownload = async (selector, timeout = 60_000, expectedExtension = "") => {
    const before = downloadedFiles();
    await click(selector);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const after = downloadedFiles();
      const added = [...after].find((name) => (
        !before.has(name)
        && !name.endsWith(".crdownload")
        && (!expectedExtension || name.toLowerCase().endsWith(expectedExtension.toLowerCase()))
      ));
      if (added) return added;
      await delay(100);
    }
    throw new Error(`download did not finish for ${selector}${expectedExtension ? ` (${expectedExtension})` : ""}`);
  };

  const navigate = async (pathname) => {
    const navigation = await send("Page.navigate", { url: `${BASE_URL}${pathname}` });
    if (navigation.errorText) {
      throw new Error(`navigation failed for ${pathname}: ${navigation.errorText}`);
    }
    try {
      await waitFor("document.readyState !== 'loading' && document.querySelector('#appShell')", 15_000, pathname);
    } catch (error) {
      const snapshot = await evaluate(`({
        href: location.href,
        readyState: document.readyState,
        title: document.title,
        body: (document.body?.innerText || '').slice(0, 240),
      })`).catch(() => ({}));
      throw new Error(`${error.message}; page=${JSON.stringify(snapshot)}`);
    }
  };

  const useSession = async (session, pathname) => {
    await evaluate(`localStorage.setItem('wyjAccountSession', ${JSON.stringify(session)}); location.href = ${JSON.stringify(pathname)}; true`);
    await waitFor("!document.querySelector('#entryScreen') && !document.querySelector('#appShell')?.classList.contains('app-shell-pending')", 12_000, `${pathname} after splash`);
  };

  const check = async (name, action) => {
    const started = Date.now();
    console.error(`[app-matrix] START ${name}`);
    try {
      await action();
      const milliseconds = Date.now() - started;
      checks.push({ name, status: "passed", milliseconds });
      console.error(`[app-matrix] PASS ${name} (${milliseconds} ms)`);
    } catch (error) {
      const diagnostic = await evaluate(`({
        pathname: location.pathname,
        loginError: document.querySelector('#loginError')?.textContent || '',
        modulePickerHidden: document.querySelector('#modulePicker')?.classList.contains('hidden'),
        authPanelHidden: document.querySelector('#authPanel')?.classList.contains('hidden'),
        sessionLength: (localStorage.getItem('wyjAccountSession') || '').length,
        accountCached: Boolean(localStorage.getItem('wyjAccountCache')),
        syncStatus: document.querySelector('#learningSyncStatus')?.textContent || '',
        syncDetail: document.querySelector('#learningSyncDetail')?.textContent || '',
        wrongCount: document.querySelectorAll('#wrongList .wrong-item').length,
        wrongText: (document.querySelector('#wrongList')?.textContent || '').slice(0, 300),
        rejudgeStatus: document.querySelector('.wrong-rejudge-status')?.textContent || '',
        rejudgeModal: document.querySelector('#rejudgeResultTitle')?.textContent || '',
        rejudgeMessage: document.querySelector('#rejudgeResultMessage')?.textContent || '',
        currentWrong: state?.currentWrongBook?.hello || null,
        historyWrong: state?.historyWrongBook?.hello || null,
        syncWrong: Object.values(learningSyncManager?.state?.records || {}).filter((item) => item.record_id?.includes('hello')),
        rejudgeFetches: window.__rejudgeFetches || [],
        activeWrongRejudgeKey,
        learningSyncWrongRenderPending,
      })`).catch(() => ({}));
      const detail = `${error.message}; diagnostic=${JSON.stringify(diagnostic)}; runtime=${JSON.stringify(runtimeErrors.slice(-4))}; http=${JSON.stringify(networkHttpErrors.slice(-6))}`;
      console.error(`[app-matrix] FAIL ${name}: ${detail}`);
      throw new Error(detail, { cause: error });
    }
  };

  try {
    await check("brief branded startup and unauthenticated navigation", async () => {
      const logoResponse = await fetch(`${BASE_URL}/icon-192.png`);
      const logoBytes = Buffer.from(await logoResponse.arrayBuffer());
      assert.equal(logoResponse.status, 200);
      assert.match(logoResponse.headers.get("content-type") || "", /^image\/png(?:;|$)/i);
      assert.deepEqual([...logoBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      await navigate(`/?app-matrix=${RUN_ID}`);
      await waitFor("document.querySelector('#entryScreen')", 3_000, "initial splash");
      const initial = await evaluate(`(() => {
        const entry = document.querySelector('#entryScreen');
        const shell = document.querySelector('#appShell');
        const image = document.querySelector('.entry-logo');
        const entryStyle = getComputedStyle(entry);
        const entryRect = entry.getBoundingClientRect();
        const imageStyle = getComputedStyle(image);
        return {
          entryVisible: entryStyle.display !== 'none',
          shellProtected: (
            (shell.getAttribute('aria-hidden') === 'true' && shell.classList.contains('app-shell-pending'))
            || (
              entryStyle.position === 'fixed'
              && entryRect.left <= 0
              && entryRect.top <= 0
              && entryRect.right >= innerWidth
              && entryRect.bottom >= innerHeight
              && Number.parseInt(entryStyle.zIndex || '0', 10) >= 9000
            )
          ),
          imageState: !image.complete ? "loading" : image.naturalWidth > 0 ? "loaded" : "failed",
          objectFit: imageStyle.objectFit,
          legacyDoors: document.querySelectorAll('.splash-door').length,
          legacyBrandText: document.body.textContent.includes('77 79 6A'),
        };
      })()`);
      assert.equal(initial.entryVisible, true);
      assert.equal(initial.shellProtected, true);
      assert.notEqual(initial.imageState, "failed");
      assert.equal(initial.objectFit, "contain");
      assert.equal(initial.legacyDoors, 0);
      assert.equal(initial.legacyBrandText, false);
      await waitFor("!document.querySelector('#entryScreen')", 6_000, "splash removal");
      await waitFor("location.pathname === '/' && !document.querySelector('#publicHome')?.classList.contains('hidden')", 8_000, "public home route");
      assert.equal(await evaluate("!document.querySelector('#accountBar').classList.contains('hidden')"), true);
      assert.equal(await evaluate("!document.querySelector('#navGuestActions').classList.contains('hidden')"), true);
      assert.equal(await evaluate("document.querySelector('#accountMenu').classList.contains('hidden')"), true);
      assert.equal(await evaluate("document.querySelectorAll('#publicHome .public-feature-card').length"), 7);
      assert.equal(await evaluate("document.querySelector('#publicHome').textContent.includes('无第三方追踪')"), true);
      const pwa = await evaluate(`(async () => {
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('service worker readiness timeout')), 10_000)),
        ]);
        const cacheNames = await caches.keys();
        const cachedLogo = await caches.match('/assets/logo.png');
        const cachedProductStyles = await caches.match('/product-ui.css?v=20260811-tool-workflows');
        const cachedChangelog = await caches.match('/changelog.js?v=20260811-tool-workflows');
        const cachedLearningSync = await caches.match('/learning-sync.js?v=20260811-tool-workflows');
        const cachedWorkflows = await caches.match('/workflows.js?v=20260811-tool-workflows');
        return { active: Boolean(registration.active), cacheNames, cachedLogo: Boolean(cachedLogo), cachedProductStyles: Boolean(cachedProductStyles), cachedChangelog: Boolean(cachedChangelog), cachedLearningSync: Boolean(cachedLearningSync), cachedWorkflows: Boolean(cachedWorkflows) };
      })()`);
      assert.equal(pwa.active, true);
      assert.equal(pwa.cachedLogo, true);
      assert.equal(pwa.cachedProductStyles, true);
      assert.equal(pwa.cachedChangelog, true);
      assert.equal(pwa.cachedLearningSync, true);
      assert.equal(pwa.cachedWorkflows, true);
      await waitFor("!document.querySelector('#versionNotice')?.classList.contains('hidden')", 3_000, "first-version notice");
      assert.equal(await evaluate("document.querySelector('#siteVersionLabel').textContent.trim()"), "v2026.08.11.3");
      await click("#dismissVersionNoticeBtn");
      assert.equal(await evaluate("document.querySelector('#versionNotice').classList.contains('hidden')"), true);
      assert.equal(await evaluate("localStorage.getItem('wyjChangelogSeenVersion:v1')"), "2026-08-11-tool-workflows");
      const desktopShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(path.join(TEST_ROOT, `public-home-1440-${RUN_ID}.png`), Buffer.from(desktopShot.data, "base64"));
    });

    await check("limited anonymous trial stays local and protected routes remain locked", async () => {
      await navigate(`/trial?app-matrix=${RUN_ID}`);
      await waitFor("!document.querySelector('#entryScreen')", 6_000, "trial splash removal");
      await waitFor("location.pathname === '/trial' && !document.querySelector('#trialPage')?.classList.contains('hidden')", 8_000, "trial route");
      assert.equal(await evaluate("document.querySelectorAll('[data-trial-tool]').length"), 5);
      assert.equal(await evaluate("document.querySelector('#trialImageInput').multiple"), false);
      const requestStart = networkRequests.length;
      const storageBefore = await evaluate(`JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`);

      await setFields({ "#trialQuizCount": 99, "#trialQuizLanguage": "english" });
      await click("#trialQuizStartBtn");
      await waitFor("document.querySelector('#trialQuizProgress')?.textContent.includes('/ 10')", 3_000, "ten-question trial cap");
      for (let index = 0; index < 10; index += 1) {
        await setFields({ "#trialQuizAnswer": `wrong-${index}` });
        await click("#trialQuizSubmitBtn");
        await waitFor("!document.querySelector('#trialQuizNextBtn')?.classList.contains('hidden')", 2_000, "trial next button");
        await click("#trialQuizNextBtn");
      }
      await waitFor("!document.querySelector('#trialQuizSummary')?.classList.contains('hidden')", 3_000, "trial completion summary");
      assert.equal(await evaluate("document.querySelector('#trialQuizFinalScore').textContent"), "0 / 10");
      assert.equal(await evaluate("document.querySelector('#trialQuizSummary').textContent.includes('注册后')"), true);

      await click('[data-trial-tool="text"]');
      await setFields({ "#trialTextInput": "hello world\n\n你好" });
      assert.equal(await evaluate("document.querySelector('#trialTextCharacters').textContent"), "15");
      assert.equal(await evaluate("document.querySelector('#trialTextLines').textContent"), "3");
      assert.equal(await evaluate("document.querySelector('#trialTextParagraphs').textContent"), "2");

      await click('[data-trial-tool="json"]');
      await setFields({ "#trialJsonInput": '{"name":"WYJ","trial":true}' });
      await click("#trialJsonFormatBtn");
      assert.equal(await evaluate("document.querySelector('#trialJsonOutput').textContent.includes('\\n')"), true);
      assert.equal(await evaluate("document.querySelector('#trialJsonMessage').textContent.includes('合法')"), true);
      await setFields({ "#trialJsonInput": '{broken' });
      await click("#trialJsonValidateBtn");
      assert.equal(await evaluate("document.querySelector('#trialJsonMessage').classList.contains('is-error')"), true);

      await click('[data-trial-tool="image-compress"]');
      await setFiles("#trialImageInput", [trialImageFile]);
      await click("#trialImageProcessBtn");
      await waitFor("!document.querySelector('#trialImageResult')?.classList.contains('hidden')", 8_000, "local image compression");
      assert.equal(await evaluate("document.querySelector('#trialImageDownload').href.startsWith('blob:')"), true);
      await click('[data-trial-tool="image-format"]');
      assert.equal(await evaluate("document.querySelector('[data-site-nav=tools]').getAttribute('aria-current')"), "page");
      await setFields({ "#trialImageFormat": "image/png" });
      await click("#trialImageProcessBtn");
      await waitFor("!document.querySelector('#trialImageResult')?.classList.contains('hidden')", 8_000, "local image conversion");
      assert.equal(await evaluate("document.querySelector('#trialImageDownload').download.endsWith('.png')"), true);

      assert.equal(await evaluate(`JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`), storageBefore);
      const trialApiRequests = networkRequests.slice(requestStart).filter((item) => {
        const pathname = new URL(item.url).pathname;
        return ["/api/quiz/start", "/api/judge", "/api/tools/recent", "/api/temporary/text"].includes(pathname);
      });
      assert.deepEqual(trialApiRequests, []);

      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      const mobileTrial = await evaluate(`({ viewport: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth })`);
      assert.ok(mobileTrial.scrollWidth <= mobileTrial.viewport + 1, JSON.stringify(mobileTrial));
      const trialShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(TEST_ROOT, `public-trial-390-${RUN_ID}.png`), Buffer.from(trialShot.data, "base64"));
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

      await navigate(`/changelog?app-matrix=${RUN_ID}`);
      await waitFor("!document.querySelector('#entryScreen')", 6_000, "changelog splash removal");
      await waitFor("location.pathname === '/changelog' && !document.querySelector('#changelogPage')?.classList.contains('hidden')", 8_000, "changelog route");
      assert.equal(await evaluate("document.querySelectorAll('#changelogPage .changelog-list article').length"), 7);
      assert.equal(await evaluate("document.querySelector('#changelogPage').textContent.includes('可配置工具工作流')"), true);
      assert.ok(Number(await evaluate("document.querySelectorAll('#changelogPage .changelog-sections section').length")) >= 10);
      assert.equal(await evaluate("document.querySelector('#changelogCurrentVersion').textContent.trim()"), "v2026.08.11.3");
      assert.equal(await evaluate("document.querySelector('#versionNotice').classList.contains('hidden')"), true);
      for (const pathName of ["/tools", "/language", "/admin"]) {
        await navigate(`${pathName}?app-matrix=${RUN_ID}`);
        await waitFor("!document.querySelector('#entryScreen')", 6_000, `${pathName} splash removal`);
        await waitFor("location.pathname === '/login' && !document.querySelector('#authPanel')?.classList.contains('hidden')", 8_000, `${pathName} login protection`);
      }
    });

    await check("registration and login UI", async () => {
      await navigate(`/register?app-matrix=${RUN_ID}`);
      await waitFor("!document.querySelector('#entryScreen')", 6_000, "register splash removal");
      await waitFor("location.pathname === '/register' && !document.querySelector('#registerForm')?.classList.contains('hidden')", 8_000, "register route");
      await setFields({
        "#registerUsernameInput": USERNAME,
        "#registerSecretInput": USER_SECRET,
        "#registerConfirmInput": USER_SECRET,
      });
      await click("#registerSubmitBtn");
      await waitFor("document.querySelector('#loginError')?.textContent.includes('注册成功')", 12_000, "registration success");
      assert.equal(await evaluate("location.pathname"), "/login");
      assert.equal(await evaluate("document.querySelector('#usernameInput').value"), USERNAME);
      await click("#loginSubmitBtn");
      await waitFor("location.pathname === '/select' && !document.querySelector('#modulePicker')?.classList.contains('hidden')", 12_000, "module picker");
      assert.ok((await evaluate("localStorage.getItem('wyjAccountSession') || ''")).length > 20);
    });

    const userSession = await evaluate("localStorage.getItem('wyjAccountSession')");
    const userMe = await api("/api/me", null, userSession);
    const browserFeedbackTitle = `Browser feedback ${RUN_ID}`;
    let browserFeedbackId = "";

    await check("authenticated dashboard summary and responsive layout", async () => {
      assert.ok((await evaluate("document.querySelector('#dashboardGreeting').textContent")).includes(USERNAME));
      assert.equal(await evaluate("document.querySelectorAll('.dashboard-metric').length"), 4);
      assert.equal(await evaluate("document.querySelectorAll('[data-dashboard-project]').length"), 2);
      assert.match(await evaluate("document.querySelector('#dashboardAccountStatus').textContent"), /在线|离线/);
      assert.ok((await evaluate("document.querySelector('#dashboardLatestResult').textContent")).length > 4);
      await assertReadable("#dashboardMembershipName");
      await assertReadable("#dashboardMembershipExpiry");
      await assertReadable(".dashboard-empty");
      await delay(240);
      assert.deepEqual(await auditVisibleTextContrast("#modulePicker"), []);
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      const mobileDashboard = await evaluate(`({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, cards: document.querySelectorAll('.dashboard-entry-grid .module-card').length })`);
      assert.ok(mobileDashboard.scrollWidth <= mobileDashboard.viewport + 1, JSON.stringify(mobileDashboard));
      assert.equal(mobileDashboard.cards, 3);
      const mobileShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(path.join(TEST_ROOT, `dashboard-390-${RUN_ID}.png`), Buffer.from(mobileShot.data, "base64"));
      await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.dashboard-entry-grid')).gridTemplateColumns.split(' ').length"), 3);
      const wideShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(path.join(TEST_ROOT, `dashboard-1920-${RUN_ID}.png`), Buffer.from(wideShot.data, "base64"));
      await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
      const desktopShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(path.join(TEST_ROOT, `dashboard-1366-${RUN_ID}.png`), Buffer.from(desktopShot.data, "base64"));
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    });

    await check("learning data sync is local-first and receives a second-device update", async () => {
      await waitFor(
        "/已同步|已合并/.test(document.querySelector('#dashboardSyncStatus')?.textContent || '')",
        15_000,
        "initial learning sync",
      );
      assert.equal(await evaluate("document.querySelector('#learningSyncNowBtn').offsetParent !== null"), true);
      assert.equal(await evaluate("document.querySelector('#learningSyncExportBtn').offsetParent !== null"), true);
      assert.equal(await evaluate("document.querySelector('#learningSyncImportBtn').offsetParent !== null"), true);

      await send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
      await evaluate(`(() => {
        localStorage.setItem(studyGoalKey('english'), '31');
        queueStudyGoalForSync('english');
        renderDashboard();
        return true;
      })()`);
      assert.equal(await evaluate("localStorage.getItem(studyGoalKey('english'))"), "31");
      assert.equal(await evaluate("document.querySelector('#dashboardSyncStatus').textContent"), "等待同步");
      const offlineResult = await evaluate("learningSyncManager.syncNow()");
      assert.equal(offlineResult.offline, true);

      await send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await evaluate("learningSyncManager.syncNow()");
      await waitFor(
        "learningSyncManager.dirtyRecords().length === 0 && /已同步|已合并/.test(document.querySelector('#dashboardSyncStatus')?.textContent || '')",
        15_000,
        "pending learning data upload",
      );

      const secondDeviceRecordId = await evaluate("window.WYJLearningSync.makeRecordId('goal', [state.profile, 'english'])");
      const secondDevice = await api("/api/learning/sync", {
        schema_version: 1,
        client_id: "browser-matrix-device-b",
        client_version: "browser-matrix",
        since_version: 0,
        changes: [{
          data_type: "daily_goal",
          record_id: secondDeviceRecordId,
          payload: { goal: 47 },
          updated_at: new Date(Date.now() + 1000).toISOString(),
          deleted: false,
          base_server_version: 0,
        }],
      }, userSession);
      assert.equal(secondDevice.results[0].payload.goal, 47);
      await evaluate("learningSyncManager.syncNow()");
      await waitFor("localStorage.getItem(studyGoalKey('english')) === '47'", 10_000, "second-device daily goal");
      assert.equal(await evaluate("learningSyncManager.dirtyRecords().length"), 0);

      const backupName = await verifyDownload("#learningSyncExportBtn", 10_000, ".json");
      const backupText = fs.readFileSync(path.join(DOWNLOAD_ROOT, backupName), "utf8");
      const backup = JSON.parse(backupText);
      assert.equal(backup.account_id, userMe.account.id);
      assert.equal(backup.type, "wyj-learning-data-backup");
      assert.equal(backupText.includes("vocabRuntime"), false);
      const mismatch = await evaluate(`(() => {
        const backup = JSON.parse(learningSyncManager.exportBackup());
        backup.account_id = 'another-account';
        try {
          learningSyncManager.importBackup(JSON.stringify(backup));
          return '';
        } catch (error) {
          return error.message;
        }
      })()`);
      assert.match(mismatch, /不属于当前登录账号/);
    });

    await check("authenticated feedback submission is private and mobile-safe", async () => {
      await click("#accountMenu summary");
      await waitFor("!document.querySelector('#feedbackBtn')?.classList.contains('hidden')", 2_000, "feedback account action");
      await click("#feedbackBtn");
      await waitFor("!document.querySelector('#feedbackModal')?.classList.contains('hidden')", 3_000, "feedback modal");
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await delay(300);
      const mobileFeedback = await evaluate(`({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        tabs: document.querySelectorAll('.feedback-tabs button').length,
        submitHeight: document.querySelector('#submitFeedbackBtn').getBoundingClientRect().height,
      })`);
      assert.ok(mobileFeedback.scrollWidth <= mobileFeedback.viewport + 1, JSON.stringify(mobileFeedback));
      assert.equal(mobileFeedback.tabs, 3);
      assert.ok(mobileFeedback.submitHeight >= 44, JSON.stringify(mobileFeedback));
      await setFields({
        "#feedbackType": "feature_suggestion",
        "#feedbackTitleInput": browserFeedbackTitle,
        "#feedbackContent": "Please add a compact browser-tested review filter.",
        "#feedbackIncludeRoute": true,
        "#feedbackIncludeVersion": true,
        "#feedbackIncludeBrowser": true,
      });
      await click("#submitFeedbackBtn");
      await waitFor("document.querySelector('#feedbackMineView')?.classList.contains('active') && document.querySelector('#myFeedbackList')?.textContent.includes(" + JSON.stringify(browserFeedbackTitle) + ")", 12_000, "submitted feedback in own list");
      const mine = await api("/api/feedback/mine", null, userSession);
      const created = mine.feedback.find((item) => item.title === browserFeedbackTitle);
      assert.ok(created, JSON.stringify(mine));
      browserFeedbackId = created.id;
      assert.equal(created.route, "/select");
      assert.equal(created.app_version, await evaluate("APP_VERSION"));
      const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(TEST_ROOT, `feedback-390-${RUN_ID}.png`), Buffer.from(shot.data, "base64"));
      await click('[data-close-modal="feedbackModal"]');
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    });

    await check("offline state preserves the session and reconnects", async () => {
      await send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
      await evaluate("window.dispatchEvent(new Event('offline')); true");
      await waitFor("backendAvailable === false", 3_000, "offline state");
      assert.equal(await evaluate("location.pathname"), "/select");
      assert.equal(await evaluate("localStorage.getItem('wyjAccountSession')"), userSession);

      await send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 80,
        downloadThroughput: 1_500_000,
        uploadThroughput: 750_000,
      });
      await evaluate("window.dispatchEvent(new Event('online')); true");
      await waitFor("backendAvailable === true", 20_000, "automatic backend recovery");
      assert.equal(await evaluate("location.pathname"), "/select");
      assert.equal(await evaluate("localStorage.getItem('wyjAccountSession')"), userSession);
    });

    await check("locked toolbox, direct-route guard and membership plans", async () => {
      await click('[data-module="tools"]');
      await waitFor("!document.querySelector('#membershipModal')?.classList.contains('hidden')", 12_000, "membership modal");
      assert.equal(await evaluate("location.pathname"), "/select");
      await waitFor("selectedMembershipGoal === 'tools' && document.querySelectorAll('#membershipPlanList [data-plan]').length === 3", 12_000, "tool membership choices");
      const expectedByGoal = {
        english: ["trial_single_language", "dual_language_monthly", "all_access_monthly", "japanese_lifetime", "all_access_lifetime"],
        japanese: ["trial_single_language", "dual_language_monthly", "all_access_monthly", "japanese_lifetime", "all_access_lifetime"],
        bilingual: ["dual_language_monthly", "all_access_monthly", "japanese_lifetime", "all_access_lifetime"],
        tools: ["tools_monthly", "all_access_monthly", "all_access_lifetime"],
        all: ["all_access_monthly", "all_access_lifetime"],
      };
      const planTextByCode = {};
      const observedCodes = new Set();
      for (const [goal, expectedCodes] of Object.entries(expectedByGoal)) {
        await click(`[data-membership-goal="${goal}"]`);
        await waitFor(`selectedMembershipGoal === ${JSON.stringify(goal)} && document.querySelectorAll('#membershipPlanList [data-plan]').length === ${expectedCodes.length}`, 3_000, `${goal} membership choices`);
        const plans = await evaluate(`[...document.querySelectorAll('#membershipPlanList [data-plan]')].map(node => ({ code: node.dataset.plan, text: node.textContent }))`);
        assert.deepEqual(plans.map((item) => item.code), expectedCodes);
        plans.forEach((item) => {
          observedCodes.add(item.code);
          planTextByCode[item.code] = item.text;
        });
      }
      assert.deepEqual([...observedCodes].sort(), ["all_access_lifetime", "all_access_monthly", "dual_language_monthly", "japanese_lifetime", "tools_monthly", "trial_single_language"]);
      assert.ok(planTextByCode.trial_single_language.includes("8"));
      assert.ok(planTextByCode.dual_language_monthly.includes("20"));
      assert.ok(planTextByCode.dual_language_monthly.includes("双语言包月"));
      assert.ok(planTextByCode.tools_monthly.includes("20"));
      assert.ok(planTextByCode.all_access_monthly.includes("30"));
      assert.ok(planTextByCode.japanese_lifetime.includes("70"));
      assert.ok(planTextByCode.japanese_lifetime.includes("双语言双项永久会员"));
      assert.ok(planTextByCode.all_access_lifetime.includes("100"));
      await assertReadable(".plan-option small");
      await assertReadable(".membership-goal-option small");
      await assertReadable(".membership-warning");
      await delay(240);
      assert.deepEqual(await auditVisibleTextContrast("#membershipModal"), []);
      assert.equal(await evaluate("document.querySelector('#paymentMethodField').classList.contains('hidden')"), true);
      await click('[data-membership-goal="english"]');
      await click('[data-plan="trial_single_language"]');
      assert.equal(await evaluate("document.querySelector('#trialLanguageField').classList.contains('hidden')"), false);
      assert.equal(await evaluate("document.querySelector('#trialLanguageSelect').value"), "english");
      assert.equal(await evaluate("document.querySelector('#trialLanguageSelect').disabled"), true);
      assert.equal(await evaluate("document.querySelectorAll('#paymentMethodList input[name=\"paymentMethod\"]').length"), 2);
      await click('[data-membership-goal="tools"]');
      await click('[data-plan="all_access_monthly"]');
      assert.ok((await evaluate("document.querySelector('#purchaseSummary').textContent")).includes("30 CNY"));
      assert.equal(await evaluate("document.querySelector('#submitRechargeBtn').disabled"), true);
      await click('#paymentMethodList input[value="wechat"]');
      await evaluate("window.__wyjOriginalImageDecode = HTMLImageElement.prototype.decode; HTMLImageElement.prototype.decode = undefined; true");
      await click("#submitRechargeBtn");
      await waitFor("!document.querySelector('#paymentOrderBox')?.classList.contains('hidden')", 12_000, "payment order");
      assert.ok((await evaluate("document.querySelector('#paymentAmount').textContent")).includes("30.00 CNY"));
      assert.ok((await evaluate("document.querySelector('#paymentNote').textContent")).includes(USERNAME));
      assert.equal(await evaluate("document.querySelector('#paymentMethodList input:checked')?.value"), "wechat");
      assert.equal(await evaluate("document.querySelector('#paymentMethod').textContent.trim()"), "微信支付");
      assert.equal(await evaluate("document.querySelector('#paymentStatus').textContent.trim()"), "等待付款");
      assert.equal(await evaluate("document.querySelector('#paymentQrLabel').textContent.trim()"), "请使用微信支付扫码付款");
      assert.equal(await evaluate("document.querySelector('#confirmPaymentBtn').classList.contains('hidden')"), false);
      assert.equal(await evaluate("document.querySelector('#confirmPaymentBtn').disabled"), false);
      assert.equal(await evaluate("document.querySelector('#submitRechargeBtn').textContent.includes('等待管理员')"), false);
      await waitFor("document.querySelector('#paymentQrImage')?.src.startsWith('blob:')", 12_000, "protected payment QR");
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      const mobilePayment = await evaluate(`({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        modalWidth: document.querySelector('#membershipModal .modal-panel').getBoundingClientRect().width,
        qrRight: document.querySelector('#paymentQrImage').getBoundingClientRect().right,
      })`);
      assert.ok(mobilePayment.scrollWidth <= mobilePayment.viewport + 1, JSON.stringify(mobilePayment));
      assert.ok(mobilePayment.modalWidth <= mobilePayment.viewport, JSON.stringify(mobilePayment));
      assert.ok(mobilePayment.qrRight <= mobilePayment.viewport + 1, JSON.stringify(mobilePayment));
      const mobileMembershipShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(TEST_ROOT, `membership-390-${RUN_ID}.png`), Buffer.from(mobileMembershipShot.data, "base64"));
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await click("#confirmPaymentBtn");
      await waitFor("document.querySelector('#paymentStatus')?.textContent.includes('等待确认')", 12_000, "payment confirmation");
      await click('[data-close-modal="membershipModal"]');
      await waitFor("paymentQrObjectUrl === '' && !document.querySelector('#paymentQrImage').getAttribute('src')", 3_000, "payment QR object URL revoked");
      await evaluate("HTMLImageElement.prototype.decode = window.__wyjOriginalImageDecode; delete window.__wyjOriginalImageDecode; true");
      await evaluate("location.href = '/tools'; true");
      await waitFor("location.pathname === '/select' && !document.querySelector('#membershipModal')?.classList.contains('hidden')", 12_000, "direct tools guard");
      await waitFor("!document.querySelector('#paymentOrderBox')?.classList.contains('hidden')", 12_000, "open payment order restored");
      assert.equal(await evaluate("selectedMembershipGoal"), "tools");
      assert.equal(await evaluate("document.querySelector('#paymentOrderBox').classList.contains('hidden')"), false);
      await click('[data-close-modal="membershipModal"]');
    });

    await check("WeChat and Alipay order state survives a full page reload", async () => {
      const labels = { wechat: "微信支付", alipay: "支付宝" };
      for (const method of ["wechat", "alipay"]) {
        const paymentUser = await createUser(`pay${method}`);
        await useSession(paymentUser.session, "/recharge");
        await waitFor("!document.querySelector('#membershipModal')?.classList.contains('hidden')", 12_000, `${method} recharge modal`);
        await click('[data-membership-goal="tools"]');
        await waitFor("document.querySelector('#membershipPlanList [data-plan=\"tools_monthly\"]')", 8_000, `${method} tools plan`);
        await click('[data-plan="tools_monthly"]');
        assert.equal(await evaluate("selectedPaymentMethod"), "");
        assert.equal(await evaluate("document.querySelector('#submitRechargeBtn').disabled"), true);
        await click(`#paymentMethodList input[value="${method}"]`);
        assert.equal(await evaluate("selectedPaymentMethod"), method);
        assert.ok((await evaluate("document.querySelector('#purchaseSummary').textContent")).includes(labels[method]));
        await click("#submitRechargeBtn");
        await waitFor("currentPaymentOrder?.status === 'pending_payment' && !document.querySelector('#paymentOrderBox')?.classList.contains('hidden')", 12_000, `${method} pending payment order`);
        assert.equal(await evaluate("currentPaymentOrder.payment_method"), method);
        assert.equal(await evaluate("document.querySelector('#paymentMethod').textContent.trim()"), labels[method]);
        assert.equal(await evaluate("document.querySelector('#paymentStatus').textContent.trim()"), "等待付款");
        assert.equal(await evaluate("document.querySelector('#paymentQrLabel').textContent.trim()"), `请使用${labels[method]}扫码付款`);
        assert.equal(await evaluate("document.querySelector('#confirmPaymentBtn').classList.contains('hidden')"), false);
        assert.equal(await evaluate("document.querySelector('#submitRechargeBtn').textContent.includes('等待管理员')"), false);
        await waitFor("document.querySelector('#paymentQrImage')?.src.startsWith('blob:')", 12_000, `${method} payment QR`);

        await navigate(`/recharge?payment-method=${method}&run=${RUN_ID}`);
        await waitFor("!document.querySelector('#entryScreen')", 6_000, `${method} recharge reload splash`);
        await waitFor("currentPaymentOrder?.status === 'pending_payment' && !document.querySelector('#paymentOrderBox')?.classList.contains('hidden')", 12_000, `${method} restored order`);
        assert.equal(await evaluate("selectedPaymentMethod"), method);
        assert.equal(await evaluate("document.querySelector('#paymentMethodList input:checked')?.value"), method);
        assert.equal(await evaluate("document.querySelector('#paymentMethod').textContent.trim()"), labels[method]);
        assert.equal(await evaluate("document.querySelector('#paymentStatus').textContent.trim()"), "等待付款");
        assert.equal(await evaluate("document.querySelector('#paymentQrLabel').textContent.trim()"), `请使用${labels[method]}扫码付款`);
        assert.equal(await evaluate("document.querySelector('#confirmPaymentBtn').classList.contains('hidden')"), false);
        assert.equal(await evaluate("document.querySelector('#confirmPaymentBtn').disabled"), false);
        assert.equal(await evaluate("document.querySelector('#submitRechargeBtn').textContent.includes('等待管理员')"), false);
        await waitFor("document.querySelector('#paymentQrImage')?.src.startsWith('blob:')", 12_000, `${method} restored payment QR`);
        await click("#cancelPaymentOrderBtn");
        await waitFor("!currentPaymentOrder && document.querySelector('#paymentOrderBox').classList.contains('hidden')", 8_000, `${method} order cancellation`);
        await click('[data-close-modal="membershipModal"]');
      }
      await useSession(userSession, "/select");
      await waitFor("!document.querySelector('#modulePicker')?.classList.contains('hidden')", 8_000, "main user dashboard restored");
    });

    await check("word import, export, shuffle and clear", async () => {
      await click('[data-module="language"]');
      await waitFor("location.pathname === '/language'", 4_000, "language picker");
      await click('[data-project="english"]');
      try {
        await waitFor("location.pathname === '/language/english' && !document.querySelector('#workspace')?.classList.contains('hidden')", 8_000, "English workspace");
      } catch (error) {
        const state = await evaluate(`({
          path: location.pathname,
          moduleHidden: document.querySelector('#modulePicker')?.classList.contains('hidden'),
          pickerHidden: document.querySelector('#projectPicker')?.classList.contains('hidden'),
          projectHidden: document.querySelector('#projectApp')?.classList.contains('hidden'),
          workspaceHidden: document.querySelector('#workspace')?.classList.contains('hidden'),
          authHidden: document.querySelector('#authPanel')?.classList.contains('hidden'),
          loginError: document.querySelector('#loginError')?.textContent || '',
          badge: document.querySelector('#accountBadge')?.textContent || '',
          pendingScreen,
          currentProject,
          backendAvailable,
          sessionLength: state.session?.length || 0,
          hasAccount: Boolean(state.account),
        })`);
        throw new Error(`${error.message}: ${JSON.stringify(state)}`);
      }
      await setFiles("#wordFileInput", [wordsFile]);
      await waitFor("document.querySelector('#wordInput')?.value.includes('hello')", 5_000, "word import");
      const before = (await evaluate("document.querySelector('#wordInput').value.split(/\\n/).sort()"));
      const exported = await verifyDownload("#exportWordsBtn", 10_000, ".txt");
      assert.ok(exported.endsWith(".txt"));
      await click("#shuffleBtn");
      const after = await evaluate("document.querySelector('#wordInput').value.split(/\\n/).sort()");
      assert.deepEqual(after, before);
      await click("#clearBtn");
      await waitFor("!document.querySelector('#confirmModal')?.classList.contains('hidden')", 3_000, "clear confirmation");
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelector('#wordInput').value === ''", 3_000, "words cleared");
    });

    await check("free limit, empty answer and skipped wrong-book flow", async () => {
      const freeLimitWords = ["apple", "book", "cat", "dog", "earth", "flower", "green", "house", "idea", "juice", "kite", "light", "music", "night", "orange", "paper"];
      await setFields({ "#wordInput": freeLimitWords.join("\n") });
      await delay(300);
      assert.ok((await evaluate("document.querySelector('#wordLimitHint').textContent")).includes("最多测试 15"));
      if (!await evaluate("document.querySelector('#membershipModal')?.classList.contains('hidden')")) {
        await click('[data-close-modal="membershipModal"]');
        await waitFor("document.querySelector('#membershipModal')?.classList.contains('hidden')", 3_000, "limit prompt closed");
      }
      await click("#startBtn");
      await waitFor("!document.querySelector('#membershipModal')?.classList.contains('hidden')", 12_000, "server limit modal");
      await waitFor("/15|上限|会员/.test(document.querySelector('#rechargeMessage')?.textContent || '')", 12_000, "server limit message");
      const limitMessage = await evaluate("document.querySelector('#rechargeMessage')?.textContent || ''");
      assert.match(limitMessage, /15|上限|会员/, `unexpected limit message: ${limitMessage}`);
      await click('[data-close-modal="membershipModal"]');
      assert.equal(await evaluate("document.querySelector('#setupView').classList.contains('active')"), true);
      await setFields({ "#wordInput": "hello\nworld", "#practiceModeSelect": "meaning", "#gradingModeSelect": "normal" });
      await click("#startBtn");
      await waitFor("document.querySelector('#quizView').classList.contains('active') && document.querySelector('#progressLabel').textContent === '1/2'", 20_000, "quiz start");
      const word = await evaluate("document.querySelector('#wordLabel').textContent");
      await click("#submitBtn");
      await waitFor("!document.querySelector('#answerValidation')?.classList.contains('hidden')", 3_000, "empty answer validation");
      assert.ok((await evaluate("document.querySelector('#answerValidation').textContent")).includes("请输入中文意思"));
      assert.equal(await evaluate("document.querySelector('#wordLabel').textContent"), word);
      assert.equal(await evaluate("document.querySelector('#statWrong').textContent"), "0");
      await click("#skipBtn");
      await waitFor("document.querySelector('#resultTitle')?.textContent.includes('跳过') && !document.querySelector('#nextNowBtn')?.disabled", 4_000, "first skip");
      assert.equal(await evaluate("document.querySelector('#statWrong').textContent"), "1");
      await click("#nextNowBtn");
      await waitFor("document.querySelector('#progressLabel').textContent === '2/2'", 4_000, "second question");
      await click("#skipBtn");
      await waitFor("!document.querySelector('#nextNowBtn')?.disabled", 4_000, "second skip");
      await click("#nextNowBtn");
      await waitFor("!document.querySelector('#roundSummaryModal')?.classList.contains('hidden')", 5_000, "round summary");
      assert.equal(await evaluate("document.querySelector('#roundSkippedCount').textContent"), "2");
      assert.equal(await evaluate("document.querySelector('#roundWrongCount').textContent"), "0");
      await click("#roundWrongBtn");
      await waitFor("document.querySelector('#wrongView').classList.contains('active') && document.querySelectorAll('#wrongList .wrong-item').length === 2", 4_000, "wrong book");
    });

    await check("wrong search, JSON/PDF export, import and offline review", async () => {
      await setFields({ "#wrongSearchInput": "hello" });
      assert.equal(await evaluate("document.querySelectorAll('#wrongList .wrong-item').length"), 1);
      await setFields({ "#wrongSearchInput": "" });
      const pdfName = await verifyDownload("#exportBtn", 80_000, ".pdf");
      assert.ok(pdfName.endsWith(".pdf"));
      const pdfBytes = fs.readFileSync(path.join(DOWNLOAD_ROOT, pdfName));
      assert.equal(pdfBytes.subarray(0, 4).toString("ascii"), "%PDF");
      const jsonName = await verifyDownload("#exportWrongDataBtn", 10_000, ".json");
      assert.ok(jsonName.endsWith(".json"));
      await click("#clearWrongBtn");
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelectorAll('#wrongList .wrong-item').length === 0", 4_000, "wrong book clear");
      await setFiles("#wrongDataFileInput", [wrongFile]);
      await waitFor("document.querySelectorAll('#wrongList .wrong-item').length === 1", 6_000, "wrong data import");
      await assertReadable(".wrong-rejudge-button");
      await assertReadable("#wrongSearchInput", "::placeholder");
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const rejudgeButtonBox = await evaluate(`(() => {
        const button = document.querySelector('.wrong-rejudge-button');
        document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
        button.scrollIntoView({ block: 'center', behavior: 'auto' });
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height, viewport: innerWidth, text: button.textContent.trim() };
      })()`);
      assert.equal(rejudgeButtonBox.text, "重新判定");
      assert.ok(rejudgeButtonBox.left >= 0 && rejudgeButtonBox.right <= rejudgeButtonBox.viewport + 1, JSON.stringify(rejudgeButtonBox));
      assert.ok(rejudgeButtonBox.width >= 100 && rejudgeButtonBox.height >= 44, JSON.stringify(rejudgeButtonBox));
      await evaluate(`(() => {
        window.__rejudgeFetches = [];
        window.__rejudgeTouchTrace = [];
        for (const eventName of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click']) {
          document.addEventListener(eventName, (event) => {
            window.__rejudgeTouchTrace.push({
              type: event.type,
              target: event.target?.className || event.target?.tagName || '',
              x: Math.round(event.clientX ?? event.changedTouches?.[0]?.clientX ?? -1),
              y: Math.round(event.clientY ?? event.changedTouches?.[0]?.clientY ?? -1),
            });
          }, { capture: true, once: false });
        }
        if (!window.__rejudgeOriginalFetch) window.__rejudgeOriginalFetch = window.fetch;
        window.fetch = (...args) => {
          const url = String(args[0]?.url || args[0] || '');
          const pathname = new URL(url, location.href).pathname;
          if (pathname === '/api/quiz/start' || pathname === '/api/judge') {
            window.__rejudgeFetches.push(pathname);
          }
          return window.__rejudgeOriginalFetch(...args);
        };
        return true;
      })()`);
      const rejudgeTapPoint = await tap(".wrong-rejudge-button");
      await delay(250);
      const rejudgeTouchResult = await evaluate(`(() => ({
        open: !document.querySelector('.wrong-rejudge-form')?.classList.contains('hidden'),
        expanded: document.querySelector('.wrong-rejudge-button')?.getAttribute('aria-expanded'),
        hit: document.elementFromPoint(${rejudgeTapPoint.x}, ${rejudgeTapPoint.y})?.className || '',
        trace: window.__rejudgeTouchTrace,
      }))()`);
      assert.ok(rejudgeTouchResult.open, `mobile rejudge form did not open: ${JSON.stringify(rejudgeTouchResult)}`);
      await setFields({ ".wrong-rejudge-input": "你好" });
      await tap(".wrong-rejudge-submit");
      await waitFor("document.querySelectorAll('#wrongList .wrong-item').length === 0", 6_000, "wrong answer rejudged and removed");
      await waitFor("!document.querySelector('#rejudgeResultModal')?.classList.contains('hidden') && document.querySelector('#rejudgeResultTitle')?.textContent === '重新判定正确'", 4_000, "correct rejudge result modal");
      await evaluate(`(() => {
        document.querySelector('#rejudgeResultModal').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      })()`);
      await delay(240);
      assert.equal(await evaluate("document.querySelector('#rejudgeResultModal').classList.contains('hidden')"), false);
      const rejudgeModalState = await evaluate(`(() => {
        const layer = document.querySelector('#rejudgeResultModal');
        const panel = document.querySelector('#rejudgeResultPanel');
        const layerStyle = getComputedStyle(layer);
        const rect = panel.getBoundingClientRect();
        return {
          ariaHidden: layer.getAttribute('aria-hidden'),
          position: layerStyle.position,
          zIndex: Number(layerStyle.zIndex),
          title: document.querySelector('#rejudgeResultTitle').textContent,
          message: document.querySelector('#rejudgeResultMessage').textContent,
          top: rect.top,
          bottom: rect.bottom,
          viewportHeight: innerHeight,
          scrollY,
        };
      })()`);
      assert.equal(rejudgeModalState.ariaHidden, "false");
      assert.equal(rejudgeModalState.position, "fixed");
      assert.ok(rejudgeModalState.zIndex >= 9000, JSON.stringify(rejudgeModalState));
      assert.ok(rejudgeModalState.top >= 0 && rejudgeModalState.bottom <= rejudgeModalState.viewportHeight + 1, JSON.stringify(rejudgeModalState));
      assert.ok(rejudgeModalState.message.includes("已从错题本移除"), rejudgeModalState.message);
      assert.ok(!(await evaluate("document.querySelector('#wrongActionMessage').textContent")).includes("重新作答正确"));
      const rejudgeModalShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(TEST_ROOT, `rejudge-result-modal-390-${RUN_ID}.png`), Buffer.from(rejudgeModalShot.data, "base64"));
      await tap("#rejudgeResultConfirmBtn");
      await waitFor("document.querySelector('#rejudgeResultModal')?.classList.contains('hidden')", 2_000, "correct rejudge modal close");
      assert.ok(Math.abs((await evaluate("scrollY")) - rejudgeModalState.scrollY) <= 1, `scroll changed after modal close: ${JSON.stringify(rejudgeModalState)}`);
      assert.equal(await evaluate("JSON.parse(localStorage.getItem(wrongRejudgeLogKey()) || '[]').length"), 1);
      assert.deepEqual(
        [...new Set(await evaluate("window.__rejudgeFetches"))].sort(),
        ["/api/judge", "/api/quiz/start"],
      );
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await setFiles("#wrongDataFileInput", [wrongFile]);
      await waitFor("document.querySelectorAll('#wrongList .wrong-item').length === 1", 6_000, "wrong data reimport");
      await evaluate(`(() => {
        for (const book of [state.currentWrongBook, state.historyWrongBook]) {
          if (!book.hello) continue;
          book.hello.correct_answer = '';
          book.hello.accepted = [];
          book.hello.rubric = { gloss: '', accepted: [], language: 'english', notes: '' };
        }
        renderWrongBook();
        window.__rejudgeFailureOriginalFetch = window.fetch;
        window.fetch = (...args) => {
          const url = String(args[0]?.url || args[0] || '');
          if (new URL(url, location.href).pathname === '/api/quiz/start') {
            return Promise.resolve(new Response(JSON.stringify({ error: '模拟网络连接失败' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            }));
          }
          return window.__rejudgeFailureOriginalFetch(...args);
        };
        return true;
      })()`);
      await click(".wrong-rejudge-button");
      await setFields({ ".wrong-rejudge-input": "你好" });
      try {
        await click(".wrong-rejudge-submit");
        await waitFor("!document.querySelector('#rejudgeResultModal')?.classList.contains('hidden') && document.querySelector('#rejudgeResultTitle')?.textContent === '重新判定失败'", 4_000, "failed rejudge result modal");
        const failedRejudge = await evaluate(`({
          message: document.querySelector('#rejudgeResultMessage').textContent,
          count: document.querySelectorAll('#wrongList .wrong-item').length,
          inlineStatus: document.querySelector('.wrong-rejudge-status').textContent,
          pageMessage: document.querySelector('#wrongActionMessage').textContent,
        })`);
        assert.ok(failedRejudge.message.includes("模拟网络连接失败"), JSON.stringify(failedRejudge));
        assert.equal(failedRejudge.count, 1);
        assert.ok(!failedRejudge.inlineStatus.includes("失败"), JSON.stringify(failedRejudge));
        assert.ok(!failedRejudge.pageMessage.includes("重新判定失败"), JSON.stringify(failedRejudge));
        await click("#rejudgeResultConfirmBtn");
        await waitFor("document.querySelector('#rejudgeResultModal')?.classList.contains('hidden')", 2_000, "failed rejudge modal close");
      } finally {
        await evaluate("window.fetch = window.__rejudgeFailureOriginalFetch; delete window.__rejudgeFailureOriginalFetch; true");
      }
      await setFiles("#wrongDataFileInput", [wrongFile]);
      await waitFor("state.currentWrongBook.hello?.correct_answer === '你好'", 4_000, "restore imported rubric after network failure");
      await click("#reviewBtn");
      await waitFor("document.querySelector('#quizView').classList.contains('active')", 8_000, "offline review start");
      await setFields({ "#answerInput": "你好" });
      await click("#submitBtn");
      await waitFor("document.querySelector('#resultTitle')?.classList.contains('ok') && !document.querySelector('#nextNowBtn')?.disabled", 5_000, "offline review answer");
      await click("#nextNowBtn");
      await waitFor("!document.querySelector('#roundSummaryModal')?.classList.contains('hidden')", 4_000, "review summary");
      assert.equal(await evaluate("document.querySelector('#roundCorrectCount').textContent"), "1");
      await click("#roundSetupBtn");
    });

    await check("mobile language question state and rejudge scenarios A-H", async () => {
      await api("/api/admin/membership/manage", {
        user_id: userMe.account.id,
        action: "grant",
        plan_code: "tools_monthly",
        note: "isolated browser navigation matrix",
      }, admin.session);
      await useSession(userSession, "/language/english");
      await waitFor("location.pathname === '/language/english' && !document.querySelector('#workspace')?.classList.contains('hidden')", 12_000, "mobile English workspace");
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await send("Network.setUserAgentOverride", {
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
        acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
        platform: "Android",
      });
      await evaluate("window.__languageMatrixRandom = Math.random; Math.random = () => 0.999999; true");

      const ensureEnglishProject = async () => {
        if (await evaluate("location.pathname === '/tools'")) {
          await tap("#leaveToolsBtn");
          await waitFor("location.pathname === '/select'", 5_000, "leave tools");
        }
        if (await evaluate("location.pathname === '/select'")) {
          await tap('[data-module="language"]');
          await waitFor("location.pathname === '/language'", 5_000, "language picker from dashboard");
        }
        if (await evaluate("location.pathname === '/language'")) {
          await tap('[data-project="english"]');
        }
        await waitFor("location.pathname === '/language/english' && !document.querySelector('#workspace')?.classList.contains('hidden')", 10_000, "English project restored");
      };

      const startMeaningRound = async (words) => {
        await ensureEnglishProject();
        if (!await evaluate("document.querySelector('#roundSummaryModal')?.classList.contains('hidden')")) await tap("#roundSetupBtn");
        await tap('[data-view="setupView"]');
        await setFields({ "#practiceModeSelect": "meaning", "#gradingModeSelect": "normal", "#wordInput": words.join("\n") });
        await tap("#startBtn");
        await delay(180);
        if (!await evaluate("document.querySelector('#confirmModal')?.classList.contains('hidden')")) await tap("#acceptConfirmBtn");
        await waitFor(`document.querySelector('#quizView')?.classList.contains('active') && document.querySelector('#progressLabel')?.textContent === '1/${words.length}' && !state.busy`, 20_000, `start ${words.length}-word round`);
        return evaluate("[...state.words]");
      };

      const submitMeaning = async (answer, expectedTitle) => {
        await setFields({ "#answerInput": answer });
        await tap("#submitBtn");
        await waitFor(`document.querySelector('#resultTitle')?.textContent === ${JSON.stringify(expectedTitle)} && state.pendingAdvance && !state.busy`, 15_000, `${expectedTitle} feedback`);
      };

      const reloadEnglishWorkspace = async () => {
        await send("Page.reload", { ignoreCache: true });
        await waitFor("document.querySelector('#appShell') && !document.querySelector('#entryScreen')", 8_000, "reload splash completion");
        await waitFor("location.pathname === '/language/english' && !document.querySelector('#workspace')?.classList.contains('hidden')", 12_000, "English workspace after reload");
      };

      // A: a real wrong answer can be re-answered; an incorrect retry is idempotent and a correct retry persists.
      await startMeaningRound(["amber", "birch", "cedar"]);
      await submitMeaning("完全错误", "错误");
      await tap('[data-view="wrongView"]');
      await waitFor("document.querySelectorAll('#wrongList .wrong-item').length === 1", 3_000, "scenario A wrong item");
      const originalWrongCount = await evaluate("Number(document.querySelector('.wrong-item-actions strong').textContent.replace(/\\D/g, ''))");
      const visibleRejudge = await tap(".wrong-rejudge-button");
      assert.ok(visibleRejudge.height >= 44 && visibleRejudge.width >= 100, JSON.stringify(visibleRejudge));
      await setFields({ ".wrong-rejudge-input": "仍然错误" });
      await tap(".wrong-rejudge-submit");
      await waitFor("!document.querySelector('#rejudgeResultModal')?.classList.contains('hidden') && document.querySelector('#rejudgeResultTitle')?.textContent === '重新判定仍不正确'", 12_000, "scenario A incorrect retry modal");
      assert.ok((await evaluate("document.querySelector('#rejudgeResultMessage').textContent")).includes("错误次数未增加"));
      assert.equal(await evaluate("document.querySelector('.wrong-rejudge-status').textContent"), "可重新作答；答错不会增加错误次数");
      assert.ok(!(await evaluate("document.querySelector('#wrongActionMessage').textContent")).includes("仍不正确"));
      await tap("#rejudgeResultConfirmBtn");
      assert.equal(await evaluate("Number(document.querySelector('.wrong-item-actions strong').textContent.replace(/\\D/g, ''))"), originalWrongCount);
      await tap(".wrong-rejudge-button");
      await setFields({ ".wrong-rejudge-input": "测试释义" });
      await tap(".wrong-rejudge-submit");
      await waitFor("document.querySelectorAll('#wrongList .wrong-item').length === 0 && !document.querySelector('#rejudgeResultModal')?.classList.contains('hidden') && document.querySelector('#rejudgeResultTitle')?.textContent === '重新判定正确'", 12_000, "scenario A correct retry removal modal");
      await tap("#rejudgeResultConfirmBtn");
      assert.equal(await evaluate("Object.keys(state.currentWrongBook).length"), 0);
      assert.equal(await evaluate("Object.keys(state.historyWrongBook).includes('amber')"), false);
      await reloadEnglishWorkspace();
      await tap('[data-view="wrongView"]');
      assert.equal(await evaluate("Object.keys(state.currentWrongBook).includes('amber') || Object.keys(state.historyWrongBook).includes('amber')"), false);
      await tap('[data-view="quizView"]');
      if (await evaluate("Boolean(state.pendingAdvance)")) await tap("#nextNowBtn");
      await waitFor("document.querySelector('#progressLabel')?.textContent === '2/3'", 5_000, "scenario A resumes question 2");

      // B: the feedback remains visible for exactly the one authoritative transition window.
      await startMeaningRound(["delta", "elm", "fir"]);
      await submitMeaning("测试释义", "正确");
      assert.equal(await evaluate("QUESTION_TRANSITION_MS"), 5333);
      await tap('[data-view="wrongView"]');
      await tap('[data-view="quizView"]');
      const remaining = await evaluate("state.pendingAdvance.dueAt - Date.now()");
      await delay(Math.max(0, remaining - 350));
      assert.equal(await evaluate("document.querySelector('#progressLabel').textContent"), "1/3");
      assert.equal(await evaluate("!document.querySelector('#resultPanel').classList.contains('hidden') && getComputedStyle(document.querySelector('#resultPanel')).opacity === '1'"), true);
      await waitFor("document.querySelector('#progressLabel')?.textContent === '2/3'", 2_500, "scenario B timed question 2");
      assert.equal(await evaluate("document.querySelector('#resultPanel').classList.contains('hidden')"), true);
      assert.equal(await evaluate("state.pendingAdvance === null && state.answerLocked === false"), true);

      // C: skipping uses the standard rubric, displays it, and supports a new correct answer.
      await startMeaningRound(["garden", "harbor", "island"]);
      await tap("#skipBtn");
      await waitFor("document.querySelector('#resultTitle')?.textContent === '已跳过' && state.pendingAdvance && !state.busy", 15_000, "scenario C skip feedback");
      const skippedFeedback = await evaluate("document.querySelector('#resultGloss').textContent");
      assert.ok(skippedFeedback.includes("标准释义：测试释义"), skippedFeedback);
      assert.ok(skippedFeedback.includes("已加入错题本"), skippedFeedback);
      await tap('[data-view="wrongView"]');
      const skippedCardText = await evaluate("document.querySelector('#wrongList .wrong-item p').textContent");
      assert.equal(skippedCardText, "已跳过 · 标准：测试释义");
      await tap(".wrong-rejudge-button");
      await setFields({ ".wrong-rejudge-input": "测试释义" });
      await tap(".wrong-rejudge-submit");
      await waitFor("document.querySelectorAll('#wrongList .wrong-item').length === 0 && !document.querySelector('#rejudgeResultModal')?.classList.contains('hidden') && document.querySelector('#rejudgeResultTitle')?.textContent === '重新判定正确'", 12_000, "scenario C skipped item removed modal");
      assert.ok((await evaluate("document.querySelector('#rejudgeResultMessage').textContent")).includes("已从错题本移除"));
      await tap("#rejudgeResultConfirmBtn");
      assert.equal(await evaluate("state.roundSkipped"), 0);
      assert.equal(await evaluate("state.score"), 1);
      await tap('[data-view="quizView"]');
      const canAdvanceSkippedQuestionNow = await evaluate(`(() => {
        const button = document.querySelector('#nextNowBtn');
        const rect = button?.getBoundingClientRect();
        return Boolean(state.pendingAdvance) && !button?.disabled && rect?.width > 0 && rect?.height > 0;
      })()`);
      if (canAdvanceSkippedQuestionNow) await tap("#nextNowBtn");
      await waitFor("document.querySelector('#progressLabel')?.textContent === '2/3'", 7_000, "scenario C resumes question 2");

      // D: repeated inner views, dashboard, project picker, and tools never consume question 2.
      await startMeaningRound(["jasmine", "kernel", "linen"]);
      await submitMeaning("测试释义", "正确");
      await tap('[data-view="wrongView"]');
      await tap('[data-view="quizView"]');
      await tap("#accountMenu summary");
      await tap("#homeBtn");
      await waitFor("location.pathname === '/select'", 5_000, "scenario D dashboard");
      await tap('[data-module="language"]');
      await tap('[data-project="english"]');
      await waitFor("location.pathname === '/language/english'", 8_000, "scenario D first return");
      assert.ok(Number((await evaluate("document.querySelector('#progressLabel').textContent")).split("/")[0]) <= 2);
      await tap("#backProjectBtn");
      await tap("#languageBackBtn");
      await waitFor("location.pathname === '/select'", 5_000, "scenario D module picker");
      await tap('[data-module="tools"]');
      await waitFor("location.pathname === '/tools' && !document.querySelector('#toolsPanel')?.classList.contains('hidden')", 10_000, "scenario D tools");
      await tap("#leaveToolsBtn");
      await ensureEnglishProject();
      if (await evaluate("Boolean(state.pendingAdvance)")) await tap("#nextNowBtn");
      await waitFor("document.querySelector('#progressLabel')?.textContent === '2/3'", 5_000, "scenario D stable question 2");

      // E/F: reload after leaving the feedback phase lands on question 2; repeated reloads keep the same word.
      const eWords = await startMeaningRound(["mango", "nectar", "orbit"]);
      const recordsBeforeE = await evaluate("state.studyRecords.length");
      await submitMeaning("完全错误", "错误");
      await tap('[data-view="wrongView"]');
      await tap('[data-view="quizView"]');
      await reloadEnglishWorkspace();
      await waitFor("document.querySelector('#progressLabel')?.textContent === '2/3'", 8_000, "scenario E question 2 after reload");
      const secondWord = await evaluate("state.words[1]");
      assert.equal(secondWord, eWords[1]);
      assert.equal(await evaluate("state.index"), 1);
      assert.equal(await evaluate("state.studyRecords.length"), recordsBeforeE);
      assert.equal(await evaluate(`Boolean(state.historyWrongBook[${JSON.stringify(eWords[1])}])`), false);
      for (let refreshIndex = 0; refreshIndex < 3; refreshIndex += 1) {
        await reloadEnglishWorkspace();
        assert.equal(await evaluate("document.querySelector('#progressLabel').textContent"), "2/3");
        assert.equal(await evaluate("state.words[state.index]"), secondWord);
        assert.equal(await evaluate("state.index"), 1);
      }

      // G: an unanswered question survives inner and outer navigation without being marked wrong or skipped.
      await tap('[data-view="wrongView"]');
      await tap('[data-view="quizView"]');
      await tap("#accountMenu summary");
      await tap("#homeBtn");
      await ensureEnglishProject();
      assert.equal(await evaluate("document.querySelector('#progressLabel').textContent"), "2/3");
      assert.equal(await evaluate("state.words[state.index]"), secondWord);
      assert.equal(await evaluate(`Boolean(state.historyWrongBook[${JSON.stringify(secondWord)}])`), false);
      assert.equal(await evaluate("state.roundSkipped"), 0);

      // Contrast and mobile layout are checked on every language view, including disabled controls.
      const contrastViolations = [];
      for (const viewId of ["setupView", "quizView", "wrongView", "achievementsView", "studyView"]) {
        await tap(`[data-view="${viewId}"]`);
        await delay(240);
        contrastViolations.push(...(await auditVisibleTextContrast("#projectApp")).map((item) => ({ viewId, ...item })));
      }
      assert.deepEqual(contrastViolations, [], JSON.stringify(contrastViolations, null, 2));
      await tap('[data-view="quizView"]');
      for (const selector of ["#skipBtn", "#nextNowBtn", "#answerInput"]) await assertReadable(selector);
      await assertReadable("#answerInput", "::placeholder");
      await tap('[data-view="wrongView"]');
      await delay(240);
      for (const selector of ["#exportBtn", "#exportHistoryBtn", "#exportWrongDataBtn", "#importWrongDataBtn", "#clearWrongBtn", "#clearHistoryBtn"]) await assertReadable(selector);
      const mobileControlsShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(TEST_ROOT, `language-controls-390-${RUN_ID}.png`), Buffer.from(mobileControlsShot.data, "base64"));
      await evaluate(`(() => {
        document.querySelector('.wrong-item')?.scrollIntoView({ block: 'center', behavior: 'auto' });
        return true;
      })()`);
      await delay(160);
      const mobileWrongShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(TEST_ROOT, `language-wrong-390-${RUN_ID}.png`), Buffer.from(mobileWrongShot.data, "base64"));
      for (const width of [360, 430]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 2, mobile: true });
        const bounds = await evaluate("({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth })");
        assert.ok(bounds.documentWidth <= bounds.viewport + 1 && bounds.bodyWidth <= bounds.viewport + 1, `${width}px: ${JSON.stringify(bounds)}`);
      }
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

      // H: ten deliberate actions produce exactly ten consumed questions and exact statistics.
      const hWords = await startMeaningRound(["apple", "book", "cat", "dog", "earth", "flower", "green", "house", "idea", "juice"]);
      const seenWords = [];
      for (let questionIndex = 0; questionIndex < hWords.length; questionIndex += 1) {
        assert.equal(await evaluate("state.index"), questionIndex);
        assert.equal(await evaluate("document.querySelector('#progressLabel').textContent"), `${questionIndex + 1}/10`);
        seenWords.push(await evaluate("state.words[state.index]"));
        if (questionIndex % 3 === 0) await submitMeaning("测试释义", "正确");
        else if (questionIndex % 3 === 1) await submitMeaning("完全错误", "错误");
        else {
          await tap("#skipBtn");
          await waitFor("document.querySelector('#resultTitle')?.textContent === '已跳过' && state.pendingAdvance && !state.busy", 15_000, `scenario H skip ${questionIndex + 1}`);
        }
        await tap("#nextNowBtn");
        if (questionIndex < hWords.length - 1) {
          await waitFor(`document.querySelector('#progressLabel')?.textContent === '${questionIndex + 2}/10'`, 4_000, `scenario H question ${questionIndex + 2}`);
        }
      }
      await waitFor("!document.querySelector('#roundSummaryModal')?.classList.contains('hidden')", 5_000, "scenario H summary");
      assert.equal(new Set(seenWords).size, 10);
      assert.equal(await evaluate("document.querySelector('#roundCorrectCount').textContent"), "4");
      assert.equal(await evaluate("document.querySelector('#roundWrongCount').textContent"), "3");
      assert.equal(await evaluate("document.querySelector('#roundSkippedCount').textContent"), "3");
      const finalStudyRecord = await evaluate("state.studyRecords[state.studyRecords.length - 1]");
      assert.deepEqual(
        { total: finalStudyRecord.total, correct: finalStudyRecord.correct, wrong: finalStudyRecord.wrong, skipped: finalStudyRecord.skipped },
        { total: 10, correct: 4, wrong: 3, skipped: 3 },
      );
      assert.equal(await evaluate("Object.keys(activeWrongBook('current')).length"), 6);
      assert.equal(await evaluate(`Boolean(state.historyWrongBook[${JSON.stringify(secondWord)}])`), false);
      await tap("#roundWrongBtn");
      await waitFor("document.querySelector('#wrongView')?.classList.contains('active')", 4_000, "scenario H wrong book");
      assert.equal(await evaluate("document.querySelectorAll('#wrongList .wrong-item').length"), 6);

      await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
      await send("Emulation.setTouchEmulationEnabled", { enabled: false });
      assert.deepEqual(await auditVisibleTextContrast("#projectApp"), []);
      const desktopLanguageShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(path.join(TEST_ROOT, `language-wrong-1366-${RUN_ID}.png`), Buffer.from(desktopLanguageShot.data, "base64"));
      await evaluate("Math.random = window.__languageMatrixRandom; delete window.__languageMatrixRandom; true");
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    });

    await check("English dictation, speech, achievements and study statistics", async () => {
      await setFields({ "#practiceModeSelect": "dictation", "#wordInput": "hello" });
      await click("#startBtn");
      await waitFor("document.querySelector('#quizView').classList.contains('active')", 8_000, "dictation start");
      await click("#speakBtn");
      await setFields({ "#answerInput": "HELLO" });
      await click("#submitBtn");
      await waitFor("document.querySelector('#resultTitle')?.classList.contains('ok') && !document.querySelector('#nextNowBtn')?.disabled", 5_000, "dictation result");
      await click("#nextNowBtn");
      await waitFor("!document.querySelector('#roundSummaryModal')?.classList.contains('hidden')", 4_000, "dictation summary");
      assert.equal(await evaluate("document.querySelector('#roundAccuracy').textContent"), "正确率 100%");
      await assertReadable(".round-summary-grid span");
      await assertReadable(".round-summary-grid strong");
      await click("#roundSetupBtn");
      await click('[data-view="achievementsView"]');
      await waitFor("document.querySelectorAll('#achievementList .achievement-item').length === 25", 4_000, "achievement catalog");
      assert.ok(Number(await evaluate("document.querySelector('#achievementUnlockedCount').textContent")) >= 4);
      await click('[data-achievement-filter="unlocked"]');
      assert.ok(Number(await evaluate("document.querySelectorAll('#achievementList .achievement-item').length")) >= 1);
      await click('[data-achievement-filter="progress"]');
      assert.ok(Number(await evaluate("document.querySelectorAll('#achievementList .achievement-item').length")) >= 1);
      await click('[data-achievement-filter="all"]');
      await click('[data-view="studyView"]');
      assert.ok(Number(await evaluate("document.querySelector('#studyTotalRounds').textContent")) >= 2);
      await setFields({ "#studyGoalInput": 25 });
      assert.equal(await evaluate("document.querySelector('#studyGoalBar').max"), 25);
      const statsName = await verifyDownload("#exportStudyBtn", 10_000, ".json");
      assert.ok(statsName.endsWith(".json"));
      await click("#clearStudyBtn");
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelector('#studyTotalRounds').textContent === '0'", 4_000, "study data clear");
    });

    await check("Japanese kanji/kana resolution and both-form dictation", async () => {
      await click("#backProjectBtn");
      await waitFor("location.pathname === '/language'", 4_000, "project picker return");
      await click('[data-project="japanese"]');
      await waitFor("location.pathname === '/language/japanese' && !document.querySelector('#workspace')?.classList.contains('hidden')", 8_000, "Japanese workspace");
      await setFields({ "#practiceModeSelect": "meaning", "#wordInput": "電話" });
      await click("#startBtn");
      await waitFor("document.querySelector('#quizView').classList.contains('active') && document.querySelector('#wordReading')?.textContent.length > 0", 180_000, "Japanese reading annotation");
      await delay(300);
      assert.equal(await evaluate("document.querySelector('#wordText').textContent"), "電話");
      assert.equal(await evaluate("document.querySelector('#wordReading').textContent"), "でんわ");
      assert.ok((await evaluate("document.querySelector('#wordLabel').getAttribute('aria-label')")).includes("でんわ"));
      const readingShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(path.join(TEST_ROOT, `japanese-reading-${RUN_ID}.png`), Buffer.from(readingShot.data, "base64"));
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      const mobileReading = await evaluate(`(() => {
        const label = document.querySelector('#wordLabel').getBoundingClientRect();
        const reading = document.querySelector('#wordReading').getBoundingClientRect();
        return { scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth, labelRight: label.right, readingRight: reading.right };
      })()`);
      assert.ok(mobileReading.scrollWidth <= mobileReading.viewport + 1, JSON.stringify(mobileReading));
      assert.ok(mobileReading.labelRight <= mobileReading.viewport + 1, JSON.stringify(mobileReading));
      assert.ok(mobileReading.readingRight <= mobileReading.viewport + 1, JSON.stringify(mobileReading));
      const mobileReadingShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(path.join(TEST_ROOT, `japanese-reading-mobile-${RUN_ID}.png`), Buffer.from(mobileReadingShot.data, "base64"));
      await send("Emulation.clearDeviceMetricsOverride");
      await click("#skipBtn");
      await waitFor("!document.querySelector('#nextNowBtn')?.disabled", 5_000, "reading annotation skip");
      await click("#nextNowBtn");
      await waitFor("!document.querySelector('#roundSummaryModal')?.classList.contains('hidden')", 4_000, "reading annotation summary");
      await click("#roundSetupBtn");
      await setFields({ "#practiceModeSelect": "meaning", "#wordInput": "でんわ" });
      await click("#startBtn");
      await waitFor("document.querySelector('#quizView').classList.contains('active')", 8_000, "kana-only meaning start");
      assert.equal(await evaluate("document.querySelector('#wordText').textContent"), "でんわ");
      assert.equal(await evaluate("document.querySelector('#wordReading').classList.contains('hidden')"), true);
      await click("#skipBtn");
      await waitFor("!document.querySelector('#nextNowBtn')?.disabled", 5_000, "kana-only meaning skip");
      await click("#nextNowBtn");
      await waitFor("!document.querySelector('#roundSummaryModal')?.classList.contains('hidden')", 4_000, "kana-only meaning summary");
      await click("#roundSetupBtn");
      const authorization = await api("/api/quiz/start", { language: "japanese", words: ["花", "みず"] }, userSession);
      const resolved = await api("/api/japanese/readings", { words: ["花", "みず"], quiz_session: authorization.quiz_session }, userSession);
      assert.ok(resolved.readings?.["花"]);
      assert.ok(resolved.readings?.["みず"]);
      assert.ok(resolved.written_forms?.["みず"]);
      await evaluate(`rememberJapaneseVocabularyData(${JSON.stringify(resolved.readings)}, ${JSON.stringify(resolved.written_forms)}); true`);
      await setFields({ "#practiceModeSelect": "dictation", "#wordInput": "花" });
      await click("#startBtn");
      await waitFor("document.querySelector('#quizView').classList.contains('active')", 8_000, "Japanese dictation start");
      await setFields({ "#answerInput": "花" });
      await click("#submitBtn");
      await waitFor("document.querySelector('#resultTitle')?.classList.contains('bad') && !document.querySelector('#nextNowBtn')?.disabled", 5_000, "missing kana rejected");
      assert.ok((await evaluate("document.querySelector('#acceptedChips').textContent")).includes("同时填写"));
      await click("#nextNowBtn");
      await waitFor("!document.querySelector('#roundSummaryModal')?.classList.contains('hidden')", 4_000, "Japanese failed summary");
      await click("#roundSetupBtn");
      await setFields({ "#wordInput": "みず" });
      await click("#startBtn");
      await waitFor("document.querySelector('#quizView').classList.contains('active')", 8_000, "kana-only input start");
      const written = resolved.written_forms["みず"];
      await setFields({ "#answerInput": `${written} / ${resolved.readings["みず"]}` });
      await click("#submitBtn");
      try {
        await waitFor("document.querySelector('#resultTitle')?.classList.contains('ok') && !document.querySelector('#nextNowBtn')?.disabled", 5_000, "kanji and kana accepted");
      } catch (error) {
        const detail = await evaluate(`({
          word: state.words[state.index],
          reading: japaneseReadingFor(state.words[state.index]),
          written: japaneseWrittenFormFor(state.words[state.index]),
          expected: formatJapaneseDictationAnswer(state.words[state.index]),
          answer: document.querySelector('#answerInput')?.value || '',
          title: document.querySelector('#resultTitle')?.textContent || '',
          titleClass: document.querySelector('#resultTitle')?.className || '',
          gloss: document.querySelector('#resultGloss')?.textContent || '',
          chips: document.querySelector('#acceptedChips')?.textContent || '',
          nextDisabled: document.querySelector('#nextNowBtn')?.disabled,
        })`);
        throw new Error(`${error.message}: API=${JSON.stringify(resolved)} UI=${JSON.stringify(detail)}`);
      }
      await click("#nextNowBtn");
      await waitFor("!document.querySelector('#roundSummaryModal')?.classList.contains('hidden')", 4_000, "Japanese success summary");
      assert.equal(await evaluate("document.querySelector('#roundAccuracy').textContent"), "正确率 100%");
      await click("#roundSetupBtn");
    });

    await check("administrator recharge approval, membership editor and entitlement override", async () => {
      await useSession(admin.session, "/admin");
      await waitFor("!document.querySelector('#adminPanel')?.classList.contains('hidden') && document.querySelector('#adminPanel').getAttribute('aria-busy') === 'false'", 15_000, "admin panel");
      await click('[data-admin-view="adminRechargeView"]');
      const requestSelector = `#adminRechargeList [data-request-id]`;
      await waitFor(`[...document.querySelectorAll(${JSON.stringify(requestSelector)})].some(node => node.textContent.includes(${JSON.stringify(USERNAME)}))`, 8_000, "user recharge request");
      await evaluate(`(() => { const card=[...document.querySelectorAll(${JSON.stringify(requestSelector)})].find(node => node.textContent.includes(${JSON.stringify(USERNAME)})); card.querySelector('[data-recharge-approve]').click(); return true; })()`);
      await click("#acceptConfirmBtn");
      await waitFor(`![...document.querySelectorAll(${JSON.stringify(requestSelector)})].find(node => node.textContent.includes(${JSON.stringify(USERNAME)}))?.querySelector('[data-recharge-approve]')`, 12_000, "recharge approved");
      await click('[data-admin-view="adminUsersView"]');
      await setFields({ "#adminUserSearch": USERNAME });
      await waitFor("document.querySelectorAll('#adminUserList .admin-user-card').length === 1", 5_000, "admin user search");
      await assertReadable(".admin-user-facts strong");
      await click("#adminUserList [data-admin-edit]");
      await waitFor("!document.querySelector('#adminEditModal')?.classList.contains('hidden')", 3_000, "admin editor");
      assert.deepEqual(
        await evaluate("[...document.querySelector('#adminMembershipSelect').options].map(option => option.value).filter(Boolean)"),
        ["trial_single_language", "dual_language_monthly", "tools_monthly", "all_access_monthly", "japanese_lifetime", "all_access_lifetime"],
      );
      assert.ok((await evaluate("document.querySelector('#adminCurrentMemberships').textContent")).includes("全功能包月会员"));
      await assertReadable(".admin-current-memberships article small");
      await setFields({ "#adminMembershipAction": "grant", "#adminMembershipSelect": "japanese_lifetime", "#adminMembershipStart": "2026.07.16", "#adminMembershipNote": "browser matrix" });
      await click("#saveAdminMembershipBtn");
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelector('#adminEditMessage')?.textContent.includes('立即生效')", 12_000, "membership grant");
      assert.ok((await evaluate("document.querySelector('#adminCurrentMemberships').textContent")).includes("双语言双项永久会员"));
      let refreshed = await api("/api/me", null, userSession);
      assert.ok(refreshed.account.entitlements.includes("language_english_access"));
      assert.ok(refreshed.account.entitlements.includes("language_japanese_access"));
      assert.ok(refreshed.account.entitlements.includes("language_all_access"));
      await click("#adminDisableToolsBtn");
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelector('#adminEditMessage')?.textContent.includes('取消工具权限')", 10_000, "tools override off");
      refreshed = await api("/api/me", null, userSession);
      assert.equal(refreshed.account.tools_access, false);
      await click("#adminEnableToolsBtn");
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelector('#adminEditMessage')?.textContent.includes('恢复按会员方案')", 10_000, "tools override restore");
      refreshed = await api("/api/me", null, userSession);
      assert.equal(refreshed.account.tools_access, true);
      await api("/api/tools/recent", { tool_id: "text-stats" }, userSession);
      await click('[data-close-modal="adminEditModal"]');
      await waitFor("document.querySelector('#adminEditModal')?.classList.contains('hidden')", 3_000, "membership editor closed");
      await click("#refreshAdminBtn");
      await waitFor("!document.querySelector('#refreshAdminBtn')?.disabled", 12_000, "admin stats refresh");
      await click('[data-admin-view="adminAuditView"]');
      assert.ok(Number(await evaluate("document.querySelectorAll('#adminAuditList .admin-log-card').length")) >= 3);
      await click('[data-admin-view="adminLoginView"]');
      assert.ok(Number(await evaluate("document.querySelectorAll('#adminLoginList .admin-login-card').length")) >= 1);
      assert.ok((await evaluate("document.querySelector('#adminLoginList').textContent")).includes("IP"));
      await assertReadable(".admin-login-location");
      await assertReadable(".admin-login-agent");
      await click('[data-admin-view="adminToolStatsView"]');
      assert.ok(Number(await evaluate("document.querySelectorAll('#adminToolStatsList .admin-log-card').length")) >= 1);
      await click('[data-admin-view="adminFeedbackView"]');
      await setFields({ "#adminFeedbackSearch": browserFeedbackTitle });
      await waitFor("document.querySelectorAll('#adminFeedbackList .admin-feedback-card').length === 1", 8_000, "admin feedback search");
      assert.ok((await evaluate("document.querySelector('#adminFeedbackList').textContent")).includes(browserFeedbackTitle));
      assert.ok((await evaluate("document.querySelector('#adminFeedbackList').textContent")).includes(USERNAME));
      await setFields({
        "#adminFeedbackList [data-feedback-admin-status]": "accepted",
        "#adminFeedbackList [data-feedback-admin-note]": "Accepted in browser regression",
      });
      await click("#adminFeedbackList [data-feedback-admin-save]");
      await waitFor(`adminFeedback.some((item) => item.id === ${JSON.stringify(browserFeedbackId)} && item.status === 'accepted' && item.admin_note === 'Accepted in browser regression')`, 12_000, "admin feedback accepted");
      await click('[data-admin-view="adminAuditView"]');
      await waitFor("document.querySelector('#adminAuditList')?.textContent.includes('feedback_update')", 5_000, "feedback audit record");
    });

    await check("administrator ban, force logout, secret reset and delete", async () => {
      const banUser = await createUser("banmatrix");
      const logoutUser = await createUser("logoutmatrix");
      const secretUser = await createUser("secretmatrix");
      const deleteUser = await createUser("deletematrix");
      await click("#refreshAdminBtn");
      await waitFor("!document.querySelector('#refreshAdminBtn')?.disabled", 12_000, "new admin users refresh");
      await evaluate("document.querySelector('[data-admin-view=\"adminUsersView\"]').click(); true");

      const openEditor = async (username) => {
        await setFields({ "#adminUserSearch": username });
        await waitFor("document.querySelectorAll('#adminUserList .admin-user-card').length === 1", 5_000, username);
        await click("#adminUserList [data-admin-edit]");
        await waitFor("!document.querySelector('#adminEditModal')?.classList.contains('hidden')", 3_000, `${username} editor`);
      };

      await openEditor(banUser.username);
      await click("#adminToggleBanBtn");
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelector('#adminEditModal')?.classList.contains('hidden')", 8_000, "ban complete");
      assert.equal((await request("/api/login", { username: banUser.username, secret: banUser.secret })).status, 403);
      await openEditor(banUser.username);
      await click("#adminToggleBanBtn");
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelector('#adminEditModal')?.classList.contains('hidden')", 8_000, "unban complete");
      assert.equal((await request("/api/login", { username: banUser.username, secret: banUser.secret })).status, 200);

      await openEditor(logoutUser.username);
      await click("#adminForceLogoutBtn");
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelector('#adminEditModal')?.classList.contains('hidden')", 8_000, "force logout");
      assert.equal((await request("/api/me", null, logoutUser.session)).status, 401);

      await openEditor(secretUser.username);
      await click("#generateAdminSecretBtn");
      const generatedSecret = await evaluate("document.querySelector('#adminNewSecretInput').value");
      assert.equal(generatedSecret.length, 24);
      assert.match(generatedSecret, /[A-Z]/);
      assert.match(generatedSecret, /[a-z]/);
      assert.match(generatedSecret, /[2-9]/);
      assert.match(generatedSecret, /[!@#$%*\-_=+?]/);
      assert.equal(await evaluate("document.querySelector('#adminNewSecretInput').type"), "text");
      await click("#toggleAdminSecretBtn");
      assert.equal(await evaluate("document.querySelector('#adminNewSecretInput').type"), "password");
      await setFields({ "#adminNewSecretInput": USER_SECRET_NEW });
      await click("#saveAdminSecretBtn");
      await click("#acceptConfirmBtn");
      await waitFor("!document.querySelector('#adminSecretResult')?.classList.contains('hidden') && document.querySelector('#adminSecretResultValue')?.textContent.length > 0", 8_000, "secret reset");
      assert.equal(await evaluate("document.querySelector('#adminNewSecretInput').value"), "");
      assert.equal(await evaluate("document.querySelector('#adminNewSecretInput').type"), "password");
      assert.equal(await evaluate("document.querySelector('#adminSecretResultValue').textContent"), USER_SECRET_NEW);
      assert.equal(await evaluate("document.querySelector('#adminSecretResult').classList.contains('hidden')"), false);
      assert.equal((await request("/api/login", { username: secretUser.username, secret: secretUser.secret })).status, 403);
      assert.equal((await request("/api/login", { username: secretUser.username, secret: USER_SECRET_NEW })).status, 200);
      await click('[data-close-modal="adminEditModal"]');
      await waitFor("document.querySelector('#adminEditModal')?.classList.contains('hidden')", 3_000, "secret editor closed");
      assert.equal(await evaluate("document.querySelector('#adminSecretResultValue').textContent"), "");
      assert.equal(await evaluate("document.querySelector('#adminSecretResult').classList.contains('hidden')"), true);

      await openEditor(deleteUser.username);
      await click("#adminDeleteUserBtn");
      await click("#acceptConfirmBtn");
      await waitFor("document.querySelector('#adminEditModal')?.classList.contains('hidden')", 8_000, "delete complete");
      assert.equal((await request("/api/login", { username: deleteUser.username, secret: deleteUser.secret })).status, 403);
    });

    await check("accepted feature voting can be added and cancelled", async () => {
      await useSession(userSession, "/select");
      await click("#accountMenu summary");
      await click("#feedbackBtn");
      await waitFor("!document.querySelector('#feedbackModal')?.classList.contains('hidden')", 3_000, "feedback modal for voting");
      await click('[data-feedback-view="feedbackVotingView"]');
      await waitFor(`document.querySelector('#featureVotingList')?.textContent.includes(${JSON.stringify(browserFeedbackTitle)})`, 8_000, "accepted feature in voting list");
      const voteCard = `#featureVotingList [data-feedback-id="${browserFeedbackId}"]`;
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(voteCard)}).textContent.includes(${JSON.stringify(USERNAME)})`), false);
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(voteCard)}).textContent.includes('Please add')`), false);
      await click(`${voteCard} [data-feedback-vote]`);
      await waitFor(`document.querySelector(${JSON.stringify(`${voteCard} [data-feedback-vote]`)})?.getAttribute('aria-pressed') === 'true'`, 8_000, "feature vote added");
      assert.ok((await evaluate(`document.querySelector(${JSON.stringify(voteCard)}).textContent`)).includes("1 票"));
      await click(`${voteCard} [data-feedback-vote]`);
      await waitFor(`document.querySelector(${JSON.stringify(`${voteCard} [data-feedback-vote]`)})?.getAttribute('aria-pressed') === 'false'`, 8_000, "feature vote cancelled");
      assert.ok((await evaluate(`document.querySelector(${JSON.stringify(voteCard)}).textContent`)).includes("0 票"));
      await click('[data-close-modal="feedbackModal"]');
    });

    await check("full member toolbox, AI vocabulary and account secret/logout draft cleanup", async () => {
      await useSession(userSession, "/select");
      await waitFor("!document.querySelector('#modulePicker')?.classList.contains('hidden')", 8_000, "member module picker");
      assert.ok((await evaluate("document.querySelector('#moduleMembershipStatus').textContent")).includes("全功能包月会员"));
      await click('[data-module="tools"]');
      await waitFor("location.pathname === '/tools' && !document.querySelector('#toolsPanel')?.classList.contains('hidden')", 12_000, "member tools access");
      await click("#leaveToolsBtn");
      await click('[data-module="language"]');
      await click('[data-project="english"]');
      await waitFor("location.pathname === '/language/english'", 6_000, "member English project");
      await setFields({ "#aiSuggestCount": 3, "#aiSuggestMode": "replace", "#aiLevelSelect": "primary_3" });
      await click("#aiSuggestBtn");
      await waitFor("!document.querySelector('#aiSuggestBtn')?.disabled", 240_000, "AI vocabulary generation");
      assert.ok(Number(await evaluate("document.querySelector('#wordInput').value.split(/\\n/).filter(Boolean).length")) >= 3);
      assert.ok((await evaluate("document.querySelector('#aiSuggestMessage').textContent")).includes("3"));
      await setFields({ "#wordInput": "draft_should_clear" });
      await click("#homeBtn");
      await click("#logoutBtn");
      await waitFor("location.pathname === '/login' && !document.querySelector('#authPanel')?.classList.contains('hidden')", 10_000, "logout");
      await setFields({ "#usernameInput": USERNAME, "#secretInput": USER_SECRET });
      await click("#loginSubmitBtn");
      await waitFor("location.pathname === '/select'", 10_000, "relogin");
      await click('[data-module="language"]');
      await click('[data-project="english"]');
      await waitFor("location.pathname === '/language/english'", 6_000, "English after relogin");
      assert.equal(await evaluate("document.querySelector('#wordInput').value"), "");
      await click("#accountBtn");
      await waitFor("!document.querySelector('#accountModal')?.classList.contains('hidden')", 3_000, "account modal");
      assert.ok((await evaluate("document.querySelector('#accountDetails').textContent")).includes(USERNAME));
      await setFields({ "#currentSecretInput": USER_SECRET, "#newSecretInput": USER_SECRET_NEW, "#newSecretConfirmInput": USER_SECRET_NEW });
      await click("#changeSecretForm button[type=submit]");
      await waitFor("document.querySelector('#accountMessage')?.textContent.includes('密钥已修改')", 10_000, "own secret change");
      await waitFor("location.pathname === '/login'", 5_000, "logout after secret change");
      assert.equal((await request("/api/login", { username: USERNAME, secret: USER_SECRET })).status, 403);
      assert.equal((await request("/api/login", { username: USERNAME, secret: USER_SECRET_NEW })).status, 200);
    });

    await check("self-service account deletion", async () => {
      const disposable = await createUser("selfdelete");
      await useSession(disposable.session, "/select");
      await click("#accountBtn");
      await click("#openDeleteAccountBtn");
      await waitFor("!document.querySelector('#deleteAccountModal')?.classList.contains('hidden')", 3_000, "delete confirmation");
      await setFields({ "#deleteSecretInput": disposable.secret });
      await click("#confirmDeleteAccountBtn");
      await waitFor("location.pathname === '/login'", 10_000, "self deletion");
      assert.equal((await request("/api/login", { username: disposable.username, secret: disposable.secret })).status, 403);
    });

    await check("mobile layout and reduced-motion startup", async () => {
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await send("Network.setUserAgentOverride", {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50",
        acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
        platform: "iPhone",
      });
      await navigate(`/login?mobile-matrix=${RUN_ID}`);
      const started = Date.now();
      await waitFor("!document.querySelector('#entryScreen')", 2_500, "reduced-motion splash");
      assert.ok(Date.now() - started < 2_000);
      const mobile = await evaluate(`({
        viewport: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        inputWidth: document.querySelector('#usernameInput').getBoundingClientRect().width,
      })`);
      assert.ok(mobile.scrollWidth <= mobile.viewport + 1, JSON.stringify(mobile));
      assert.ok(mobile.bodyScrollWidth <= mobile.viewport + 1, JSON.stringify(mobile));
      assert.ok(mobile.inputWidth > 250, JSON.stringify(mobile));
      assert.ok((await evaluate("navigator.userAgent")).includes("MicroMessenger"));
      const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(path.join(TEST_ROOT, `mobile-app-${RUN_ID}.png`), Buffer.from(shot.data, "base64"));
      await send("Emulation.clearDeviceMetricsOverride");
      await send("Emulation.setEmulatedMedia", { features: [] });
    });

    const expectedDeniedPaths = new Set(["/api/tools/access", "/api/quiz/start"]);
    const unexpectedHttpErrors = networkHttpErrors.filter((item) => {
      const pathname = new URL(item.url).pathname;
      return item.status !== 403 || !expectedDeniedPaths.has(pathname);
    });
    assert.deepEqual(unexpectedHttpErrors, [], `unexpected browser HTTP errors: ${JSON.stringify(networkHttpErrors)}`);
    assert.deepEqual(runtimeErrors, [], `browser runtime errors: ${JSON.stringify(runtimeErrors)}`);
    const result = {
      account: USERNAME,
      checks: checks.length,
      passed: checks.length,
      downloads: fs.readdirSync(DOWNLOAD_ROOT).filter((name) => !name.endsWith(".crdownload")).length,
      dialogs,
      runtimeErrors,
      expectedHttpDenials: networkHttpErrors,
      details: checks,
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
    await client.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
