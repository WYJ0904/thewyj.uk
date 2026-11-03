import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";
import { stagePages } from "../../scripts/stage_pages_deploy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceRelative = "docs/migration-evidence/aeris-p03-p07/ci";
const evidence = path.join(root, evidenceRelative);
const attempt = process.env.AERIS_CI_FIXTURE_ATTEMPT || "r1";
assert.match(attempt, /^r[1-9][0-9]*$/);
const suffix = attempt === "r1" ? "" : `-${attempt}`;
const runtime = path.join(evidence, `runtime${suffix}`);
const privateDirectory = path.join(evidence, `private${suffix}`);
const state = path.join(root, ".wrangler", `aeris-ui-qa${suffix}`);
const manifestPath = path.join(evidence, `browser-fixture${suffix}.json`);
const environmentPath = path.join(privateDirectory, "environment.json");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const base = "http://127.0.0.1:8898";
const cdp = "http://127.0.0.1:9238";
const nodeDirectory = path.dirname(process.execPath);

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

function childEnvironment(overrides = {}) {
  // No Cloudflare account/token, AI credential or remote-binding input is
  // propagated to the local fixture. Its config contains local bindings only.
  const environment = { ...process.env, ...overrides };
  for (const name of Object.keys(environment)) {
    if (/^(?:CLOUDFLARE_|CF_API_|CF_ACCOUNT_|OPENAI_|ANTHROPIC_|GEMINI_)/i.test(name)) delete environment[name];
  }
  environment.PATH = `${nodeDirectory}${path.delimiter}${environment.PATH || ""}`;
  environment.WRANGLER_SEND_METRICS = "false";
  environment.NO_PROXY = "127.0.0.1,localhost";
  environment.PYTHONIOENCODING = "utf-8";
  return environment;
}

async function commandLog(name, args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd || root, env: childEnvironment(), encoding: "utf8",
    timeout: 180_000, maxBuffer: 20 * 1024 * 1024,
  });
  await writeFile(path.join(evidence, name), `${result.stdout || ""}\n${result.stderr || ""}`, { flag: "wx" });
  assert.equal(result.status, 0, `local setup command failed; retained ${evidenceRelative}/${name}`);
}

function background(executable, args, logFile, cwd) {
  const descriptor = openSync(logFile, "ax");
  const child = spawn(executable, args, {
    cwd, env: childEnvironment(), detached: true, windowsHide: true,
    stdio: ["ignore", descriptor, descriptor],
  });
  closeSync(descriptor);
  child.unref();
  assert.ok(child.pid, "local fixture process did not start");
  return child.pid;
}

async function healthy(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3_000) })).ok; } catch { return false; }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function readyObservation() {
  try {
    const response = await fetch(`${base}/api/status?source=cloud`, { signal: AbortSignal.timeout(3_000) });
    const health = await response.json();
    const uiResponse = await fetch(`${base}/api/ui/features`, { signal: AbortSignal.timeout(3_000) });
    const ui = await uiResponse.json();
    return { ready: response.ok && uiResponse.ok && health.bindings?.d1 === true && health.bindings?.r2 === true &&
      health.task12?.schema_ready === true && health.task14?.schema_ready === true &&
      health.features?.task12_password_pepper === true && health.features?.task14_temporary_secret === true &&
      health.features?.task16_cloud_reads === true && ui.public_ui?.enabled === true && await healthy(`${cdp}/json/version`),
      public_ui: ui.public_ui || null };
  } catch { return { ready: false, public_ui: null }; }
}

async function waitReady(manifest) {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    if ((await readyObservation()).ready) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  manifest.status = "FAILED_READINESS";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  throw new Error("local fixture readiness timed out; all new runtime logs retained");
}

async function start() {
  assert.ok(!await exists(manifestPath) && !await exists(state) && !await exists(runtime), "fixture already exists; use status or run, do not overwrite preserved state");
  assert.ok(!await healthy(`${base}/api/status`) && !await healthy(`${cdp}/json/version`), "reserved loopback ports are already occupied");
  await mkdir(runtime, { recursive: true });
  await mkdir(privateDirectory, { recursive: true });
  // Wrangler resolves a Pages Functions project from the nearest package.json.
  // Without this private root, nested dev re-reads the developer root config.
  await writeFile(path.join(runtime, "package.json"), JSON.stringify({ name: "aeris-ui-qa-private", private: true, type: "module" }), { flag: "wx" });
  const { output } = await stagePages();
  // A running test host must not watch a later source edit or rebuild. Serve
  // the immutable per-attempt public snapshot as well as snapshot Functions.
  const servedOutput = path.join(runtime, "public");
  await cp(output, servedOutput, { recursive: true, errorOnExist: true, force: false });
  await cp(path.join(output, "functions"), path.join(runtime, "functions"), { recursive: true, errorOnExist: true, force: false });
  // Server modules share pure first-party JS with the browser. Keep the same
  // relative layout inside the isolated Functions project root.
  await cp(path.join(output, "js"), path.join(runtime, "js"), { recursive: true, errorOnExist: true, force: false });
  const rootConfig = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
  const variables = { ...rootConfig.vars,
    WYJ_ENVIRONMENT: "development", WORKERS_AI_ENABLED: "false", LEGACY_API_FALLBACK_ENABLED: "false",
    TASK16_CLOUD_READS_ENABLED: "true", TASK16_CLOUD_WRITES_ENABLED: "true",
    TASK21_NOTIFICATION_READS_ENABLED: "true", TASK21_NOTIFICATION_WRITES_ENABLED: "true",
  };
  const localConfig = {
    name: "aeris-ui-qa-local", pages_build_output_dir: servedOutput,
    compatibility_date: rootConfig.compatibility_date, send_metrics: false, vars: variables,
    d1_databases: [{ binding: "WYJ_DB", database_name: "aeris-ui-qa-local", migrations_table: "wyj_d1_migrations", migrations_dir: path.join(root, "cloudflare", "migrations") }],
    r2_buckets: [{ binding: "WYJ_STORAGE", bucket_name: "aeris-ui-qa-local" }],
  };
  assert.ok(!("ai" in localConfig) && localConfig.d1_databases.every((binding) => !binding.database_id && !binding.remote));
  await writeFile(path.join(runtime, "wrangler.jsonc"), `${JSON.stringify(localConfig, null, 2)}\n`, { flag: "wx" });
  const adminSecret = randomBytes(32).toString("base64url");
  const secrets = {
    WYJ_TASK12_PASSWORD_PEPPER: randomBytes(32).toString("base64url"),
    WYJ_TASK14_TEMPORARY_SECRET: randomBytes(32).toString("base64url"),
    WYJ_TASK20_DEVICE_SESSION_SECRET: randomBytes(32).toString("base64url"),
  };
  await writeFile(path.join(runtime, ".dev.vars"), Object.entries(secrets).map(([name, value]) => `${name}=${value}`).join("\n") + "\n", { flag: "wx" });
  await writeFile(environmentPath, `${JSON.stringify({
    WYJ_TEST_BASE: base, WYJ_BASE_URL: base, WYJ_CDP_URL: cdp,
    WYJ_TEST_ADMIN_USERNAME: "wyj", WYJ_TEST_ADMIN_SECRET: adminSecret,
    WYJ_TEST_ARTIFACT_DIR: path.join(runtime, "test-artifacts"),
    AERIS_UI_EVIDENCE_DIR: path.join(runtime, "ui-quality"),
  }, null, 2)}\n`, { flag: "wx" });
  const stamp = Date.now();
  await commandLog(`browser-fixture-migrations-${stamp}.log`, [wrangler, "d1", "migrations", "apply", "WYJ_DB", "--local", "--config", path.join(runtime, "wrangler.jsonc"), "--persist-to", state]);
  const now = new Date().toISOString();
  const passwordHash = await hashSecret(adminSecret, secrets.WYJ_TASK12_PASSWORD_PEPPER);
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const sql = `INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at)
    VALUES ('aeris-ui-qa-super-admin', 'wyj', 'wyj', ${quote(passwordHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${quote(now)}, ${quote(now)}, ${quote(now)}, ${quote(now)});
    INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
    VALUES ('p07_accessibility', 'Synthetic isolated P07 UI QA', 1, 0, '["stable","beta","experimental"]', 10000, 1, ${quote(now)}, 'aeris-ui-qa-super-admin', 'aeris-ui-local-qa', 'aeris-ui-local-qa');\n`;
  const seedPath = path.join(privateDirectory, "admin-seed.sql");
  await writeFile(seedPath, sql, { flag: "wx" });
  await commandLog(`browser-fixture-seed-${stamp}.log`, [wrangler, "d1", "execute", "WYJ_DB", "--local", "--config", path.join(runtime, "wrangler.jsonc"), "--persist-to", state, "--file", seedPath]);
  const chromeCandidates = [process.env.AERIS_QA_CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
  let chrome;
  for (const candidate of chromeCandidates) if (await exists(candidate)) { chrome = candidate; break; }
  assert.ok(chrome, "headless Chrome/Edge executable unavailable");
  const pagesPid = background(process.execPath, [wrangler, "pages", "dev", servedOutput, "--ip", "127.0.0.1", "--port", "8898", "--inspector-port", "9248", "--persist-to", state, "--show-interactive-dev-session", "false", "--log-level", "info"], path.join(runtime, "pages.log"), runtime);
  const chromePid = background(chrome, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9238", `--user-data-dir=${path.join(runtime, "chrome-profile")}`, "about:blank"], path.join(runtime, "chrome.log"), runtime);
  const manifest = {
    status: "STARTING", created_at: now, base_url: base, cdp_url: cdp,
    pages_pid: pagesPid, chrome_pid: chromePid,
    runtime: `${evidenceRelative}/runtime${suffix}`, private_environment: `${evidenceRelative}/private${suffix}/environment.json`,
    local_state: `.wrangler/aeris-ui-qa${suffix}`, output: path.relative(root, servedOutput).replaceAll("\\", "/"),
    no_remote_bindings: true, workers_ai_enabled: false, synthetic_admin: true,
    p07_local_flag: "stable/beta/experimental ON 100%; isolated synthetic DB only",
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await waitReady(manifest);
  const decision = await fetch(`${base}/api/ui/features`).then((response) => response.json());
  manifest.status = "READY";
  manifest.public_policy = decision;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: manifest.status, base_url: base, cdp_url: cdp, manifest: `${evidenceRelative}/browser-fixture${suffix}.json` }));
}

async function run(script) {
  assert.ok(script && !path.isAbsolute(script) && !script.split(/[\\/]/).includes("..") && /^(?:qa|local-backend)\/.+\.mjs$/.test(script), "choose a workspace QA or local-backend test entrypoint");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.ok(manifest.status === "READY" && processAlive(manifest.pages_pid) && processAlive(manifest.chrome_pid), "selected fixture attempt is not running; select its explicit AERIS_CI_FIXTURE_ATTEMPT");
  const environment = JSON.parse(await readFile(environmentPath, "utf8"));
  assert.ok((await readyObservation()).ready, "local fixture dependencies and public policy are not ready");
  const started = Date.now();
  const name = `${path.basename(script, ".mjs")}-${started}`;
  environment.WYJ_TEST_ARTIFACT_DIR = path.join(runtime, "test-artifacts", name);
  environment.AERIS_UI_EVIDENCE_DIR = path.join(runtime, "ui-quality", name);
  const result = spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root, env: childEnvironment(environment), encoding: "utf8", timeout: 600_000, maxBuffer: 30 * 1024 * 1024,
  });
  const log = `${result.stdout || ""}\n${result.stderr || ""}`.replaceAll(environment.WYJ_TEST_ADMIN_SECRET, "<ephemeral-admin-secret-redacted>");
  await writeFile(path.join(evidence, `${name}.log`), log, { flag: "wx" });
  const report = { script, status: result.status === 0 ? "PASS" : "FAIL", exit_code: result.status, signal: result.signal, timed_out: result.error?.code === "ETIMEDOUT", duration_ms: Date.now() - started, raw_log: `${evidenceRelative}/${name}.log`, environment: "isolated local D1/R2 + headless CDP", paid_ai_enabled: false, production_target_configured: false };
  await writeFile(path.join(evidence, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(report));
  if (result.status !== 0) process.exitCode = 1;
}

async function restartPages() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.ok(!processAlive(manifest.pages_pid), "restart-pages only resumes a stopped owned Pages process");
  assert.ok(processAlive(manifest.chrome_pid) && await healthy(`${cdp}/json/version`), "selected fixture Chrome is not running");
  assert.ok(!await healthy(`${base}/api/status`), "loopback Pages port belongs to an existing service");
  const stamp = Date.now();
  await writeFile(path.join(evidence, `browser-fixture${suffix}-before-pages-restart-${stamp}.json`), `${JSON.stringify({ ...manifest, observed_status: "NOT_READY", observed_pages_process_alive: false }, null, 2)}\n`, { flag: "wx" });
  manifest.pages_pid = background(process.execPath, [wrangler, "pages", "dev", path.join(root, manifest.output), "--ip", "127.0.0.1", "--port", "8898", "--inspector-port", "9248", "--persist-to", state, "--show-interactive-dev-session", "false", "--log-level", "info"], path.join(runtime, `pages-restart-${stamp}.log`), runtime);
  manifest.status = "STARTING";
  manifest.pages_restarts = (manifest.pages_restarts || 0) + 1;
  manifest.last_pages_restart_at = new Date().toISOString();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await waitReady(manifest);
  manifest.status = "READY";
  manifest.public_policy = await fetch(`${base}/api/ui/features`).then((response) => response.json());
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: "READY", attempt, pages_restarts: manifest.pages_restarts, state_and_chrome_preserved: true }));
}

async function stop() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const [kind, pid] of [["pages", manifest.pages_pid], ["chrome", manifest.chrome_pid]]) {
    assert.ok(Number.isInteger(pid) && pid > 0, "invalid owned process id");
    let commandLine;
    if (process.platform === "win32") {
      const snapshot = spawnSync("powershell.exe", ["-NoProfile", "-Command", `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($process) { $process.CommandLine }`], { encoding: "utf8", windowsHide: true });
      assert.equal(snapshot.status, 0, "cannot verify owned fixture process");
      commandLine = snapshot.stdout.trim();
    } else {
      try { commandLine = (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " "); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
    }
    if (!commandLine) continue;
    const normalized = commandLine.replaceAll("\\", "/").toLowerCase();
    const owned = kind === "pages"
      ? normalized.includes(wrangler.replaceAll("\\", "/").toLowerCase()) && normalized.includes("--port 8898")
      : normalized.includes(path.join(runtime, "chrome-profile").replaceAll("\\", "/").toLowerCase()) && normalized.includes("--remote-debugging-port=9238");
    assert.ok(owned, "refusing to stop a process whose identity no longer matches this fixture");
    if (process.platform === "win32") {
      const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 0, "could not stop owned fixture process tree");
    } else process.kill(-pid, "SIGTERM");
  }
  manifest.status_before_stop = manifest.status;
  manifest.status = "STOPPED";
  manifest.stopped_at = new Date().toISOString();
  manifest.runtime_and_local_data_preserved = true;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: "STOPPED", runtime_and_local_data_preserved: true }));
}

const mode = process.argv[2] || "status";
if (mode === "start" || mode === "serve") {
  await start();
  if (mode === "serve") {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    // Retain a foreground supervisor on Windows instead of relying on an
    // orphaned child to outlive the command host's process job.
    await new Promise(resolve => {
      const timer = setInterval(async () => {
        const alive = processAlive(manifest.pages_pid) && processAlive(manifest.chrome_pid);
        if (!alive) {
          clearInterval(timer);
          await writeFile(path.join(runtime, `supervisor-exit-${Date.now()}.json`), JSON.stringify({ utc: new Date().toISOString(), owned_child_exited: true }), { flag: "wx" });
          resolve();
        }
      }, 5000);
    });
  }
}
else if (mode === "run") await run(process.argv[3]);
else if (mode === "restart-pages") await restartPages();
else if (mode === "stop") await stop();
else if (mode === "status") {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const observation = await readyObservation();
  const ownedProcessesAlive = processAlive(manifest.pages_pid) && processAlive(manifest.chrome_pid);
  console.log(JSON.stringify({ attempt, snapshot_status: manifest.status, observed_status: ownedProcessesAlive && observation.ready ? "READY" : "NOT_READY", owned_processes_alive: ownedProcessesAlive, dependencies_healthy: observation.ready, base_url: base, cdp_url: cdp, public_ui: observation.public_ui }));
} else throw new Error("Use start, status, run <workspace-test.mjs>, restart-pages or stop; runtime files are always preserved");
