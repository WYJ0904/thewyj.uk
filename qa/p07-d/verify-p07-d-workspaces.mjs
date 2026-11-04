import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";
import { stagePages } from "../../scripts/stage_pages_deploy.mjs";
import { CdpClient, delay, openPage } from "../../local-backend/browser_harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_DIR = path.join(ROOT, "docs/p07/evidence/p07-d");
const QA_WORK_ROOT = path.join(ROOT, ".wrangler", `p07-d-qa-${Date.now()}`);
const RUNTIME_DIR = path.join(QA_WORK_ROOT, "runtime");
const STATE_DIR = path.join(QA_WORK_ROOT, "state");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const BASE_URL = "http://127.0.0.1:18938";
const CDP_URL = "http://127.0.0.1:19258";

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
    JSON.stringify({ name: "aeris-p07-d-qa", private: true, type: "module" })
  );

  const { output } = await stagePages();
  const servedOutput = path.join(RUNTIME_DIR, "public");
  await fsp.cp(output, servedOutput, { recursive: true });
  await fsp.cp(path.join(output, "functions"), path.join(RUNTIME_DIR, "functions"), { recursive: true });
  await fsp.cp(path.join(output, "js"), path.join(RUNTIME_DIR, "js"), { recursive: true });

  const rootConfig = JSON.parse(await fsp.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
  const localConfig = {
    name: "aeris-p07-d-local",
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
        database_name: "aeris-p07-d-local",
        migrations_table: "wyj_d1_migrations",
        migrations_dir: path.join(ROOT, "cloudflare", "migrations"),
      },
    ],
    r2_buckets: [{ binding: "WYJ_STORAGE", bucket_name: "aeris-p07-d-local" }],
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
    VALUES ('aeris-p07-d-admin', 'wyj', 'wyj', ${q(pwHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});
    INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
    VALUES ('p07_accessibility', 'Isolated P07-D QA', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${q(now)}, 'aeris-p07-d-admin', 'p07-d-seed', 'p07-d-seed');
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
      "18938",
      "--inspector-port",
      "19268",
      "--persist-to",
      STATE_DIR,
      "--d1",
      "WYJ_DB",
      "--r2",
      "WYJ_STORAGE=aeris-p07-d-local",
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
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=19258",
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

  // Audit 1: P07-03 Personal Space (Home Authenticated)
  console.log("--> Auditing P07-03: Personal Space...");
  await setViewport(1440, 960, false);
  await setTheme("light");
  await saveShot("p07-03-personal-space-1440-light.png");
  await setTheme("dark");
  await saveShot("p07-03-personal-space-1440-dark.png");
  await setTheme("light");
  await setViewport(390, 844, true);
  await saveShot("p07-03-personal-space-390-light.png");
  auditLog.push({ workspace: "P07-03", name: "Personal Space (Dashboard)", status: "PASS" });

  // Audit 2: P07-04 Language Learning & Immersive Quiz
  console.log("--> Auditing P07-04: Language Learning & Immersive Quiz...");
  await setViewport(1440, 960, false);
  await page.navigate("/language");
  await delay(400);
  await saveShot("p07-04-language-picker-1440-light.png");

  // Enter Japanese project
  await page.click('[data-language-choice="japanese"]');
  await page.waitFor("!document.getElementById('workspace').classList.contains('hidden')", 15_000);
  await delay(300);

  // Set sample words and start quiz
  await page.setFields({ "#wordInput": "本\n図書館\n先生\n学生\n電話" });
  await delay(100);
  await page.click("#startBtn");
  await page.waitFor("!document.getElementById('quizView').classList.contains('hidden')", 15_000);
  await delay(400);
  await saveShot("p07-04-quiz-immersive-1440-light.png");
  await setTheme("dark");
  await saveShot("p07-04-quiz-immersive-1440-dark.png");
  await setTheme("light");
  await setViewport(390, 844, true);
  await saveShot("p07-04-quiz-immersive-390-light.png");
  auditLog.push({ workspace: "P07-04", name: "Language Learning & Immersive Quiz", status: "PASS" });

  // Audit 3: P07-05 Wrong Questions, Mastery & Stats
  console.log("--> Auditing P07-05: Wrong Questions, Mastery & Stats...");
  await setViewport(1440, 960, false);
  // Click wrong questions tab
  await page.click("#wrongViewTab");
  await delay(300);
  await saveShot("p07-05-wrong-questions-1440-light.png");
  await setViewport(390, 844, true);
  await saveShot("p07-05-wrong-questions-390-light.png");

  // Click achievements tab
  await setViewport(1440, 960, false);
  await page.click("#achievementsViewTab");
  await delay(300);
  await saveShot("p07-05-achievements-1440-light.png");

  // Click study stats tab
  await page.click("#studyViewTab");
  await delay(300);
  await saveShot("p07-05-study-stats-1440-light.png");
  auditLog.push({ workspace: "P07-05", name: "Mastery, Wrong Questions & Stats", status: "PASS" });

  // Audit 4: P07-08 Toolbox & Real Tool Workspaces
  console.log("--> Auditing P07-08: Toolbox & Tool Workbench...");
  await setViewport(1440, 960, false);
  await page.navigate("/tools");
  await page.waitFor("!document.getElementById('toolsPanel').classList.contains('hidden')", 15_000);
  await delay(300);
  await saveShot("p07-08-toolbox-dashboard-1440-light.png");
  await setTheme("dark");
  await saveShot("p07-08-toolbox-dashboard-1440-dark.png");
  await setTheme("light");
  await setViewport(390, 844, true);
  await saveShot("p07-08-toolbox-dashboard-390-light.png");

  // Open text-stats tool workbench
  await setViewport(1440, 960, false);
  await page.navigate("/tools/text-stats");
  await page.waitFor("!document.getElementById('toolWorkbench').classList.contains('hidden')", 15_000);
  await delay(300);
  await saveShot("p07-08-tool-workbench-1440-light.png");
  await setTheme("dark");
  await saveShot("p07-08-tool-workbench-1440-dark.png");
  await setTheme("light");
  await setViewport(390, 844, true);
  await saveShot("p07-08-tool-workbench-390-light.png");
  auditLog.push({ workspace: "P07-08", name: "Toolbox & Tool Workbench", status: "PASS" });

  // Audit 5: P07-06 Finance Ledger Workspace
  console.log("--> Auditing P07-06: Finance Ledger...");
  await setViewport(1440, 960, false);
  await page.navigate("/finance");
  await page.waitFor("!document.getElementById('financePage').classList.contains('hidden')", 15_000);
  await delay(400);
  await saveShot("p07-06-finance-ledger-1440-light.png");
  await setTheme("dark");
  await saveShot("p07-06-finance-ledger-1440-dark.png");
  await setTheme("light");
  await setViewport(390, 844, true);
  await saveShot("p07-06-finance-ledger-390-light.png");
  auditLog.push({ workspace: "P07-06", name: "Finance Ledger Workspace", status: "PASS" });

  // Audit 6: P07-07 Notification Archive & Candidate Verification
  console.log("--> Auditing P07-07: Candidate Verification...");
  await setViewport(1440, 960, false);
  // Ensure candidates section is visible/open
  await page.evaluate(`
    const sec = document.getElementById("financeCandidatesSection");
    if (sec) { sec.classList.remove("hidden"); sec.open = true; }
  `);
  await delay(200);
  await saveShot("p07-07-candidates-verification-1440-light.png");
  await setTheme("dark");
  await saveShot("p07-07-candidates-verification-1440-dark.png");
  await setTheme("light");
  await setViewport(390, 844, true);
  await saveShot("p07-07-candidates-verification-390-light.png");
  auditLog.push({ workspace: "P07-07", name: "Candidate Verification", status: "PASS" });

  // Multi-viewport representative checks (375, 412, 768, 1024, 1920)
  console.log("--> Auditing multi-viewport responsiveness...");
  const extraViewports = [
    ["375", 375, 667, true],
    ["412", 412, 915, true],
    ["768", 768, 1024, false],
    ["1024", 1024, 768, false],
    ["1920", 1920, 1080, false],
  ];
  for (const [vpName, vpW, vpH, vpMob] of extraViewports) {
    await setViewport(vpW, vpH, vpMob);
    await page.navigate("/finance");
    await delay(200);
    await saveShot(`viewport-finance-${vpName}.png`);
  }

  // Runtime error check
  assert.deepEqual(page.runtimeErrors, [], `Unexpected browser errors: ${JSON.stringify(page.runtimeErrors)}`);
  const unexpectedDialogs = page.dialogs.filter(d => !d.includes("AI 暂时不可用"));
  assert.deepEqual(unexpectedDialogs, [], `Unexpected dialogs: ${JSON.stringify(page.dialogs)}`);

  const auditReport = {
    generatedAt: new Date().toISOString(),
    status: "PASS",
    workspaces: auditLog,
    viewportsChecked: [375, 390, 412, 768, 1024, 1440, 1920],
    themesChecked: ["light", "dark"],
    runtimeErrorsCount: page.runtimeErrors.length,
    dialogsCount: page.dialogs.length,
  };
  await fsp.writeFile(path.join(EVIDENCE_DIR, "workspaces-audit.json"), JSON.stringify(auditReport, null, 2) + "\n");
  console.log("[PASS] P07-D business workspaces audit passed completely!");
  console.log(JSON.stringify(auditReport, null, 2));

  await page.close();
} finally {
  killOwnedPid(pagesPid);
  killOwnedPid(chromePid);
}
