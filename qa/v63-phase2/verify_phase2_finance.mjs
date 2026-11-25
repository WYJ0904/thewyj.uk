import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "docs/ui-rebuild/v63-phase2-finance/evidence/after");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PORT = 8799;
const CDP_PORT = 9234;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PEPPER = "v63-phase2-local-test-pepper-2026";
const VIP_SECRET = "Phase2FinVip#2026!";
const FREE_SECRET = "Phase2FinFree#2026!";

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeris-v63-p2-"));
const stateDir = path.join(tmpDir, "mf-state");
const chromeDir = path.join(tmpDir, "chrome-profile");
const framesDir = path.join(tmpDir, "frames");
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(chromeDir, { recursive: true });
fs.mkdirSync(framesDir, { recursive: true });

let mfProc = null;
let chromeProc = null;
let cdp = null;

try {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const mig = spawnSync(
      process.execPath,
      [path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"), "d1", "migrations", "apply", "WYJ_DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", stateDir],
      { cwd: ROOT, stdio: "pipe", encoding: "utf8", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
    );
    if (mig.status === 0) break;
    await new Promise((r) => setTimeout(r, 600));
  }

  const now = new Date().toISOString();
  const vipHash = await hashSecret(VIP_SECRET, PEPPER);
  const freeHash = await hashSecret(FREE_SECRET, PEPPER);
  const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
  const sqlPath = path.join(tmpDir, "seed.sql");
  fs.writeFileSync(sqlPath, [
    `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p2-admin-1', 'wyj', 'wyj', ${q(vipHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});`,
    `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p2-free-1', 'p2_free', 'p2_free', ${q(freeHash)}, 'pbkdf2_sha256', 310000, 'user', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});`,
    `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p2-vip-1', 'p2_vip', 'p2_vip', ${q(vipHash)}, 'pbkdf2_sha256', 310000, 'user', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});`,
    `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('p2-vip-1', 'finance_access', 1, 'phase2 verify', 'wyj', ${q(now)});`,
    `INSERT INTO task13_user_entitlement_overrides (user_id, entitlement_code, allowed, note, updated_by, updated_at) VALUES ('p2-vip-1', 'tools_access', 1, 'phase2 verify', 'wyj', ${q(now)});`,
    `INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id) VALUES ('p07_accessibility', 'Phase 2 verification', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${q(now)}, 'p2-admin-1', 'seed-1', 'seed-1') ON CONFLICT(flag_key) DO UPDATE SET enabled=1, kill_switch=0, channels_json='["stable","beta","experimental"]', rollout_basis_points=10000;`,
  ].join("\n") + "\n", "utf8");
  const seedRes = spawnSync(
    process.execPath,
    [path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"), "d1", "execute", "WYJ_DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", stateDir, "--file", sqlPath],
    { cwd: ROOT, stdio: "pipe", encoding: "utf8", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  assert.equal(seedRes.status, 0, seedRes.stderr);

  mfProc = spawn(
    process.execPath,
    [
      path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"),
      "pages", "dev", path.join(ROOT, ".wrangler/pages-output"),
      "--ip", "127.0.0.1", "--port", String(PORT),
      "--persist-to", stateDir, "--d1", "WYJ_DB", "--r2", "WYJ_STORAGE",
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
    ],
    { cwd: ROOT, stdio: "ignore", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  await waitForHttp(`${BASE_URL}/api/status?source=cloud`, 45000);

  chromeProc = spawn(findChrome(), [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${chromeDir}`, "--window-size=1440,900", "about:blank",
  ], { cwd: ROOT, stdio: "ignore", windowsHide: true });

  const versionJson = JSON.parse(await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 25000));
  cdp = new CdpSession(versionJson.webSocketDebuggerUrl);
  await cdp.open();

  const { browserContextId } = await cdp.send("Target.createBrowserContext", {});
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p = {}) => cdp.send(m, p, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const waitFor = async (expr, timeoutMs = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const ok = await evalJs(`Boolean(${expr})`).catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 60));
    }
    const diag = await evalJs(`(() => ({ path: location.pathname, finPageCls: document.getElementById("financePage")?.className, finLockedCls: document.getElementById("financeLocked")?.className, finWsCls: document.getElementById("financeWorkspace")?.className, finMsg: document.getElementById("financeMessage")?.textContent, bodyCls: document.body.className, errs: ${JSON.stringify(runtimeErrors)} }))()`).catch(() => ({}));
    throw new Error(`waitFor timeout: ${expr}; diag=${JSON.stringify(diag)}`);
  };
  const shot = async (name, full = true) => {
    await new Promise((r) => setTimeout(r, 280));
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(data, "base64"));
  };

  let frameCounter = 0;
  let recordingFrames = false;
  const capturedFrames = [];
  cdp.on("Page.screencastFrame", (params) => {
    if (recordingFrames) {
      const filename = `frame_${String(++frameCounter).padStart(4, "0")}.png`;
      fs.writeFileSync(path.join(framesDir, filename), Buffer.from(params.data, "base64"));
      capturedFrames.push({ file: filename, ts: Number(params.metadata?.timestamp) || Date.now() / 1000 });
    }
    void send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
  });

  const runtimeErrors = [];
  cdp.on("Runtime.exceptionThrown", (p) => runtimeErrors.push(p.exceptionDetails?.text || "exception"));

  const report = { checks: [], viewports: [], perf: {}, runtime_errors: runtimeErrors };

  // 1. Verify Free user sees locked Finance view cleanly
  await send("Page.navigate", { url: `${BASE_URL}/login` });
  await waitFor(`document?.documentElement?.dataset?.bootState === "ready" && !document.getElementById("authPanel")?.classList.contains("hidden")`);
  await evalJs(`(() => {
    localStorage.setItem("wyj_theme_preference_v1", "light");
    document.getElementById("usernameInput").value = "p2_free";
    document.getElementById("secretInput").value = ${JSON.stringify(FREE_SECRET)};
    document.getElementById("loginForm").requestSubmit();
  })()`);
  await waitFor(`document.body.classList.contains("is-authenticated") && document.documentElement.dataset.p07Ui === "enabled" && document.documentElement.dataset.workspaceMount !== "pending"`);
  await new Promise((r) => setTimeout(r, 300));
  await evalJs(`document.querySelector('#v3Sidebar a[data-v3-nav="finance"]').click()`);
  await waitFor(`!document.getElementById("financeLocked")?.classList.contains("hidden")`);
  assert.equal(await evalJs(`document.getElementById("financeWorkspace").classList.contains("hidden")`), true);
  report.checks.push({ id: "free_membership_gate", status: "PASS" });

  // Logout cleanly
  await evalJs(`document.querySelector("#accountMenu summary").click()`);
  await waitFor(`document.getElementById("accountMenu").open`);
  await evalJs(`document.getElementById("logoutBtn").click()`);
  await waitFor(`!document.body.classList.contains("is-authenticated")`);

  // 2. Login as VIP and enter /finance (verify <1s interaction & empty state first)
  await evalJs(`document.getElementById("navLoginBtn").click()`);
  await waitFor(`!document.getElementById("authPanel")?.classList.contains("hidden")`);
  await evalJs(`(() => {
    document.getElementById("usernameInput").value = "p2_vip";
    document.getElementById("secretInput").value = ${JSON.stringify(VIP_SECRET)};
    document.getElementById("loginForm").requestSubmit();
  })()`);
  await waitFor(`document.body.classList.contains("is-authenticated") && document.documentElement.dataset.p07Ui === "enabled"`);
  await new Promise((r) => setTimeout(r, 400));

  const tNav0 = performance.now();
  await evalJs(`document.querySelector('#v3Sidebar a[data-v3-nav="finance"]').click()`);
  await waitFor(`!document.getElementById("financeWorkspace")?.classList.contains("hidden") && !document.getElementById("financeAddTransactionBtn")?.disabled`);
  const navInteractiveMs = +(performance.now() - tNav0).toFixed(1);
  assert.ok(navInteractiveMs < 1000, `Finance route interactive exceeded 1s: ${navInteractiveMs}ms`);
  report.perf.finance_route_interactive_ms = navInteractiveMs;
  assert.equal(await evalJs(`document.getElementById("financeWorkspace").dataset.financeActiveTab`), "overview");
  await shot("after-finance-empty-1440.png");

  // 3. Create Categories, Budgets & Multi-Month Transactions across 6 months + verify stuck sync banner fix!
  await evalJs(`document.getElementById("financeTabAnalytics").click()`);
  await waitFor(`document.getElementById("financeWorkspace").dataset.financeActiveTab === "analytics"`);
  await evalJs(`document.getElementById("financeManageCategoriesBtn").click()`);
  await waitFor(`!document.getElementById("financeCategoryModal").classList.contains("hidden")`);
  for (const [name, applies, color] of [["薪资收入", "income", "#166e46"], ["餐饮日常", "expense", "#2d5a9e"], ["居住房租", "expense", "#8c5206"], ["差旅出行", "expense", "#7c5fa8"], ["数码办公", "expense", "#2b7a78"]]) {
    await evalJs(`(() => {
      document.getElementById("financeCategoryName").value = ${JSON.stringify(name)};
      document.getElementById("financeCategoryAppliesTo").value = ${JSON.stringify(applies)};
      document.getElementById("financeCategoryColor").value = ${JSON.stringify(color)};
      document.getElementById("financeCategoryForm").requestSubmit();
    })()`);
    await new Promise((r) => setTimeout(r, 120));
  }
  await evalJs(`document.querySelector('[data-finance-close="financeCategoryModal"]').click()`);
  await waitFor(`document.getElementById("financeCategoryModal").classList.contains("hidden")`);

  const catIds = await evalJs(`(() => {
    const map = {};
    for (const opt of document.querySelectorAll("#financeCategoryFilter option")) {
      if (opt.value) map[opt.textContent.trim()] = opt.value;
    }
    return map;
  })()`);

  // Set Monthly Budget
  await evalJs(`document.getElementById("financeManageBudgetsBtn").click()`);
  await waitFor(`!document.getElementById("financeBudgetModal").classList.contains("hidden")`);
  await evalJs(`(() => {
    document.getElementById("financeBudgetAmount").value = "12000.00";
    document.getElementById("financeBudgetCategory").value = "";
    document.getElementById("financeBudgetForm").requestSubmit();
  })()`);
  await new Promise((r) => setTimeout(r, 150));
  await evalJs(`(() => {
    document.getElementById("financeBudgetAmount").value = "4000.00";
    document.getElementById("financeBudgetCategory").value = ${JSON.stringify(catIds["餐饮日常"] || "")};
    document.getElementById("financeBudgetForm").requestSubmit();
  })()`);
  await new Promise((r) => setTimeout(r, 150));
  await evalJs(`document.querySelector('[data-finance-close="financeBudgetModal"]').click()`);

  // Switch back to Overview and add 6 months of realistic synthetic entries
  await evalJs(`document.getElementById("financeTabOverview").click()`);
  const nowDate = new Date();
  const monthStr = (offset) => {
    const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - offset, 12);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const seedTxs = [
    { dir: "income", amt: "19500.00", time: `${monthStr(5)}-10T10:00`, cat: "薪资收入", merchant: "月度薪资发放", note: "基础工资" },
    { dir: "expense", amt: "4200.00", time: `${monthStr(5)}-12T12:00`, cat: "居住房租", merchant: "长租公寓月付", note: "房租水电" },
    { dir: "expense", amt: "2150.00", time: `${monthStr(5)}-20T18:30`, cat: "餐饮日常", merchant: "生鲜超市与食堂", note: "月度餐饮" },
    { dir: "income", amt: "19500.00", time: `${monthStr(4)}-10T10:00`, cat: "薪资收入", merchant: "月度薪资发放", note: "基础工资" },
    { dir: "expense", amt: "4200.00", time: `${monthStr(4)}-12T12:00`, cat: "居住房租", merchant: "长租公寓月付", note: "房租水电" },
    { dir: "expense", amt: "3400.00", time: `${monthStr(4)}-18T14:20`, cat: "差旅出行", merchant: "铁路与住宿", note: "异地出差" },
    { dir: "income", amt: "22000.00", time: `${monthStr(3)}-10T10:00`, cat: "薪资收入", merchant: "薪资与季度奖", note: "含绩效" },
    { dir: "expense", amt: "6850.00", time: `${monthStr(3)}-21T16:10`, cat: "数码办公", merchant: "显示器与键盘", note: "桌面升级" },
    { dir: "income", amt: "19800.00", time: `${monthStr(2)}-10T10:00`, cat: "薪资收入", merchant: "月度薪资发放", note: "薪资" },
    { dir: "expense", amt: "4200.00", time: `${monthStr(2)}-12T12:00`, cat: "居住房租", merchant: "长租公寓月付", note: "房租" },
    { dir: "expense", amt: "2890.00", time: `${monthStr(2)}-22T19:00`, cat: "餐饮日常", merchant: "日常采购聚餐", note: "餐饮" },
    { dir: "income", amt: "20500.00", time: `${monthStr(1)}-10T10:00`, cat: "薪资收入", merchant: "月度薪资发放", note: "薪资" },
    { dir: "expense", amt: "4200.00", time: `${monthStr(1)}-12T12:00`, cat: "居住房租", merchant: "长租公寓月付", note: "房租" },
    { dir: "expense", amt: "3650.00", time: `${monthStr(1)}-24T13:15`, cat: "差旅出行", merchant: "航班与高铁", note: "技术大会" },
    { dir: "income", amt: "21800.00", time: `${monthStr(0)}-05T09:30`, cat: "薪资收入", merchant: "本月薪资入账", note: "本月工资" },
    { dir: "expense", amt: "4200.00", time: `${monthStr(0)}-06T12:00`, cat: "居住房租", merchant: "长租公寓月付", note: "本月房租" },
    { dir: "expense", amt: "1860.00", time: `${monthStr(0)}-08T18:20`, cat: "餐饮日常", merchant: "日常餐饮采购", note: "生鲜食材" },
    { dir: "expense", amt: "1240.00", time: `${monthStr(0)}-11T15:10`, cat: "数码办公", merchant: "云存储与外设", note: "年度工具" },
    { dir: "refund", amt: "180.00", time: `${monthStr(0)}-12T10:15`, cat: "餐饮日常", merchant: "超市退货退款", note: "生鲜差价退回" },
  ];
  for (const tx of seedTxs) {
    await evalJs(`(() => {
      document.getElementById("financeAddTransactionBtn").click();
      const setV = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); };
      setV("financeTransactionDirection", ${JSON.stringify(tx.dir)});
      setV("financeTransactionAmount", ${JSON.stringify(tx.amt)});
      setV("financeTransactionTime", ${JSON.stringify(tx.time)});
      setV("financeTransactionCategory", ${JSON.stringify(catIds[tx.cat] || "")});
      setV("financeTransactionMerchant", ${JSON.stringify(tx.merchant)});
      setV("financeTransactionNote", ${JSON.stringify(tx.note)});
      document.getElementById("financeTransactionForm").requestSubmit();
    })()`);
    await waitFor(`document.getElementById("financeTransactionModal").classList.contains("hidden")`);
  }
  await waitFor(`document.getElementById("financeSyncStatus").textContent === "已同步"`);
  // Wait >3s to confirm stale "正在同步" message auto-clears!
  await new Promise((r) => setTimeout(r, 3200));
  const msgHidden = await evalJs(`document.getElementById("financeMessage").hidden === true && document.getElementById("financeMessage").textContent === ""`);
  assert.equal(msgHidden, true, "Stale '正在同步' message must auto-dismiss after cloud sync succeeds");
  report.checks.push({ id: "sync_message_auto_clear", status: "PASS" });

  // Start 1.0x Walkthrough Video Capture!
  recordingFrames = true;
  await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });

  // 4. Verify Overview & Trend Chart Geometry + Interactivity
  const chartGeom1440 = await evalJs(`(() => {
    const wrap = document.getElementById("financeTrendChartWrap");
    const svg = wrap.querySelector(".finance-chart-svg");
    const wr = wrap.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    return { wrapW: Math.round(wr.width), svgW: Math.round(sr.width), svgH: Math.round(sr.height), ratio: +(sr.width / wr.width).toFixed(3), months: wrap.querySelectorAll(".finance-trend-month-grid > *").length };
  })()`);
  assert.ok(chartGeom1440.ratio >= 0.92, `Trend SVG must use full container width: ${JSON.stringify(chartGeom1440)}`);
  assert.ok(chartGeom1440.svgH >= 200, `Trend SVG height must be >= 200px: ${JSON.stringify(chartGeom1440)}`);
  assert.equal(chartGeom1440.months, 6);

  // Interactive tooltip focus/hover test + time-range toggle
  await evalJs(`document.querySelector('.finance-chart-band[data-trend-idx="5"]').dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }))`);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await evalJs(`document.getElementById("financeChartTooltip").classList.contains("hidden")`), false);
  await shot("after-finance-overview-1440.png");
  await evalJs(`document.querySelector('[data-finance-trend-range="12"]').click()`);
  await waitFor(`document.querySelectorAll(".finance-trend-month-grid > *").length === 12`);
  await evalJs(`document.querySelector('[data-finance-trend-range="6"]').click()`);
  await waitFor(`document.querySelectorAll(".finance-trend-month-grid > *").length === 6`);

  // Verify Chart auto-expands cleanly on Sidebar collapse!
  await evalJs(`document.getElementById("sidebarCollapseBtn").click()`);
  await new Promise((r) => setTimeout(r, 420));
  const chartGeomCollapsed = await evalJs(`Math.round(document.querySelector(".finance-chart-svg").getBoundingClientRect().width)`);
  assert.ok(chartGeomCollapsed > chartGeom1440.svgW + 140, `Chart width must expand when sidebar collapses: before=${chartGeom1440.svgW}, after=${chartGeomCollapsed}`);
  await evalJs(`document.getElementById("sidebarCollapseBtn").click()`);
  await new Promise((r) => setTimeout(r, 420));
  report.checks.push({ id: "trend_chart_full_width_and_resize", status: "PASS", expandedW: chartGeom1440.svgW, collapsedW: chartGeomCollapsed });

  // 5. Verify Secondary Tabs, Ledger Table, Drawer Edit, Analytics, Settings, Privacy & Strategy C
  await evalJs(`document.getElementById("financeTabLedger").click()`);
  await waitFor(`document.getElementById("financeWorkspace").dataset.financeActiveTab === "ledger"`);
  await new Promise((r) => setTimeout(r, 250));
  await shot("after-finance-ledger-1440.png");

  // Open Drawer from row click
  await evalJs(`document.querySelector('#financeTransactionList [data-finance-transaction]').click()`);
  await waitFor(`!document.getElementById("financeTransactionModal").classList.contains("hidden")`);
  await shot("after-finance-drawer-1440.png");
  await evalJs(`document.querySelector('[data-finance-close="financeTransactionModal"]').click()`);
  await waitFor(`document.getElementById("financeTransactionModal").classList.contains("hidden")`);

  await evalJs(`document.getElementById("financeTabAnalytics").click()`);
  await waitFor(`document.getElementById("financeWorkspace").dataset.financeActiveTab === "analytics"`);
  await new Promise((r) => setTimeout(r, 250));
  await shot("after-finance-analytics-1440.png");

  await evalJs(`document.getElementById("financeTabSettings").click()`);
  await waitFor(`document.getElementById("financeWorkspace").dataset.financeActiveTab === "settings"`);
  await new Promise((r) => setTimeout(r, 250));
  await shot("after-finance-settings-1440.png");

  // Strategy C Back/Forward check: navigate to /tools, go back -> restores Settings subview; click sidebar Finance -> resets to Overview!
  await evalJs(`document.querySelector('#v3Sidebar a[data-v3-nav="tools"]').click()`);
  await waitFor(`!document.getElementById("toolsPanel")?.classList.contains("hidden")`);
  await evalJs(`history.back()`);
  await waitFor(`location.pathname === "/finance" && document.getElementById("financeWorkspace").dataset.financeActiveTab === "settings"`);
  await evalJs(`document.querySelector('#v3Sidebar a[data-v3-nav="finance"]').click()`);
  await waitFor(`document.getElementById("financeWorkspace").dataset.financeActiveTab === "overview"`);
  await waitFor(`document.getElementById("financeSyncStatus").textContent === "已同步"`);
  report.checks.push({ id: "subnav_and_strategy_c", status: "PASS" });

  // Dark theme Overview + Ledger
  await evalJs(`while (document.documentElement.dataset.theme !== "dark") { document.getElementById("themeToggleBtn").click(); }`);
  await waitFor(`!document.documentElement.dataset.themeSwitching`);
  await new Promise((r) => setTimeout(r, 200));
  const sbExpandedOverview = await evalJs(`Math.round(document.getElementById("v3Sidebar").getBoundingClientRect().width)`);
  assert.equal(sbExpandedOverview, 256, `Sidebar must remain 256px on dark overview, got ${sbExpandedOverview}`);
  await shot("after-finance-overview-dark-1440.png");
  await evalJs(`document.getElementById("financeTabLedger").click()`);
  await waitFor(`document.getElementById("financeWorkspace").dataset.financeActiveTab === "ledger"`);
  await new Promise((r) => setTimeout(r, 250));
  const sbExpandedLedger = await evalJs(`Math.round(document.getElementById("v3Sidebar").getBoundingClientRect().width)`);
  assert.equal(sbExpandedLedger, 256, `Sidebar must remain 256px on dark ledger, got ${sbExpandedLedger}`);
  await shot("after-finance-ledger-dark-1440.png");
  await evalJs(`while (document.documentElement.dataset.theme !== "light") { document.getElementById("themeToggleBtn").click(); }`);
  await waitFor(`!document.documentElement.dataset.themeSwitching`);
  await evalJs(`document.getElementById("financeTabOverview").click()`);

  // Stop screencast before responsive viewport sweep
  await send("Page.stopScreencast");
  recordingFrames = false;

  // 6. Responsive Viewport Sweep (375, 390, 768, 1440, 1920, 2560, 3440)
  for (const [w, h, mobile] of [[375, 812, true], [390, 844, true], [768, 1024, false], [1440, 900, false], [1920, 1080, false], [2560, 1440, false], [3440, 1440, false]]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await new Promise((r) => setTimeout(r, 320));
    const m = await evalJs(`(() => ({
      w: document.documentElement.clientWidth,
      scrollW: document.documentElement.scrollWidth,
      svgW: Math.round(document.querySelector(".finance-chart-svg")?.getBoundingClientRect().width || 0),
      wrapW: Math.round(document.getElementById("financeTrendChartWrap")?.getBoundingClientRect().width || 0),
    }))()`);
    assert.ok(m.scrollW <= m.w + 1, `Horizontal overflow at ${w}px: ${JSON.stringify(m)}`);
    report.viewports.push({ width: w, ...m });
    if (w === 390) await shot("after-finance-390.png");
    if (w === 2560) await shot("after-finance-2560.png");
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Assemble 1.0x MP4 walkthrough
  if (capturedFrames.length >= 2) {
    const concatLines = ["ffconcat version 1.0"];
    for (let i = 0; i < capturedFrames.length; i++) {
      concatLines.push(`file '${capturedFrames[i].file}'`);
      if (i < capturedFrames.length - 1) {
        const dt = Math.max(0.016, Math.min(0.5, capturedFrames[i + 1].ts - capturedFrames[i].ts));
        concatLines.push(`duration ${dt.toFixed(4)}`);
      }
    }
    concatLines.push(`file '${capturedFrames[capturedFrames.length - 1].file}'`);
    fs.writeFileSync(path.join(framesDir, "frames.ffconcat"), concatLines.join("\n"));
    const videoOut = path.join(OUT_DIR, "phase2-finance-walkthrough.mp4");
    const ff = spawnSync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", "frames.ffconcat",
      "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoOut,
    ], { cwd: framesDir, stdio: "pipe", windowsHide: true });
    assert.equal(ff.status, 0, `ffmpeg failed: ${ff.stderr?.toString()}`);
    report.screencast_frames = capturedFrames.length;
    report.screencast_path = path.relative(ROOT, videoOut).replaceAll("\\", "/");
  }

  assert.equal(runtimeErrors.length, 0, `Runtime errors: ${JSON.stringify(runtimeErrors)}`);
  fs.writeFileSync(path.join(OUT_DIR, "phase2-verification.json"), JSON.stringify(report, null, 2));
  console.log("PHASE2_FINANCE_PASS", JSON.stringify({
    checks: report.checks.length,
    viewports: report.viewports.length,
    perf_ms: report.perf.finance_route_interactive_ms,
    screencast_frames: report.screencast_frames,
    runtime_errors: runtimeErrors.length,
  }));
} finally {
  if (cdp) cdp.close();
  if (chromeProc?.pid) killPidTree(chromeProc.pid);
  if (mfProc?.pid) killPidTree(mfProc.pid);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
