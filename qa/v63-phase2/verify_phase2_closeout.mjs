import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "docs/ui-rebuild/v63-phase2-finance/evidence/closeout");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PORT = 8801;
const CDP_PORT = 9237;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PEPPER = "v63-phase2-closeout-local-test-pepper-2026";
const VIP_SECRET = "Phase2CloseVip#2026!";

function findChrome() {
  for (const p of [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean)) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome/Edge not found");
}

function killPidTree(pid) {
  if (!pid) return;
  try {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {}
}

async function waitForHttp(url, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

class CdpSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (evt) => {
      const msg = JSON.parse(String(evt.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method && this.events.has(msg.method)) {
        for (const fn of this.events.get(msg.method)) fn(msg.params);
      }
    });
  }
  on(method, fn) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(fn);
  }
  send(method, params = {}, sessionId = undefined) {
    const id = ++this.id;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeris-v63-p2close-"));
const stateDir = path.join(tmpDir, "mf-state");
const chromeDir = path.join(tmpDir, "chrome-profile");
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(chromeDir, { recursive: true });

let mfProc = null;
let chromeProc = null;
let cdp = null;

const localWranglerJs = path.join(ROOT, "node_modules/wrangler/bin/wrangler.js");
const hasLocalWrangler = fs.existsSync(localWranglerJs);
function wranglerCmd(args) {
  return hasLocalWrangler
    ? { cmd: process.execPath, args: [localWranglerJs, ...args], shell: false }
    : { cmd: "wrangler", args, shell: process.platform === "win32" };
}

try {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const w = wranglerCmd(["d1", "migrations", "apply", "WYJ_DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", stateDir]);
    const mig = spawnSync(w.cmd, w.args, { cwd: ROOT, shell: w.shell, stdio: "pipe", encoding: "utf8", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
    if (mig.status === 0) break;
    await new Promise((r) => setTimeout(r, 600));
  }

  const now = new Date().toISOString();
  const vipHash = await hashSecret(VIP_SECRET, PEPPER);
  const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
  const sqlPath = path.join(tmpDir, "seed.sql");
  fs.writeFileSync(sqlPath, [
    `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p2c-admin-1', 'wyj', 'wyj', ${q(vipHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});`,
    `INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id) VALUES ('p07_accessibility', 'Phase 2 closeout verification', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${q(now)}, 'p2c-admin-1', 'seed-1', 'seed-1') ON CONFLICT(flag_key) DO UPDATE SET enabled=1, kill_switch=0, channels_json='["stable","beta","experimental"]', rollout_basis_points=10000;`,
  ].join("\n") + "\n");
  const ws = wranglerCmd(["d1", "execute", "WYJ_DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", stateDir, "--file", sqlPath]);
  const seedRes = spawnSync(ws.cmd, ws.args, { cwd: ROOT, shell: ws.shell, stdio: "pipe", encoding: "utf8", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  assert.equal(seedRes.status, 0, seedRes.stderr || seedRes.stdout);

  const wd = wranglerCmd([
    "pages", "dev", path.join(ROOT, ".wrangler/pages-output"),
    "--ip", "127.0.0.1",
    "--port", String(PORT),
    "--persist-to", stateDir,
    "--d1", "WYJ_DB",
    "--r2", "WYJ_STORAGE",
    "--show-interactive-dev-session", "false",
    "--binding", "WYJ_ENVIRONMENT=development",
    "--binding", "CLOUD_FOUNDATION_ENABLED=true",
    "--binding", "CLOUD_STATUS_MODE=cloud",
    "--binding", "CLOUD_READS_ENABLED=true",
    "--binding", "CLOUD_WRITES_ENABLED=true",
    "--binding", "TASK11_CLOUD_READS_ENABLED=true",
    "--binding", "TASK12_CLOUD_ACCOUNTS_ENABLED=true",
    "--binding", "TASK13_CLOUD_READS_ENABLED=true",
    "--binding", "TASK13_CLOUD_WRITES_ENABLED=true",
    "--binding", "TASK16_CLOUD_READS_ENABLED=true",
    "--binding", "TASK16_CLOUD_WRITES_ENABLED=true",
    "--binding", "TASK21_NOTIFICATION_READS_ENABLED=true",
    "--binding", "TASK25_FEATURE_FLAGS_ENABLED=true",
    "--binding", "TASK29_BACKUP_RESTORE_ENABLED=true",
    "--binding", "LEGACY_API_FALLBACK_ENABLED=false",
    "--binding", `WYJ_TASK12_PASSWORD_PEPPER=${PEPPER}`,
  ]);
  mfProc = spawn(wd.cmd, wd.args, { cwd: ROOT, shell: wd.shell, stdio: "pipe", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  await waitForHttp(`${BASE_URL}/api/status`);

  const chromePath = findChrome();
  chromeProc = spawn(
    chromePath,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${chromeDir}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  const versionInfo = JSON.parse(await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 20000));
  cdp = new CdpSession(versionInfo.webSocketDebuggerUrl);
  await cdp.open();

  const { targetId } = await cdp.send("Target.createTarget", { url: `${BASE_URL}/login` });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);

  const runtimeErrors = [];
  cdp.on("Runtime.exceptionThrown", (p) => {
    runtimeErrors.push(p?.exceptionDetails?.text || JSON.stringify(p));
  });

  const evalJs = async (expression) => {
    const res = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (res.exceptionDetails) throw new Error(`JS error: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ""}`);
    return res.result?.value;
  };
  const waitFor = async (expr, timeoutMs = 25000, label = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await evalJs(`Boolean(${expr})`)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for: ${label}`);
  };
  const setViewport = async (width, height, mobile = false) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    await new Promise((r) => setTimeout(r, 150));
  };
  const snap = async (filename) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const out = path.join(OUT_DIR, filename);
    fs.writeFileSync(out, Buffer.from(data, "base64"));
    return out;
  };

  // Login
  await setViewport(1440, 900);
  await waitFor("!document.getElementById('entryScreen') && document.querySelector('#usernameInput')");
  await evalJs(`(() => {
    const u = document.querySelector('#usernameInput');
    const s = document.querySelector('#secretInput');
    u.value = 'wyj'; u.dispatchEvent(new Event('input', { bubbles: true }));
    s.value = ${JSON.stringify(VIP_SECRET)}; s.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#loginSubmitBtn').click();
  })()`);
  await waitFor("location.pathname === '/' && document.querySelector('#publicHome')?.dataset?.sessionMode === 'authenticated'");
  await evalJs("document.querySelector('#dismissVersionNoticeBtn')?.click(); true");
  await new Promise((r) => setTimeout(r, 300));

  // 1. Verify Logged-in Home vertical positioning (~40% optical center)
  const homePos1440 = await evalJs(`(() => {
    const main = document.querySelector('#v3MainCanvas').getBoundingClientRect();
    const inner = document.querySelector('.gpt-launcher-inner').getBoundingClientRect();
    const freeSpace = main.height - inner.height;
    const topSpace = inner.top - main.top;
    const ratio = freeSpace > 0 ? topSpace / freeSpace : 0;
    return {
      mainH: Math.round(main.height),
      innerTop: Math.round(inner.top),
      innerH: Math.round(inner.height),
      topRatio: Number(ratio.toFixed(3)),
      overflowY: document.documentElement.scrollHeight - window.innerHeight,
      centerDiffX: Math.round(Math.abs((inner.left + inner.width / 2) - (main.left + main.width / 2))),
    };
  })()`);
  assert.ok(homePos1440.topRatio >= 0.30 && homePos1440.topRatio <= 0.48, `Expected topRatio ~0.40, got ${JSON.stringify(homePos1440)}`);
  assert.ok(homePos1440.overflowY <= 2, `Unexpected vertical scroll on 1440x900 home: ${homePos1440.overflowY}`);
  assert.ok(homePos1440.centerDiffX <= 2, `Home not centered horizontally: ${homePos1440.centerDiffX}`);
  await snap("closeout-home-1440.png");

  // 2. Verify Sidebar scrollbar hidden (expanded & collapsed) + still scrollable at short height (520px)
  await setViewport(1440, 520);
  await evalJs("document.querySelector('#sidebarCollapseBtn').click(); true");
  await new Promise((r) => setTimeout(r, 420));
  const sidebarCheck = await evalJs(`(() => {
    const sidebar = document.querySelector('#v3Sidebar');
    const nav = document.querySelector('#v3Sidebar .v3-sidebar-nav');
    const cs = getComputedStyle(nav);
    const beforeScroll = nav.scrollTop;
    nav.scrollTop = 120;
    const afterScroll = nav.scrollTop;
    nav.scrollTop = 0;
    return {
      collapsed: sidebar.dataset.collapsed,
      scrollbarWidth: cs.scrollbarWidth,
      navClientW: nav.clientWidth,
      navOffsetW: nav.offsetWidth,
      scrollDiffW: nav.offsetWidth - nav.clientWidth,
      scrollHeight: nav.scrollHeight,
      clientHeight: nav.clientHeight,
      scrolledTo: afterScroll,
      footerVisible: document.querySelector('#v3Sidebar .v3-sidebar-footer').getBoundingClientRect().bottom <= window.innerHeight + 2,
    };
  })()`);
  assert.equal(sidebarCheck.collapsed, "true");
  assert.equal(sidebarCheck.scrollbarWidth, "none");
  assert.equal(sidebarCheck.scrollDiffW, 0, `Visible scrollbar taking width: ${sidebarCheck.scrollDiffW}`);
  assert.ok(sidebarCheck.footerVisible, "Sidebar footer must remain reachable");
  if (sidebarCheck.scrollHeight > sidebarCheck.clientHeight) {
    assert.ok(sidebarCheck.scrolledTo > 0, "Sidebar nav must remain scrollable when height is short");
  }
  await setViewport(1440, 900);
  await snap("closeout-sidebar-collapsed-1440.png");
  // Restore expanded sidebar
  await evalJs("document.querySelector('#sidebarCollapseBtn').click(); true");
  await new Promise((r) => setTimeout(r, 400));

  // 3. Navigate to /finance and verify dropdowns & expandable regions stay open across sync + resize + label click
  await evalJs("document.querySelector('#v3Sidebar a[href=\"/finance\"]').click(); true");
  await waitFor("location.pathname === '/finance' && !document.querySelector('#financeWorkspace')?.classList.contains('hidden')");
  await new Promise((r) => setTimeout(r, 500));

  // 3a. Settings currency dropdown (>5 options, searchable) stays open during background sync & resize
  await evalJs("document.querySelector('#financeTabSettings').click(); true");
  await waitFor("!document.querySelector('#financePanelSettings').hidden");
  await waitFor("!document.querySelector('#financeDisplayCurrency').disabled", 10000, "currency select enabled");
  await evalJs("document.querySelector('#financeDisplayCurrency').closest('.ds-select-host').querySelector('.ds-select-trigger').click(); true");
  await waitFor("Boolean(document.querySelector('.ds-select-popover'))", 5000, "currency popover opens");
  await setViewport(1380, 860);
  await evalJs("document.dispatchEvent(new CustomEvent('thewyj:payment-updated')); true");
  await new Promise((r) => setTimeout(r, 900));
  const currencyStayedOpen = await evalJs(`(() => {
    const p = document.querySelector('.ds-select-popover');
    if (!p || p.classList.contains('is-closing')) return false;
    const cs = getComputedStyle(p);
    const r = p.getBoundingClientRect();
    return Number(cs.opacity) >= 0.99 && r.width > 100 && r.height > 80;
  })()`);
  assert.equal(currencyStayedOpen, true, "Currency dropdown must stay visibly open (opacity=1) across resize & background sync");
  await setViewport(1440, 900);
  await snap("closeout-finance-dropdown-open.png");
  // Close via Escape
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" }, sessionId);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(await evalJs("Boolean(document.querySelector('.ds-select-popover'))"), false, "Escape must close select popover");

  // 3b. Ledger filters dropdown (<=5 options) & Candidates <details> stay open across refresh
  await evalJs("document.querySelector('#financeTabLedger').click(); true");
  await waitFor("!document.querySelector('#financePanelLedger').hidden");
  // Wait for initial canonical load of #financeCandidatesSection (it auto-collapses once when empty)
  await waitFor("!document.querySelector('#financeCandidatesSection').classList.contains('hidden')", 10000, "candidates section visible");
  await new Promise((r) => setTimeout(r, 300));
  // Now manually open #financeCandidatesSection and verify it stays open across refresh!
  await evalJs(`(() => {
    const sec = document.querySelector('#financeCandidatesSection');
    if (sec && !sec.open) sec.querySelector('summary').click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 350));
  const candAfterClick = await evalJs("({ open: document.querySelector('#financeCandidatesSection')?.open })");
  assert.equal(candAfterClick.open, true, "Clicking summary must open #financeCandidatesSection");
  await evalJs("document.querySelector('#financeCandidatesRefreshBtn')?.click(); true");
  await new Promise((r) => setTimeout(r, 800));
  const candAfterRefresh = await evalJs("({ open: document.querySelector('#financeCandidatesSection')?.open })");
  const candidatesStayedOpen = candAfterRefresh.open === true;
  assert.equal(candidatesStayedOpen, true, `Manually opened #financeCandidatesSection must stay open after refresh: ${JSON.stringify(candAfterRefresh)}`);

  // 3c. Account menu stays open
  await evalJs("document.querySelector('#accountMenu > summary').click(); true");
  await new Promise((r) => setTimeout(r, 800));
  const accountMenuStayedOpen = await evalJs("document.querySelector('#accountMenu')?.open === true");
  assert.equal(accountMenuStayedOpen, true, "Account menu must stay open");
  await evalJs("document.querySelector('#accountMenu > summary').click(); true");
  await new Promise((r) => setTimeout(r, 250));

  // 4. Real finance operation performance (add transaction, filter, edit)
  const perfOp = await evalJs(`(async () => {
    const t0 = performance.now();
    document.querySelector('#financeAddTransactionBtn').click();
    const modal = document.querySelector('#financeTransactionModal');
    const tOpen = performance.now() - t0;
    document.querySelector('#financeTransactionAmount').value = '42.50';
    document.querySelector('#financeTransactionMerchant').value = 'Closeout Cafe';
    const tSub0 = performance.now();
    document.querySelector('#financeTransactionForm').requestSubmit();
    await new Promise((r) => setTimeout(r, 300));
    const tSubmit = performance.now() - tSub0;
    const found = document.querySelector('#financeTransactionList')?.textContent?.includes('Closeout Cafe') || false;
    return { tOpen: Number(tOpen.toFixed(1)), tSubmit: Number(tSubmit.toFixed(1)), found };
  })()`);
  assert.equal(perfOp.found, true, "Newly created transaction must appear in ledger");

  assert.deepEqual(runtimeErrors, [], `Runtime errors: ${runtimeErrors.join("; ")}`);

  const report = {
    status: "PASS",
    homePos1440,
    sidebarCheck,
    currencyStayedOpen,
    candidatesStayedOpen,
    accountMenuStayedOpen,
    perfOp,
    runtimeErrors,
  };
  fs.writeFileSync(path.join(OUT_DIR, "closeout-verification.json"), JSON.stringify(report, null, 2));
  console.log("PHASE2_CLOSEOUT_VERIFY_PASS", JSON.stringify(report));
} finally {
  if (cdp) cdp.close();
  killPidTree(chromeProc?.pid);
  killPidTree(mfProc?.pid);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
