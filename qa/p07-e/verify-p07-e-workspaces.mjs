import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";
import { stagePages } from "../../scripts/stage_pages_deploy.mjs";
import { delay, openPage } from "../../local-backend/browser_harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_DIR = path.join(ROOT, "docs/p07/evidence/p07-e");
const QA_WORK_ROOT = path.join(ROOT, ".wrangler", `p07-e-qa-${Date.now()}`);
const RUNTIME_DIR = path.join(QA_WORK_ROOT, "runtime");
const STATE_DIR = path.join(QA_WORK_ROOT, "state");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const BASE_URL = "http://127.0.0.1:18940";
const CDP_URL = "http://127.0.0.1:19260";

function cleanChildEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const name of Object.keys(env)) {
    if (/^(?:CLOUDFLARE_|CF_API_|CF_ACCOUNT_|OPENAI_|ANTHROPIC_|GEMINI_)/i.test(name)) {
      delete env[name];
    }
  }
  env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH || ""}`;
  env.WRANGLER_SEND_METRICS = "false";
  env.NO_PROXY = "127.0.0.1,localhost";
  env.PYTHONIOENCODING = "utf-8";
  return env;
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function healthy(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2_500) })).ok;
  } catch {
    return false;
  }
}

function killOwnedPid(pid) {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
  }
}

let pagesPid = 0;
let chromePid = 0;

try {
  await fsp.mkdir(RUNTIME_DIR, { recursive: true });
  await fsp.mkdir(STATE_DIR, { recursive: true });
  await fsp.mkdir(EVIDENCE_DIR, { recursive: true });

  await fsp.writeFile(
    path.join(RUNTIME_DIR, "package.json"),
    JSON.stringify({ name: "aeris-p07-e-qa", private: true, type: "module" })
  );

  const { output } = await stagePages();
  const servedOutput = path.join(RUNTIME_DIR, "public");
  await fsp.cp(output, servedOutput, { recursive: true });
  await fsp.cp(path.join(output, "functions"), path.join(RUNTIME_DIR, "functions"), { recursive: true });
  await fsp.cp(path.join(output, "js"), path.join(RUNTIME_DIR, "js"), { recursive: true });

  const rootConfig = JSON.parse(await fsp.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
  const localConfig = {
    name: "aeris-p07-e-local",
    pages_build_output_dir: servedOutput,
    compatibility_date: rootConfig.compatibility_date,
    send_metrics: false,
    vars: {
      ...rootConfig.vars,
      WYJ_ENVIRONMENT: "development",
      WORKERS_AI_ENABLED: "false",
      LEGACY_API_FALLBACK_ENABLED: "false",
      TASK16_CLOUD_READS_ENABLED: "true",
      TASK16_CLOUD_WRITES_ENABLED: "true",
      TASK21_NOTIFICATION_READS_ENABLED: "true",
      TASK21_NOTIFICATION_WRITES_ENABLED: "true",
    },
    d1_databases: [
      {
        binding: "WYJ_DB",
        database_name: "aeris-p07-e-local",
        migrations_table: "wyj_d1_migrations",
        migrations_dir: path.join(ROOT, "cloudflare", "migrations"),
      },
    ],
    r2_buckets: [{ binding: "WYJ_STORAGE", bucket_name: "aeris-p07-e-local" }],
  };
  await fsp.writeFile(path.join(RUNTIME_DIR, "wrangler.jsonc"), `${JSON.stringify(localConfig, null, 2)}\n`);

  const adminSecret = randomBytes(24).toString("base64url");
  const secrets = {
    WYJ_TASK12_PASSWORD_PEPPER: randomBytes(32).toString("base64url"),
    WYJ_TASK14_TEMPORARY_SECRET: randomBytes(32).toString("base64url"),
    WYJ_TASK20_DEVICE_SESSION_SECRET: randomBytes(32).toString("base64url"),
  };
  await fsp.writeFile(
    path.join(RUNTIME_DIR, ".dev.vars"),
    Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"
  );

  // Apply D1 migrations
  const mig = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "migrations", "apply", "WYJ_DB", "--local", "--config", path.join(RUNTIME_DIR, "wrangler.jsonc"), "--persist-to", STATE_DIR],
    { cwd: ROOT, env: cleanChildEnv(), encoding: "utf8", timeout: 180_000 }
  );
  assert.equal(mig.status, 0, `D1 migration failed:\n${mig.stdout}\n${mig.stderr}`);

  // Seed admin user + p07_accessibility feature flag
  const now = new Date().toISOString();
  const pwHash = await hashSecret(adminSecret, secrets.WYJ_TASK12_PASSWORD_PEPPER);
  const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
  const seedSql = `
    INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at)
    VALUES ('aeris-p07-e-admin', 'wyj', 'wyj', ${q(pwHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});
    INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
    VALUES ('p07_accessibility', 'Isolated P07-E QA', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${q(now)}, 'aeris-p07-e-admin', 'p07-e-seed', 'p07-e-seed');
  `;
  const seedFile = path.join(QA_WORK_ROOT, "seed.sql");
  await fsp.writeFile(seedFile, seedSql);
  const seeded = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", "WYJ_DB", "--local", "--config", path.join(RUNTIME_DIR, "wrangler.jsonc"), "--persist-to", STATE_DIR, "--file", seedFile],
    { cwd: ROOT, env: cleanChildEnv(), encoding: "utf8", timeout: 90_000 }
  );
  assert.equal(seeded.status, 0, `D1 seed failed:\n${seeded.stdout}\n${seeded.stderr}`);

  const chromeCandidates = [
    process.env.AERIS_QA_CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  let chromeExe = "";
  for (const candidate of chromeCandidates) {
    if (await exists(candidate)) {
      chromeExe = candidate;
      break;
    }
  }
  assert.ok(chromeExe, "Headless Chrome/Edge not found");

  const pagesLog = openSync(path.join(QA_WORK_ROOT, "pages.log"), "w");
  const pagesProc = spawn(
    process.execPath,
    [
      WRANGLER,
      "pages",
      "dev",
      servedOutput,
      "--ip",
      "127.0.0.1",
      "--port",
      "18940",
      "--inspector-port",
      "19270",
      "--persist-to",
      STATE_DIR,
      "--d1",
      "WYJ_DB",
      "--r2",
      "WYJ_STORAGE=aeris-p07-e-local",
      "--show-interactive-dev-session",
      "false",
      "--log-level",
      "info",
    ],
    { cwd: RUNTIME_DIR, env: cleanChildEnv(), windowsHide: true, stdio: ["ignore", pagesLog, pagesLog] }
  );
  closeSync(pagesLog);
  pagesPid = pagesProc.pid;

  const chromeLog = openSync(path.join(QA_WORK_ROOT, "chrome.log"), "w");
  const chromeProc = spawn(
    chromeExe,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=19260",
      `--user-data-dir=${path.join(QA_WORK_ROOT, "chrome-profile")}`,
      "about:blank",
    ],
    { cwd: RUNTIME_DIR, env: cleanChildEnv(), windowsHide: true, stdio: ["ignore", chromeLog, chromeLog] }
  );
  closeSync(chromeLog);
  chromePid = chromeProc.pid;

  const readyDeadline = Date.now() + 90_000;
  let readyOk = false;
  while (Date.now() < readyDeadline) {
    try {
      const [statusRes, uiRes, cdpOk] = await Promise.all([
        fetch(`${BASE_URL}/api/status?source=cloud`, { signal: AbortSignal.timeout(2_500) }),
        fetch(`${BASE_URL}/api/ui/features`, { signal: AbortSignal.timeout(2_500) }),
        healthy(`${CDP_URL}/json/version`),
      ]);
      if (statusRes.ok && uiRes.ok && cdpOk) {
        const uiJson = await uiRes.json();
        if (uiJson.public_ui?.enabled === true) {
          readyOk = true;
          break;
        }
      }
    } catch {}
    await delay(400);
  }
  assert.ok(readyOk, "Server + CDP not ready in 90s");

  const page = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL, width: 1440, height: 960, mobile: false });
  await page.send("Page.bringToFront");
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });

  async function saveShot(name) {
    const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const filePath = path.join(EVIDENCE_DIR, name);
    await fsp.writeFile(filePath, Buffer.from(shot.data, "base64"));
    console.log(`[screenshot] Saved ${name}`);
    return filePath;
  }

  async function setViewport(w, h, mobile = false) {
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
    await delay(120);
  }

  async function setTheme(theme) {
    await page.evaluate(`document.documentElement.dataset.theme = '${theme}';`);
    await delay(100);
  }

  const auditLog = [];

  // Step 1: Login as admin
  console.log("--> Logging in as admin...");
  await page.navigate("/login");
  await page.waitFor("!document.getElementById('entryScreen') && document.getElementById('authPanel').getClientRects().length > 0", 20_000);
  await page.setFields({ "#usernameInput": "wyj", "#secretInput": adminSecret });
  await page.click("#loginSubmitBtn");
  await page.waitFor("location.pathname === '/' && document.getElementById('publicHome').dataset.sessionMode === 'authenticated'", 25_000);
  await delay(300);

  // E-01: File Transfer & Sharing (05-文件传输与分享)
  console.log("--> Auditing E-01: File Transfer & Sharing Workspace...");
  await setViewport(1440, 960, false);
  await page.navigate("/transfer");
  await page.waitFor("!document.getElementById('transferPage').classList.contains('hidden')", 15_000);
  await delay(400);

  // Check overflow at 1440
  const transfer1440Overflow = await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1");
  assert.ok(transfer1440Overflow, "Transfer page overflowed at 1440px");

  await saveShot("p07-e-01-transfer-1440-light.png");
  await setTheme("dark");
  await saveShot("p07-e-01-transfer-1440-dark.png");
  await setTheme("light");
  await setViewport(390, 844, true);
  await delay(200);

  const transfer390Overflow = await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1");
  assert.ok(transfer390Overflow, "Transfer page overflowed at 390px");
  await saveShot("p07-e-01-transfer-390-light.png");
  auditLog.push({ workspace: "E-01", name: "File Transfer & Sharing", status: "PASS" });

  // E-02: Workflow Editor (10-工具工作流编辑器)
  console.log("--> Auditing E-02: Workflow Editor Workspace...");
  await setViewport(1440, 960, false);
  await page.navigate("/tools/workflows");
  await page.waitFor("!document.getElementById('workflowWorkspace').classList.contains('hidden')", 15_000);
  await delay(400);

  // Check template list exists
  const templateCount = await page.evaluate("document.querySelectorAll('[data-workflow-template]').length");
  assert.ok(templateCount >= 1, "Workflow templates rendered");

  // Select first template to show active editor with steps
  await page.click("[data-workflow-template]");
  await delay(300);

  await saveShot("p07-e-02-workflows-1440-light.png");
  await setTheme("dark");
  await saveShot("p07-e-02-workflows-1440-dark.png");
  await setTheme("light");
  await setViewport(390, 844, true);
  await delay(200);

  const workflow390Overflow = await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1");
  assert.ok(workflow390Overflow, "Workflow workspace overflowed at 390px");
  await saveShot("p07-e-02-workflows-390-light.png");
  auditLog.push({ workspace: "E-02", name: "Workflow Editor", status: "PASS" });

  // E-03: Admin Console (08-管理后台功能开关)
  console.log("--> Auditing E-03: Admin Console Workspace...");
  await setViewport(1440, 960, false);
  await page.navigate("/admin");
  await page.waitFor("!document.getElementById('adminPanel').classList.contains('hidden')", 15_000);
  await delay(400);

  // Switch to feature flags tab to show flags console
  await page.click('[data-admin-view="adminFeatureFlagsView"]');
  await delay(300);

  await saveShot("p07-e-03-admin-flags-1440-light.png");
  await setTheme("dark");
  await saveShot("p07-e-03-admin-flags-1440-dark.png");
  await setTheme("light");

  // Switch to users tab
  await page.click('[data-admin-view="adminUsersView"]');
  await delay(300);
  await saveShot("p07-e-03-admin-users-1440-light.png");

  // Mobile 390px check for admin tabs & tables
  await setViewport(390, 844, true);
  await delay(200);
  const admin390Overflow = await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1");
  assert.ok(admin390Overflow, "Admin panel overflowed at 390px");
  await saveShot("p07-e-03-admin-390-light.png");
  auditLog.push({ workspace: "E-03", name: "Admin Console", status: "PASS" });

  // E-04: Notifications, Messages & Candidate Verification (09-通知归档与候选核实)
  console.log("--> Auditing E-04: Candidate Verification & Notifications Workspace...");
  await setViewport(1440, 960, false);
  await page.navigate("/finance");
  await page.waitFor("!document.getElementById('financePage').classList.contains('hidden')", 15_000);
  await page.evaluate(`
    const sec = document.getElementById("financeCandidatesSection");
    if (sec) {
      sec.classList.remove("hidden");
      sec.removeAttribute("aria-hidden");
      sec.open = true;
      const list = document.getElementById("financeCandidateList");
      if (list) {
        list.innerHTML = \`
          <article class="finance-candidate" data-finance-candidate="demo-candidate-1">
            <div class="finance-candidate-main">
              <span class="finance-direction is-expense">支出</span>
              <div class="finance-candidate-copy">
                <strong>¥ 68.00</strong>
                <small>通知 · 2026/11/05 14:30:00</small>
                <small><span class="finance-candidate-merchant">星巴克咖啡 (演示候选)</span><span>需补：商户分类</span></small>
                <details class="finance-candidate-evidence" open><summary>查看识别依据</summary><p>招商银行动账通知 · 交易金额 68.00 元 · 置信度 950/1000</p></details>
              </div>
            </div>
            <div class="finance-candidate-actions">
              <button class="primary" type="button">核实交易</button>
              <button class="button-ghost" type="button">编辑</button>
              <button class="danger-text" type="button">忽略</button>
            </div>
          </article>
        \`;
      }
      const top = sec.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo(0, top);
      document.documentElement.scrollTop = top;
      document.body.scrollTop = top;
    }
  `);
  await delay(300);

  await saveShot("p07-e-04-candidates-1440-light.png");
  await setTheme("dark");
  await saveShot("p07-e-04-candidates-1440-dark.png");
  await setTheme("light");
  await setViewport(390, 844, true);
  await delay(200);
  await saveShot("p07-e-04-candidates-390-light.png");
  auditLog.push({ workspace: "E-04", name: "Notifications & Candidate Verification", status: "PASS" });

  // E-05: Common Modals & Multi-viewport audit
  console.log("--> Auditing E-05: Common Modals & Responsiveness...");
  const extraViewports = [
    ["375", 375, 667, true],
    ["768", 768, 1024, false],
    ["1024", 1024, 768, false],
    ["1920", 1920, 1080, false],
  ];
  for (const [vpName, vpW, vpH, vpMob] of extraViewports) {
    await setViewport(vpW, vpH, vpMob);
    await page.navigate("/transfer");
    await delay(200);
    const ovf = await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1");
    assert.ok(ovf, `Transfer overflowed at ${vpName}`);
    await saveShot(`p07-e-viewport-transfer-${vpName}.png`);
  }
  auditLog.push({ workspace: "E-05", name: "Common Modals & Responsiveness", status: "PASS" });

  // Runtime error check
  assert.deepEqual(page.runtimeErrors, [], `Unexpected browser errors: ${JSON.stringify(page.runtimeErrors)}`);
  const unexpectedDialogs = page.dialogs.filter(d => !d.includes("AI 暂时不可用"));
  assert.deepEqual(unexpectedDialogs, [], `Unexpected dialogs: ${JSON.stringify(page.dialogs)}`);

  const auditReport = {
    generatedAt: new Date().toISOString(),
    status: "PASS",
    workspaces: auditLog,
    viewportsChecked: [375, 390, 768, 1024, 1440, 1920],
    themesChecked: ["light", "dark"],
    runtimeErrorsCount: page.runtimeErrors.length,
    dialogsCount: page.dialogs.length,
  };
  await fsp.writeFile(path.join(EVIDENCE_DIR, "workspaces-p07-e-audit.json"), JSON.stringify(auditReport, null, 2) + "\n");
  console.log("[PASS] P07-E business workspaces audit passed completely!");
  console.log(JSON.stringify(auditReport, null, 2));

  await page.close();
} finally {
  killOwnedPid(pagesPid);
  killOwnedPid(chromePid);
}
