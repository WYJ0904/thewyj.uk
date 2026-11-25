import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "docs/ui-rebuild/v63-phase3-tools/evidence/after");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PORT = 8803;
const CDP_PORT = 9239;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PEPPER = "v63-phase3-tools-local-test-pepper-2026";
const VIP_SECRET = "Phase3ToolsVip#2026!";

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeris-v63-p3-"));
const stateDir = path.join(tmpDir, "mf-state");
const chromeDir = path.join(tmpDir, "chrome-profile");
const framesDir = path.join(tmpDir, "frames");
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(chromeDir, { recursive: true });
fs.mkdirSync(framesDir, { recursive: true });

const localWranglerJs = path.join(ROOT, "node_modules/wrangler/bin/wrangler.js");
const hasLocalWrangler = fs.existsSync(localWranglerJs);
function wranglerCmd(args) {
  return hasLocalWrangler
    ? { cmd: process.execPath, args: [localWranglerJs, ...args], shell: false }
    : { cmd: "wrangler", args, shell: process.platform === "win32" };
}

let mfProc = null;
let chromeProc = null;
let cdp = null;

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
    `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at) VALUES ('p3-admin-1', 'wyj', 'wyj', ${q(vipHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});`,
    `INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id) VALUES ('p07_accessibility', 'Phase 3 tools verification', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${q(now)}, 'p3-admin-1', 'seed-1', 'seed-1') ON CONFLICT(flag_key) DO UPDATE SET enabled=1, kill_switch=0, channels_json='["stable","beta","experimental"]', rollout_basis_points=10000;`,
  ].join("\n") + "\n");
  const ws = wranglerCmd(["d1", "execute", "WYJ_DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", stateDir, "--file", sqlPath]);
  const seedRes = spawnSync(ws.cmd, ws.args, { cwd: ROOT, shell: ws.shell, stdio: "pipe", encoding: "utf8", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  assert.equal(seedRes.status, 0, seedRes.stderr || seedRes.stdout);

  const wd = wranglerCmd([
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
    "--binding", "TASK14_CLOUD_READS_ENABLED=true",
    "--binding", "TASK14_CLOUD_WRITES_ENABLED=true",
    "--binding", "TASK15_CLOUD_READS_ENABLED=true",
    "--binding", "TASK15_CLOUD_WRITES_ENABLED=true",
    "--binding", "TASK16_CLOUD_READS_ENABLED=true",
    "--binding", "TASK16_CLOUD_WRITES_ENABLED=true",
    "--binding", "TASK21_NOTIFICATION_READS_ENABLED=true",
    "--binding", "TASK25_FEATURE_FLAGS_ENABLED=true",
    "--binding", "TASK29_BACKUP_RESTORE_ENABLED=true",
    "--binding", "LEGACY_API_FALLBACK_ENABLED=false",
    "--binding", `WYJ_TASK12_PASSWORD_PEPPER=${PEPPER}`,
  ]);
  mfProc = spawn(wd.cmd, wd.args, { cwd: ROOT, shell: wd.shell, stdio: "pipe", windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  await waitForHttp(`${BASE_URL}/api/status?source=cloud`, 45000);

  chromeProc = spawn(findChrome(), [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${chromeDir}`, "--window-size=1440,900", "about:blank",
  ], { cwd: ROOT, stdio: "ignore", windowsHide: true });

  const versionJson = JSON.parse(await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`, 25000));
  cdp = new CdpSession(versionJson.webSocketDebuggerUrl);
  await cdp.open();

  const { targetId } = await cdp.send("Target.createTarget", { url: `${BASE_URL}/login` });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p = {}) => cdp.send(m, p, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");

  const runtimeErrors = [];
  cdp.on("Runtime.exceptionThrown", (p) => {
    runtimeErrors.push(p?.exceptionDetails?.text || JSON.stringify(p));
  });

  const evalJs = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(`JS error: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ""}`);
    return res.result?.value;
  };
  const waitFor = async (expr, timeoutMs = 25000, label = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await evalJs(`Boolean(${expr})`)) return true;
      await new Promise((r) => setTimeout(r, 80));
    }
    throw new Error(`Timeout waiting for: ${label}`);
  };
  const setViewport = async (width, height, mobile = false) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await new Promise((r) => setTimeout(r, 150));
  };
  const snap = async (filename) => {
    await new Promise((r) => setTimeout(r, 120));
    const { data } = await send("Page.captureScreenshot", { format: "png" });
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

  // Navigate to /tools and measure interactive latency
  const tTools0 = Date.now();
  await evalJs("document.querySelector('#v3Sidebar a[href=\"/tools\"]').click(); true");
  await waitFor("location.pathname === '/tools' && document.querySelectorAll('#toolCatalog [data-tool-card]').length >= 24");
  const toolsOpenMs = Date.now() - tTools0;
  await new Promise((r) => setTimeout(r, 300));

  // Verify catalog counts & no second sidebar
  const catalogAudit = await evalJs(`(() => ({
    totalRegistered: window.WYJTools.tools.length,
    visibleCatalog: window.WYJTools.catalogTools.length,
    renderedInitial: document.querySelectorAll('#toolCatalog [data-tool-card]').length,
    categoryPills: document.querySelectorAll('#toolCategoryList [data-tool-category]').length,
    hasSecondSidebar: Boolean(document.querySelector('.tools-index-rail')),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  assert.equal(catalogAudit.totalRegistered, 104);
  assert.equal(catalogAudit.visibleCatalog, 103);
  assert.equal(catalogAudit.categoryPills, 6);
  assert.equal(catalogAudit.hasSecondSidebar, false);
  assert.ok(catalogAudit.overflowX <= 1, `Desktop overflowX: ${catalogAudit.overflowX}`);
  await snap("after-tools-home-1440.png");

  // Start real-speed 1.0x screencast for walkthrough video
  const frames = [];
  let frameIdx = 0;
  const videoStart = Date.now();
  cdp.on("Page.screencastFrame", async (p) => {
    const idx = ++frameIdx;
    const fp = path.join(framesDir, `f-${String(idx).padStart(5, "0")}.jpg`);
    fs.writeFileSync(fp, Buffer.from(p.data, "base64"));
    frames.push({ fp, ts: p.metadata?.timestamp || (Date.now() / 1000) });
    send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  });
  await send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });

  // Search "JSON"
  const tSearch0 = Date.now();
  await evalJs(`(() => {
    const inp = document.querySelector('#toolSearchInput');
    inp.focus(); inp.value = 'JSON';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor("document.querySelector('#toolCatalogTitle').textContent === '搜索结果' && document.querySelectorAll('#toolCatalog [data-tool-card]').length > 0");
  const searchMs = Date.now() - tSearch0;
  await new Promise((r) => setTimeout(r, 450));
  await snap("after-tools-search-1440.png");

  // Clear search & switch category to Image
  await evalJs("document.querySelector('#toolSearchClearBtn').click(); true");
  await waitFor("document.querySelector('#toolCatalogTitle').textContent === '全部工具'");
  await new Promise((r) => setTimeout(r, 350));
  await evalJs("document.querySelector('#toolCategoryList [data-tool-category=\"image\"]').click(); true");
  await waitFor("document.querySelector('#toolCatalogTitle').textContent.includes('图片')");
  await new Promise((r) => setTimeout(r, 450));
  await snap("after-tools-category-1440.png");

  // Switch back to all, expand catalog if needed, and favorite json-format
  await evalJs("document.querySelector('#toolCategoryList [data-tool-category=\"all\"]').click(); true");
  await waitFor("document.querySelector('#toolCatalogTitle').textContent === '全部工具'");
  await evalJs("if (!document.querySelector('[data-toggle-favorite=\"json-format\"]')) document.querySelector('#toolCatalogMoreBtn')?.click(); true");
  await waitFor("Boolean(document.querySelector('[data-toggle-favorite=\"json-format\"]'))");
  await evalJs("document.querySelector('[data-toggle-favorite=\"json-format\"]').click(); true");
  await waitFor("!document.querySelector('#favoriteToolsSection').classList.contains('hidden')");
  await new Promise((r) => setTimeout(r, 400));

  // Open Split Editor: json-format
  await evalJs("document.querySelector('[data-open-tool=\"json-format\"]').click(); true");
  await waitFor("!document.querySelector('#toolWorkbench').classList.contains('hidden') && document.querySelector('#toolWorkbench').dataset.toolLayout === 'split-editor'");
  await evalJs(`(() => {
    const inp = document.querySelector('#textToolInput');
    inp.value = '{"service":"Aeris","phase":3,"local":true,"tools":103}';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#runTextToolBtn').click();
    return true;
  })()`);
  await waitFor("document.querySelector('#textToolOutput').value.includes('\"phase\": 3')");
  await new Promise((r) => setTimeout(r, 450));
  await snap("after-tools-split-editor-1440.png");
  await evalJs("document.querySelector('#copyTextToolBtn').click(); true");
  await new Promise((r) => setTimeout(r, 350));

  // Return to dashboard -> verify Favorites & Recent shelves are populated!
  await evalJs("document.querySelector('#closeToolWorkbenchBtn').click(); true");
  await waitFor("!document.querySelector('#toolsDashboard').classList.contains('hidden') && !document.querySelector('#recentToolsSection').classList.contains('hidden')");
  await new Promise((r) => setTimeout(r, 450));
  await snap("after-tools-shelves-1440.png");

  // Open Compact Generator: random-password
  await evalJs("window.WYJTools.openTool('random-password', true); true");
  await waitFor("document.querySelector('#toolWorkbench').dataset.toolLayout === 'compact-generator'");
  await evalJs("document.querySelector('#runRandomToolBtn').click(); true");
  await waitFor("document.querySelector('#randomResult').textContent.length >= 16");
  await new Promise((r) => setTimeout(r, 450));
  await snap("after-tools-random-compact-1440.png");

  // Stop screencast and compose 1.0x real-speed video
  await send("Page.stopScreencast");
  const videoDurationSec = (Date.now() - videoStart) / 1000;
  let videoPath = "";
  if (frames.length >= 5) {
    const listFile = path.join(tmpDir, "frames.txt");
    const lines = [];
    for (let i = 0; i < frames.length; i++) {
      const dur = i + 1 < frames.length ? Math.max(0.03, Math.min(1.5, frames[i + 1].ts - frames[i].ts)) : 0.4;
      lines.push(`file '${frames[i].fp.replaceAll("\\", "/")}'`);
      lines.push(`duration ${dur.toFixed(3)}`);
    }
    lines.push(`file '${frames[frames.length - 1].fp.replaceAll("\\", "/")}'`);
    fs.writeFileSync(listFile, lines.join("\n"));
    const mp4Out = path.join(OUT_DIR, "phase3-tools-walkthrough.mp4");
    const ff = spawnSync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      mp4Out,
    ], { stdio: "pipe", windowsHide: true });
    if (ff.status === 0 && fs.existsSync(mp4Out)) videoPath = mp4Out;
  }

  // Open Image Studio: gradient-generator
  await evalJs("window.WYJTools.openTool('gradient-generator', true); true");
  await waitFor("document.querySelector('#toolWorkbench').dataset.toolLayout === 'studio-preview'");
  await evalJs("document.querySelector('#runImageToolBtn').click(); true");
  await waitFor("Boolean(document.querySelector('#imageToolPreview canvas'))");
  await snap("after-tools-image-studio-1440.png");

  // Open QR Studio: temporary-qr
  await evalJs("window.WYJTools.openTool('temporary-qr', true); true");
  await waitFor("document.querySelector('#toolWorkbench').dataset.toolLayout === 'temporary-qr'");
  await evalJs("document.querySelector('#qrText').value = 'https://thewyj.uk/tools'; document.querySelector('#createTempBtn').click(); true");
  await waitFor("Boolean(document.querySelector('#temporaryResult img'))");
  await snap("after-tools-qr-studio-1440.png");

  // Open File Pipeline: file-sha256 with real local file via CDP DOM.setFileInputFiles
  await evalJs("window.WYJTools.openTool('file-sha256', true); true");
  await waitFor("document.querySelector('#toolWorkbench').dataset.toolLayout === 'file-pipeline'");
  const sampleFile = path.join(tmpDir, "aeris-sample.txt");
  fs.writeFileSync(sampleFile, "Aeris V6.3 Phase 3 local file hash test\n");
  const docNode = await send("DOM.getDocument");
  const fileInputNode = await send("DOM.querySelector", { nodeId: docNode.root.nodeId, selector: "#fileToolInput" });
  await send("DOM.setFileInputFiles", { nodeId: fileInputNode.nodeId, files: [sampleFile] });
  await waitFor("!document.querySelector('#fileToolManifest').classList.contains('hidden')");
  await evalJs("document.querySelector('#runFileToolBtn').click(); true");
  await waitFor("document.querySelector('#fileToolResult').textContent.includes('aeris-sample.txt')");
  await snap("after-tools-file-pipeline-1440.png");

  // Dark mode directory
  await evalJs("document.querySelector('#closeToolWorkbenchBtn').click(); true");
  await waitFor("!document.querySelector('#toolsDashboard').classList.contains('hidden')");
  await evalJs("document.documentElement.dataset.theme = 'dark'; true");
  await snap("after-tools-dark-1440.png");
  await evalJs("document.documentElement.dataset.theme = 'light'; true");

  // Mobile 390px directory & split editor
  await setViewport(390, 844, true);
  const mobileDirOverflow = await evalJs("document.documentElement.scrollWidth - window.innerWidth");
  assert.ok(mobileDirOverflow <= 1, `Mobile directory overflowX: ${mobileDirOverflow}`);
  await snap("after-tools-mobile-390.png");

  await evalJs("window.WYJTools.openTool('json-format', true); true");
  await waitFor("!document.querySelector('#toolWorkbench').classList.contains('hidden')");
  const mobileEditorOverflow = await evalJs("document.documentElement.scrollWidth - window.innerWidth");
  assert.ok(mobileEditorOverflow <= 1, `Mobile editor overflowX: ${mobileEditorOverflow}`);
  await snap("after-tools-mobile-editor-390.png");

  assert.deepEqual(runtimeErrors, [], `Runtime errors: ${runtimeErrors.join("; ")}`);

  const report = {
    status: "PASS",
    catalogAudit,
    perf: { toolsOpenMs, searchMs },
    video: { frames: frames.length, durationSec: Number(videoDurationSec.toFixed(2)), path: videoPath ? path.relative(ROOT, videoPath) : "" },
    mobileDirOverflow,
    mobileEditorOverflow,
    runtimeErrors,
  };
  fs.writeFileSync(path.join(OUT_DIR, "phase3-verification.json"), JSON.stringify(report, null, 2));
  console.log("PHASE3_TOOLS_VERIFY_PASS", JSON.stringify(report));
} finally {
  if (cdp) cdp.close();
  killPidTree(chromeProc?.pid);
  killPidTree(mfProc?.pid);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
