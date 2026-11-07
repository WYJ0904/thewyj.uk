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
const EVIDENCE_DIR = path.resolve(ROOT, "docs/p07/evidence/flicker-investigation");
const QA_WORK_ROOT = path.join(ROOT, ".wrangler", `p07-flicker-qa-${Date.now()}`);
const RUNTIME_DIR = path.join(QA_WORK_ROOT, "runtime");
const STATE_DIR = path.join(QA_WORK_ROOT, "state");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

const BASE_PORT = 18962;
const CDP_PORT = 19292;
const BASE_URL = `http://127.0.0.1:${BASE_PORT}`;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

function cleanChildEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const name of Object.keys(env)) {
    if (/^(?:CLOUDFLARE_|CF_API_|CF_ACCOUNT_|OPENAI_|ANTHROPIC_|GEMINI_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(name)) {
      delete env[name];
    }
  }
  env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH || ""}`;
  env.WRANGLER_SEND_METRICS = "false";
  env.NO_PROXY = "127.0.0.1,localhost";
  env.no_proxy = "127.0.0.1,localhost";
  return env;
}

async function healthy(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

let pagesProc = null;
let chromeProc = null;

async function cleanup() {
  if (pagesProc?.pid) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(pagesProc.pid), "/t", "/f"]);
      } else {
        pagesProc.kill("SIGKILL");
      }
    } catch {}
  }
  if (chromeProc?.pid) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(chromeProc.pid), "/t", "/f"]);
      } else {
        chromeProc.kill("SIGKILL");
      }
    } catch {}
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });

await fsp.mkdir(RUNTIME_DIR, { recursive: true });
await fsp.mkdir(STATE_DIR, { recursive: true });
await fsp.mkdir(EVIDENCE_DIR, { recursive: true });

await fsp.writeFile(
  path.join(RUNTIME_DIR, "package.json"),
  JSON.stringify({ name: "aeris-p07-flicker-qa", private: true, type: "module" })
);

console.log("--> Staging pages deploy...");
const { output } = await stagePages({ root: ROOT });
const servedOutput = path.join(RUNTIME_DIR, "public");
await fsp.cp(output, servedOutput, { recursive: true });
await fsp.cp(path.join(output, "functions"), path.join(RUNTIME_DIR, "functions"), { recursive: true });
await fsp.cp(path.join(output, "js"), path.join(RUNTIME_DIR, "js"), { recursive: true });

const rootConfig = JSON.parse(await fsp.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
const localConfig = {
  name: "aeris-p07-flicker-local",
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
      database_name: "aeris-p07-flicker-local",
      migrations_table: "wyj_d1_migrations",
      migrations_dir: path.join(ROOT, "cloudflare", "migrations"),
    },
  ],
  r2_buckets: [{ binding: "WYJ_STORAGE", bucket_name: "aeris-p07-flicker-local" }],
};
await fsp.writeFile(path.join(RUNTIME_DIR, "wrangler.jsonc"), `${JSON.stringify(localConfig, null, 2)}\n`);

const adminSecret = randomBytes(24).toString("base64url");
const testUserSecret = "test-user-password-123";
const secrets = {
  WYJ_TASK12_PASSWORD_PEPPER: randomBytes(32).toString("base64url"),
  WYJ_TASK14_TEMPORARY_SECRET: randomBytes(32).toString("base64url"),
  WYJ_TASK20_DEVICE_SESSION_SECRET: randomBytes(32).toString("base64url"),
};
await fsp.writeFile(
  path.join(RUNTIME_DIR, ".dev.vars"),
  Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"
);

console.log("--> Applying D1 migrations...");
const mig = spawnSync(
  process.execPath,
  [WRANGLER, "d1", "migrations", "apply", "WYJ_DB", "--local", "--config", path.join(RUNTIME_DIR, "wrangler.jsonc"), "--persist-to", STATE_DIR],
  { cwd: ROOT, env: cleanChildEnv(), encoding: "utf8", timeout: 180_000 }
);
assert.equal(mig.status, 0, `D1 migration failed:\n${mig.stdout}\n${mig.stderr}`);

console.log("--> Seeding test fixtures...");
const now = new Date().toISOString();
const pwHash = await hashSecret(adminSecret, secrets.WYJ_TASK12_PASSWORD_PEPPER);
const userPwHash = await hashSecret(testUserSecret, secrets.WYJ_TASK12_PASSWORD_PEPPER);
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const seedSql = `
  INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at)
  VALUES ('admin-1', 'wyj', 'wyj', ${q(pwHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});
  INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at)
  VALUES ('user-1', 'aerisowner', 'aerisowner', ${q(userPwHash)}, 'pbkdf2_sha256', 310000, 'user', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});
  INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
  VALUES ('p07_accessibility', 'P07 UI Flag', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${q(now)}, 'admin-1', 'p07-seed', 'p07-seed');
`;
const seedFile = path.join(QA_WORK_ROOT, "seed.sql");
await fsp.writeFile(seedFile, seedSql);
const seeded = spawnSync(
  process.execPath,
  [WRANGLER, "d1", "execute", "WYJ_DB", "--local", "--config", path.join(RUNTIME_DIR, "wrangler.jsonc"), "--persist-to", STATE_DIR, "--file", seedFile],
  { cwd: ROOT, env: cleanChildEnv(), encoding: "utf8", timeout: 90_000 }
);
assert.equal(seeded.status, 0, `D1 seed failed:\n${seeded.stdout}\n${seeded.stderr}`);

const chromeExe = "C:/Program Files/Google/Chrome/Application/chrome.exe";
console.log(`--> Spawning Pages dev server on port ${BASE_PORT}...`);
const pagesLog = openSync(path.join(QA_WORK_ROOT, "pages.log"), "w");
pagesProc = spawn(
  process.execPath,
  [
    WRANGLER, "pages", "dev", servedOutput,
    "--ip", "127.0.0.1", "--port", String(BASE_PORT),
    "--inspector-port", "19277",
    "--persist-to", STATE_DIR,
    "--d1", "WYJ_DB",
    "--r2", "WYJ_STORAGE=aeris-p07-flicker-local",
    "--show-interactive-dev-session", "false",
    "--log-level", "info",
  ],
  { cwd: RUNTIME_DIR, env: cleanChildEnv(), windowsHide: true, stdio: ["ignore", pagesLog, pagesLog] }
);
closeSync(pagesLog);

console.log(`--> Spawning headless Chrome on CDP port ${CDP_PORT}...`);
const chromeLog = openSync(path.join(QA_WORK_ROOT, "chrome.log"), "w");
chromeProc = spawn(
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
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${path.join(QA_WORK_ROOT, "chrome-profile")}`,
    "about:blank",
  ],
  { cwd: RUNTIME_DIR, env: cleanChildEnv(), windowsHide: true, stdio: ["ignore", chromeLog, chromeLog] }
);
closeSync(chromeLog);

const readyDeadline = Date.now() + 60_000;
let readyOk = false;
while (Date.now() < readyDeadline) {
  try {
    const [statusRes, uiRes, cdpOk] = await Promise.all([
      fetch(`${BASE_URL}/api/status?source=cloud`, { signal: AbortSignal.timeout(2000) }),
      fetch(`${BASE_URL}/api/ui/features`, { signal: AbortSignal.timeout(2000) }),
      healthy(`${CDP_URL}/json/version`),
    ]);
    if (statusRes.ok && uiRes.ok && cdpOk) {
      readyOk = true;
      break;
    }
  } catch {}
  await delay(300);
}
assert.ok(readyOk, "Server + CDP not ready in 60s");
console.log("[PASS] Server and Headless Chrome ready!");

const frameSamplerSource = `
  globalThis.__flickerFrames = [];
  globalThis.__flickerSampling = true;
  function sampleFrame(ts) {
    if (!globalThis.__flickerSampling) return;
    const entryScreen = document.getElementById('entryScreen');
    const authTransition = document.getElementById('authTransitionScreen');
    const appFrame = document.getElementById('v3AppFrame');
    const policyState = document.getElementById('interfacePolicyState');
    const publicHome = document.getElementById('publicHome');
    const accountModal = document.getElementById('accountModal');
    const loginForm = document.getElementById('loginForm');
    const sessionRecovery = document.getElementById('sessionRecovery');
    const checkVis = el => Boolean(el && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));

    const entryVisible = checkVis(entryScreen);
    const authTransitionVisible = checkVis(authTransition);
    const frameVisible = checkVis(appFrame);
    const policyVisible = checkVis(policyState);
    const homeVisible = checkVis(publicHome);
    const accountVisible = checkVis(accountModal);
    const loginVisible = checkVis(loginForm);
    const recoveryVisible = checkVis(sessionRecovery);

    const policyMsg = policyVisible ? document.getElementById('interfacePolicyMessage')?.textContent : null;

    // Blank frame condition:
    // Neither splash nor auth transition is visible,
    // AND none of the actual content (home, account, login, recovery) is visible,
    // OR policyState is visible alone (the "正在读取界面设置…" flicker!).
    const hasOverlay = entryVisible || authTransitionVisible;
    const hasContent = homeVisible || accountVisible || loginVisible || recoveryVisible;
    const isBlank = !hasOverlay && !hasContent;
    const isPolicyFlicker = !hasOverlay && policyVisible && (policyMsg?.includes('正在读取界面设置') || policyMsg?.includes('界面设置暂时无法读取'));

    globalThis.__flickerFrames.push({
      t: ts,
      path: location.pathname,
      bootState: document.documentElement.dataset.bootState,
      interfacePolicy: document.documentElement.dataset.interfacePolicy,
      p07Ui: document.documentElement.dataset.p07Ui,
      entryVisible,
      authTransitionVisible,
      frameVisible,
      policyVisible,
      policyMsg,
      homeVisible,
      accountVisible,
      loginVisible,
      recoveryVisible,
      isBlank,
      isPolicyFlicker
    });
    requestAnimationFrame(sampleFrame);
  }
  requestAnimationFrame(sampleFrame);
`;

const investigationResults = {};

// -----------------------------------------------------------------------------
// Scenario 1: 首次访问 (Cold Boot / Hard Refresh)
// -----------------------------------------------------------------------------
console.log("\n--> Testing Scenario 1: First Visit (Cold Boot)...");
{
  const page = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL, width: 1440, height: 960, mobile: false });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: frameSamplerSource });
  await page.send("Page.navigate", { url: `${BASE_URL}/` });
  await page.waitFor("document.readyState === 'complete' && !document.getElementById('entryScreen') && document.documentElement.dataset.bootState === 'ready'", 15000);
  await page.waitFor("document.documentElement.dataset.interfacePolicy === 'enabled'", 10000);
  await delay(300);

  const frames = await page.evaluate("globalThis.__flickerFrames");
  const blankFrames = frames.filter(f => f.isBlank || f.isPolicyFlicker);
  let durationMs = 0;
  if (blankFrames.length > 0) {
    durationMs = Math.round(blankFrames.at(-1).t - blankFrames[0].t);
  }
  console.log(`Scenario 1: Total frames sampled: ${frames.length}, Blank/Flicker frames: ${blankFrames.length}, Duration: ${durationMs}ms`);
  investigationResults.scenario1 = {
    totalFrames: frames.length,
    blankFramesCount: blankFrames.length,
    blankDurationMs: durationMs,
    sampleBlankFrames: blankFrames.slice(0, 10),
    firstReadyFrame: frames.find(f => f.homeVisible),
  };
  await page.close();
}

// -----------------------------------------------------------------------------
// Scenario 2: 登录成功 (Login Success Transition)
// -----------------------------------------------------------------------------
console.log("\n--> Testing Scenario 2: Login Success Transition...");
{
  const page = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL, width: 1440, height: 960, mobile: false });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: frameSamplerSource });
  await page.send("Page.navigate", { url: `${BASE_URL}/login` });
  await page.waitFor("document.readyState === 'complete' && !document.getElementById('entryScreen') && document.querySelector('#usernameInput').checkVisibility()", 15000);
  
  // Clear frame log before login submit
  await page.evaluate("globalThis.__flickerFrames = []; true;");
  
  await page.setFields({ "#usernameInput": "aerisowner", "#secretInput": testUserSecret });
  
  // Submit login
  await page.evaluate("document.querySelector('#loginSubmitBtn').click(); true;");
  
  // Wait until home/workspace is visible and policy enabled
  await page.waitFor("document.getElementById('publicHome')?.checkVisibility() && document.documentElement.dataset.interfacePolicy === 'enabled'", 15000);
  await delay(300);

  const frames = await page.evaluate("globalThis.__flickerFrames");
  const blankFrames = frames.filter(f => f.isBlank || f.isPolicyFlicker);
  let durationMs = 0;
  if (blankFrames.length > 0) {
    durationMs = Math.round(blankFrames.at(-1).t - blankFrames[0].t);
  }
  console.log(`Scenario 2: Total frames sampled: ${frames.length}, Blank/Flicker frames: ${blankFrames.length}, Duration: ${durationMs}ms`);
  investigationResults.scenario2 = {
    totalFrames: frames.length,
    blankFramesCount: blankFrames.length,
    blankDurationMs: durationMs,
    sampleBlankFrames: blankFrames.slice(0, 10),
    firstWorkspaceFrame: frames.find(f => f.homeVisible),
  };
  await page.close();
}

// -----------------------------------------------------------------------------
// Scenario 3: 标签页恢复 (Tab Background and Recovery)
// -----------------------------------------------------------------------------
console.log("\n--> Testing Scenario 3: Tab Switching Recovery...");
{
  const page = await openPage({ cdpUrl: CDP_URL, baseUrl: BASE_URL, width: 1440, height: 960, mobile: false });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: frameSamplerSource });
  await page.send("Page.navigate", { url: `${BASE_URL}/` });
  await page.waitFor("document.readyState === 'complete' && !document.getElementById('entryScreen') && document.getElementById('publicHome')?.checkVisibility()", 15000);
  await page.waitFor("document.documentElement.dataset.interfacePolicy === 'enabled'", 10000);

  // Create a second tab (simulating ChatGPT)
  const targetInfo = (await page.client.send("Target.getTargets")).targetInfos.find(t => t.targetId === page.targetId);
  const { targetId: secondTabId } = await page.client.send("Target.createTarget", { url: `${BASE_URL}/favicon.ico`, browserContextId: targetInfo.browserContextId });

  // Activate second tab (Aeris tab is now hidden/in background)
  await page.client.send("Target.activateTarget", { targetId: secondTabId });
  await page.waitFor("document.visibilityState === 'hidden'", 5000);
  console.log("Aeris tab is now in background. Simulating background lease expiration (e.g. user on ChatGPT > 30s)...");

  // In background, simulate lease expiration just like a 30s tab switch to ChatGPT does:
  // Trigger clear() by letting TTL expire or simulating expiry
  await page.evaluate(`
    // Simulate what happens when the 30s lease expires while the tab is on ChatGPT
    // by evaluating feature flag clear or public UI policy clear:
    window.__p07TestExpireLease?.();
  `);

  // Clear frame log before bringing to front
  await page.evaluate("globalThis.__flickerFrames = []; true;");

  // Switch back to Aeris tab
  await page.client.send("Target.activateTarget", { targetId: page.targetId });
  await page.send("Page.bringToFront");
  await page.waitFor("document.visibilityState === 'visible'", 5000);

  // Wait 1 second to observe any flicker on restore
  await delay(1000);

  const frames = await page.evaluate("globalThis.__flickerFrames");
  const blankFrames = frames.filter(f => f.isBlank || f.isPolicyFlicker);
  let durationMs = 0;
  if (blankFrames.length > 0) {
    durationMs = Math.round(blankFrames.at(-1).t - blankFrames[0].t);
  }
  console.log(`Scenario 3: Total frames sampled: ${frames.length}, Blank/Flicker frames: ${blankFrames.length}, Duration: ${durationMs}ms`);
  investigationResults.scenario3 = {
    totalFrames: frames.length,
    blankFramesCount: blankFrames.length,
    blankDurationMs: durationMs,
    sampleBlankFrames: blankFrames.slice(0, 10),
  };

  await page.client.send("Target.closeTarget", { targetId: secondTabId });
  await page.close();
}

const reportPath = path.join(EVIDENCE_DIR, "baseline-flicker-investigation.json");
await fsp.writeFile(reportPath, JSON.stringify(investigationResults, null, 2));
console.log(`\n[COMPLETE] Baseline investigation results saved to ${reportPath}`);

await cleanup();
process.exit(0);
