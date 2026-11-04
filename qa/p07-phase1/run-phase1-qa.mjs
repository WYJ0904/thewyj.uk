import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";
import { stagePages } from "../../scripts/stage_pages_deploy.mjs";
import { CdpClient, delay } from "../../local-backend/browser_harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_DIR = path.join(ROOT, "docs/p07/evidence/phase1-rework");
const QA_WORK_ROOT = path.join(ROOT, ".wrangler", `p07-phase1-qa-${Date.now()}`);
const RUNTIME_DIR = path.join(QA_WORK_ROOT, "runtime");
const STATE_DIR = path.join(QA_WORK_ROOT, "state");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const BASE_URL = "http://127.0.0.1:18898";
const CDP_URL = "http://127.0.0.1:19238";
const WITH_APP_BROWSER = process.argv.includes("--with-app-browser");

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

async function runBrowserZoomProof(chromeExe) {
  const zoomOutDir = path.join(QA_WORK_ROOT, "zoom");
  await fsp.mkdir(zoomOutDir, { recursive: true });
  const results = [];

  for (const factor of [1, 2, 4]) {
    const profile = path.join(zoomOutDir, `profile-${factor * 100}`);
    await fsp.mkdir(path.join(profile, "Default"), { recursive: true });
    const preferences = {
      partition: { default_zoom_level: { x: Math.log(factor) / Math.log(1.2) } },
    };
    await fsp.writeFile(path.join(profile, "Default", "Preferences"), JSON.stringify(preferences));
    const logFd = openSync(path.join(zoomOutDir, `chrome-${factor * 100}.log`), "w");
    const child = spawn(
      chromeExe,
      [
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        "--window-size=1440,960",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { windowsHide: true, stdio: ["ignore", logFd, logFd] }
    );
    closeSync(logFd);

    let browserClient;
    let pageClient;
    const runtimeErrors = [];
    try {
      let endpoint = "";
      for (let i = 0; i < 100; i++) {
        try {
          const portText = await fsp.readFile(path.join(profile, "DevToolsActivePort"), "utf8");
          const port = Number(portText.split(/\r?\n/)[0]);
          if (port > 0) {
            endpoint = `http://127.0.0.1:${port}`;
            break;
          }
        } catch {}
        await delay(100);
      }
      assert.ok(endpoint, `Zoom browser (${factor * 100}%) failed to publish DevToolsActivePort`);
      const version = await fetch(`${endpoint}/json/version`).then((r) => r.json());
      browserClient = new CdpClient(version.webSocketDebuggerUrl);
      await browserClient.connect();
      const targets = await fetch(`${endpoint}/json/list`).then((r) => r.json());
      const pageTarget = targets.find((t) => t.type === "page");
      assert.ok(pageTarget);
      pageClient = new CdpClient(pageTarget.webSocketDebuggerUrl);
      await pageClient.connect();
      pageClient.listeners.add((msg) => {
        if (msg.method === "Runtime.exceptionThrown") {
          runtimeErrors.push(msg.params?.exceptionDetails?.text || "exception");
        }
      });
      await pageClient.send("Page.enable");
      await pageClient.send("Runtime.enable");

      const evalExpr = async (expression) => {
        const res = await pageClient.send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        });
        if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
        return res.result?.value;
      };

      const routeChecks = [];
      for (const route of ["/", "/login"]) {
        await pageClient.send("Page.navigate", { url: `${BASE_URL}${route}` });
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline) {
          try {
            const ready = await evalExpr(
              "document.readyState !== 'loading' && document.getElementById('appShell') && !document.getElementById('appShell').classList.contains('app-shell-pending') && document.documentElement.dataset.p07Ui === 'enabled'"
            );
            if (ready) break;
          } catch {}
          await delay(100);
        }
        await delay(200);
        const m = await evalExpr(`({
          route: location.pathname,
          innerWidth,
          innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          dpr: devicePixelRatio,
          pageScale: visualViewport.scale,
          cssZoom: getComputedStyle(document.documentElement).zoom,
        })`);
        assert.ok(
          m.scrollWidth <= m.innerWidth + 2,
          `Page zoom ${factor * 100}% overflow on ${route}: ${m.scrollWidth} > ${m.innerWidth}`
        );
        routeChecks.push(m);
      }
      assert.deepEqual(runtimeErrors, []);
      results.push({ factor, percent: `${factor * 100}%`, status: "PASS", routeChecks });
    } finally {
      pageClient?.close();
      browserClient?.close();
      killOwnedPid(child.pid);
    }
  }

  const firstDpr = results[0].routeChecks[0].dpr;
  const firstWidth = results[0].routeChecks[0].innerWidth;
  for (const row of results) {
    const sample = row.routeChecks[0];
    assert.ok(Math.abs(sample.dpr / firstDpr - row.factor) < 0.02, "DPR must scale with Chromium HostZoomMap");
    assert.ok(Math.abs(sample.innerWidth * row.factor - firstWidth) <= 4, "Layout viewport must shrink proportionally");
  }

  const outPath = path.join(EVIDENCE_DIR, "browser-zoom-400.json");
  await fsp.writeFile(outPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`, "utf8");
  return results;
}

let pagesPid = 0;
let chromePid = 0;

try {
  assert.ok(!(await healthy(`${BASE_URL}/api/status`)), `Port 18898 already occupied`);
  assert.ok(!(await healthy(`${CDP_URL}/json/version`)), `Port 19238 already occupied`);

  await fsp.mkdir(RUNTIME_DIR, { recursive: true });
  await fsp.mkdir(STATE_DIR, { recursive: true });
  await fsp.mkdir(EVIDENCE_DIR, { recursive: true });

  await fsp.writeFile(
    path.join(RUNTIME_DIR, "package.json"),
    JSON.stringify({ name: "aeris-p07-phase1-qa", private: true, type: "module" })
  );

  const { output } = await stagePages();
  const servedOutput = path.join(RUNTIME_DIR, "public");
  await fsp.cp(output, servedOutput, { recursive: true });
  await fsp.cp(path.join(output, "functions"), path.join(RUNTIME_DIR, "functions"), { recursive: true });
  await fsp.cp(path.join(output, "js"), path.join(RUNTIME_DIR, "js"), { recursive: true });

  const rootConfig = JSON.parse(await fsp.readFile(path.join(ROOT, "wrangler.jsonc"), "utf8"));
  const localConfig = {
    name: "aeris-p07-phase1-local",
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
        database_name: "aeris-p07-phase1-local",
        migrations_table: "wyj_d1_migrations",
        migrations_dir: path.join(ROOT, "cloudflare", "migrations"),
      },
    ],
    r2_buckets: [{ binding: "WYJ_STORAGE", bucket_name: "aeris-p07-phase1-local" }],
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

  // Apply local D1 migrations
  const mig = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "migrations", "apply", "WYJ_DB", "--local", "--config", path.join(RUNTIME_DIR, "wrangler.jsonc"), "--persist-to", STATE_DIR],
    { cwd: ROOT, env: cleanChildEnv(), encoding: "utf8", timeout: 180_000 }
  );
  assert.equal(mig.status, 0, `D1 local migration failed:\n${mig.stdout}\n${mig.stderr}`);

  // Seed synthetic admin + Task25 p07_accessibility flag ON in isolated local DB
  const now = new Date().toISOString();
  const pwHash = await hashSecret(adminSecret, secrets.WYJ_TASK12_PASSWORD_PEPPER);
  const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
  const seedSql = `
    INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at)
    VALUES ('aeris-p07-phase1-admin', 'wyj', 'wyj', ${q(pwHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});
    INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
    VALUES ('p07_accessibility', 'Isolated P07 Phase 1 QA', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${q(now)}, 'aeris-p07-phase1-admin', 'p07-phase1-seed', 'p07-phase1-seed');
  `;
  const seedFile = path.join(QA_WORK_ROOT, "seed.sql");
  await fsp.writeFile(seedFile, seedSql);
  const seeded = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", "WYJ_DB", "--local", "--config", path.join(RUNTIME_DIR, "wrangler.jsonc"), "--persist-to", STATE_DIR, "--file", seedFile],
    { cwd: ROOT, env: cleanChildEnv(), encoding: "utf8", timeout: 90_000 }
  );
  assert.equal(seeded.status, 0, `D1 local seed failed:\n${seeded.stdout}\n${seeded.stderr}`);

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
      "18898",
      "--inspector-port",
      "19248",
      "--persist-to",
      STATE_DIR,
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
      "--remote-debugging-port=19238",
      `--user-data-dir=${path.join(QA_WORK_ROOT, "chrome-profile")}`,
      "about:blank",
    ],
    { cwd: RUNTIME_DIR, env: cleanChildEnv(), windowsHide: true, stdio: ["ignore", chromeLog, chromeLog] }
  );
  closeSync(chromeLog);
  chromePid = chromeProc.pid;

  // Wait for server + policy + CDP ready
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
  assert.ok(readyOk, "Local QA Pages dev + CDP fixture did not become ready within 90s");

  const suiteEnv = cleanChildEnv({
    WYJ_TEST_BASE: BASE_URL,
    WYJ_BASE_URL: BASE_URL,
    WYJ_CDP_URL: CDP_URL,
    WYJ_TEST_ADMIN_USER: "wyj",
    WYJ_TEST_ADMIN_USERNAME: "wyj",
    WYJ_TEST_ADMIN_SECRET: adminSecret,
    HOME_WIDGET_OUTPUT: path.join(EVIDENCE_DIR, "after-home-widgets.json"),
    AERIS_PHASE1_EVIDENCE_DIR: EVIDENCE_DIR,
  });

  const suiteReports = [];
  const suites = [
    ["home-widgets-browser", "qa/aeris/home-widgets-browser.mjs"],
    ["phase1-browser-verify", "qa/p07-phase1/phase1-browser-verify.mjs"],
    ["independent-browser-gaps", "qa/p07-phase1/independent-browser-gaps.mjs"],
    ...(WITH_APP_BROWSER ? [["test-app-browser", "local-backend/test_app_browser.mjs"]] : []),
  ];

  for (const [label, relScript] of suites) {
    const t0 = Date.now();
    const run = spawnSync(process.execPath, [path.join(ROOT, relScript)], {
      cwd: ROOT,
      env: suiteEnv,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 30 * 1024 * 1024,
    });
    suiteReports.push({
      suite: label,
      script: relScript,
      status: run.status === 0 ? "PASS" : "FAIL",
      durationMs: Date.now() - t0,
    });
    if (run.status !== 0) {
      throw new Error(`Suite ${label} (${relScript}) failed (exit ${run.status}):\n${run.stdout}\n${run.stderr}`);
    }
  }

  // Real Chromium profile 100% / 200% / 400% page zoom verification
  const zoomStart = Date.now();
  await runBrowserZoomProof(chromeExe);
  suiteReports.push({
    suite: "browser-zoom-400",
    script: "Chromium HostZoomMap 100%/200%/400%",
    status: "PASS",
    durationMs: Date.now() - zoomStart,
  });

  console.log(JSON.stringify({ ok: true, suites: suiteReports }, null, 2));
} finally {
  killOwnedPid(pagesPid);
  killOwnedPid(chromePid);
}
