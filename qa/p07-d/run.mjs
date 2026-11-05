// Isolated P07-D runner, derived from the existing Phase 1 QA runner.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from 'node:net';
import { hashSecret } from "../../functions/_lib/task12-crypto.mjs";
import { stagePages } from "../../scripts/stage_pages_deploy.mjs";
import { CdpClient, delay } from "../../local-backend/browser_harness.mjs";
import { Miniflare } from "miniflare";
import { PAYMENT_METHODS, PURCHASABLE_PLAN_CODES, qrObjectKeyFor } from "../../functions/_lib/task13-model.mjs";
import {ttsCacheKey,TTS_DEFAULT_MODEL,TTS_FALLBACK_MODEL} from '../../functions/_lib/tts-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TARGET_ROOT=path.resolve(process.env.P07_D_TARGET_ROOT||ROOT);
const TARGET_SOURCE_HEAD=spawnSync('git',['rev-parse','HEAD'],{cwd:TARGET_ROOT,encoding:'utf8'}).stdout.trim();
const PINNED_TARGETS=new Map([
  ['p07-round3-red-baseline','21b83316cbfdeb366c587b9e818a2c64e2199215'],
  ['p07-round3-flash-review','fb936d109d0900d02d35eb3493212e4c32c39699'],
  ['p07-round3-final-ci-review','f7949f8253f51ea2621c397743208971c0cec467'],
]);
if(TARGET_ROOT!==ROOT){
  const targetName=path.basename(path.dirname(TARGET_ROOT));
  assert.equal(TARGET_SOURCE_HEAD,PINNED_TARGETS.get(targetName),
    `External source ${targetName} must match its pinned Round 3 SHA`);
  assert.equal(spawnSync('git',['status','--porcelain','--untracked-files=no'],{cwd:TARGET_ROOT,encoding:'utf8'}).stdout.trim(),'',
    'Pinned product source must have no tracked edits');
}
const LABEL = process.env.P07_D_RUN || "baseline";
assert.match(LABEL, /^[a-z0-9-]+$/);
const EVIDENCE_DIR = path.join(ROOT, "docs/migration-evidence/p07-d", LABEL);
assert.ok(!await exists(EVIDENCE_DIR), "Evidence labels cannot be overwritten");
const QA_WORK_ROOT = path.join(ROOT, ".wrangler", `p07-round3-qa-${LABEL}-${Date.now()}`);
const RUNTIME_DIR = path.join(QA_WORK_ROOT, "runtime");
const STATE_DIR = path.join(QA_WORK_ROOT, "state");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const BASE_URL = new URL(process.env.AERIS_PHASE1_BASE_URL || "http://127.0.0.1:18949").origin;
const CDP_URL = new URL(process.env.AERIS_PHASE1_CDP_URL || "http://127.0.0.1:19349").origin;
assert.equal(new URL(BASE_URL).hostname, "127.0.0.1", "Local fixture requires loopback");
assert.equal(new URL(CDP_URL).hostname, "127.0.0.1", "Local browser requires loopback");
const ONLY_APP_BROWSER = process.argv.includes("--only-app-browser");
const WITH_APP_BROWSER = process.argv.includes("--with-app-browser") || ONLY_APP_BROWSER;
const OFFLINE = process.argv.includes("--offline-rubric");
const AUDIO_CACHE = process.argv.includes('--offline-audio-cache');
const INTERACTIONS = process.argv.includes("--interactions");
const TOOLS = process.argv.includes("--tools");
const AUDIT = process.argv.includes("--audit");
const ZOOM_ONLY=process.argv.includes('--zoom-only');
const COMPILED=process.argv.includes('--compiled-runtime');
const CANDIDATES=process.argv.includes('--review-candidates');
const MATRIX = process.argv.includes("--matrix") || INTERACTIONS;
const ONLY_INDEPENDENT = process.argv.includes("--only-independent");
const ROUND3 = process.argv.includes("--round3");
const PREVIEW_READONLY = process.argv.includes('--preview-readonly');
const P4_WORKSPACE = process.argv.includes('--p4-workspace');
const LAYOUT_SUPPLEMENT = process.argv.includes('--layout-supplement');
const CACHE_UPGRADE = process.argv.includes('--cache-upgrade');
const PRIMARY_WORKSPACES = process.argv.includes('--primary-workspaces');
const FLAG_OFF = process.argv.includes("--flag-off");
const KILL_SWITCH = process.argv.includes("--kill-switch");
const FLAG_MODE = KILL_SWITCH ? "kill_switch" : FLAG_OFF ? "off" : "on";
assert.ok(!(FLAG_OFF&&KILL_SWITCH),'Choose exactly one P07 OFF mode');
assert.ok(!(ROUND3&&(ONLY_APP_BROWSER||WITH_APP_BROWSER||MATRIX||INTERACTIONS||TOOLS||AUDIT||ONLY_INDEPENDENT||ZOOM_ONLY)),
  'Round 3 browser checks run as a dedicated suite');
if(ROUND3||P4_WORKSPACE||LAYOUT_SUPPLEMENT||CACHE_UPGRADE||PRIMARY_WORKSPACES){
  assert.equal(COMPILED,true,'Round 3 requires the actual compiled Pages runtime');
  assert.ok(!OFFLINE&&!AUDIO_CACHE&&!CANDIDATES,'Round 3 forbids rubric, audio and product candidate overlays');
  assert.notEqual(TARGET_ROOT,ROOT,'Round 3 requires a clean pinned product-source worktree');
}

function cleanChildEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const name of Object.keys(env)) {
    if (/^(?:CLOUDFLARE_|CF_API_|CF_ACCOUNT_|OPENAI_|ANTHROPIC_|GEMINI_)/i.test(name)) {
      delete env[name];
    }
  }
  const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path');
  const systemPath=pathKey?env[pathKey]:'';
  for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];
  env[process.platform==='win32'?'Path':'PATH']=`${path.dirname(process.execPath)}${path.delimiter}${systemPath}`;
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
    const ownerMarker=path.basename(QA_WORK_ROOT);
    const probe=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if($p -and $p.CommandLine.Contains('${ownerMarker}')) { Write-Output 'OWNED' }`],
      {windowsHide:true,encoding:'utf8'});
    if(probe.stdout?.trim()==='OWNED')spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
  }
}

async function runBrowserZoomProof(chromeExe, suiteEnv) {
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
      for (const [route,theme] of [["/","light"],["/login","light"],["/","dark"],["/login","dark"]]) {
        await pageClient.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
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
        // Native HostZoomMap must leave the original controls keyboard reachable,
        // visible, and unobscured at 200%/400%, in both color schemes.
        await evalExpr("document.body.tabIndex=-1;document.body.focus();document.body.removeAttribute('tabindex');true");
        const expected = route === "/login" ? ["usernameInput","secretInput","loginSubmitBtn"] : ["learning","finance","tools"];
        const focused = [];
        for (let step=0;step<70&&new Set(focused.map(row=>row.target)).size<expected.length;step++) {
          for (const type of ["keyDown","keyUp"]) await pageClient.send("Input.dispatchKeyEvent", { type,key:"Tab",code:"Tab",windowsVirtualKeyCode:9 });
          await delay(80);
          const focus = await evalExpr(`(() => {const e=document.activeElement,target=e.dataset?.homeWidgetOpen||e.id;
            if(!${JSON.stringify(expected)}.includes(target))return null;const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),s=getComputedStyle(e);
            return {target,hit:hit?.id||hit?.className||hit?.tagName,hit_notice:!!hit?.closest('#versionNotice'),rect:{x:r.x,y:r.y,width:r.width,height:r.height},visible:e===hit||e.contains(hit),in_viewport:r.x>=-1&&r.right<=innerWidth+1&&Math.min(r.bottom,innerHeight)-Math.max(r.y,0)+1>=Math.min(44,r.height),
              focus_visible:e.matches(':focus-visible'),focus_style:s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0||s.boxShadow!=='none'};})()`);
          if(focus){focused.push(focus);if(!focus.visible){
            const failureShot=await pageClient.send('Page.captureScreenshot',{format:'png'});
            await fsp.writeFile(path.join(EVIDENCE_DIR,`focus-${factor*100}-${route==='/'?'home':'login'}-${theme}-${focus.target}.png`),Buffer.from(failureShot.data,'base64'));
          }}
        }
        const shot = await pageClient.send("Page.captureScreenshot", { format:"png" });
        await fsp.writeFile(path.join(EVIDENCE_DIR,`${route==="/"?"home":"login"}-native-zoom-${factor*100}-${theme}.png`),Buffer.from(shot.data,"base64"));
        const focusPass=new Set(focused.map(row=>row.target)).size===expected.length&&focused.every(row=>row.visible&&row.in_viewport&&row.focus_visible&&row.focus_style);
        routeChecks.push({...m,theme,focused,status:focusPass?'PASS':'FAIL'});
        await fsp.writeFile(path.join(EVIDENCE_DIR,`focus-zoom-${factor*100}.json`),JSON.stringify(routeChecks,null,2));
      }
      assert.deepEqual(runtimeErrors, []);
      let business;
      if(MATRIX){
        const run=spawnSync(process.execPath,[path.join(ROOT,'qa/p07-d/browser-matrix.mjs')],{
          cwd:ROOT,env:cleanChildEnv({...suiteEnv,WYJ_CDP_URL:endpoint,P07_D_NATIVE_ZOOM:String(factor),P07_D_ZOOM_ONLY:'true'}),
          encoding:'utf8',timeout:300000,maxBuffer:15*1024*1024});
        await fsp.writeFile(path.join(EVIDENCE_DIR,`matrix-native-zoom-${factor*100}.log`),`${run.stdout}\n${run.stderr}`);
        business={status:run.status===0?'PASS':'FAIL',exit:run.status};
      }
      results.push({ factor, percent: `${factor * 100}%`, status: routeChecks.every(row=>row.status==='PASS')&&business?.status!=='FAIL'?"PASS":"FAIL", routeChecks,business });
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
  assert.ok(results.every(row=>row.status==='PASS'),'Business native zoom checks failed; inspect per-route evidence');
  return results;
}

let pagesPid = 0;
let chromePid = 0;

try {
  // Reject occupied service, CDP AND inspector ports, even if they do not
  // answer the HTTP health paths. Never stop an existing service to claim one.
  for(const port of [Number(new URL(BASE_URL).port),Number(new URL(CDP_URL).port),Number(new URL(CDP_URL).port)+10]){
    await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);
      server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(resolve));});
  }
  assert.ok(!(await healthy(`${BASE_URL}/api/status`)), `Port 18898 already occupied`);
  assert.ok(!(await healthy(`${CDP_URL}/json/version`)), `Port 19238 already occupied`);

  await fsp.mkdir(RUNTIME_DIR, { recursive: true });
  console.log(JSON.stringify({source_sha:spawnSync("git",["rev-parse","HEAD"],{cwd:TARGET_ROOT,encoding:"utf8"}).stdout.trim(),offline_rubric:OFFLINE,work_root:QA_WORK_ROOT,evidence:EVIDENCE_DIR}));
  await fsp.mkdir(STATE_DIR, { recursive: true });
  await fsp.mkdir(EVIDENCE_DIR, { recursive: true });
  const driverFiles=['qa/p07-d/run.mjs','qa/p07-d/serve.mjs','qa/p07-round3/browser.mjs','qa/p07-round3/preview-readonly.mjs','qa/p07-round3/layout-supplement.mjs','qa/p07-round3/cache-upgrade.mjs','qa/p07-round3/primary-workspaces.mjs','qa/p07-round3/account-workspace-contract.mjs','qa/aeris/p4-behavior-browser.mjs','local-backend/browser_harness.mjs'];
  const driverHashes={};
  for(const file of driverFiles)driverHashes[file]=createHash('sha256').update(await fsp.readFile(path.join(ROOT,file))).digest('hex');
  await fsp.writeFile(path.join(EVIDENCE_DIR,'driver-manifest.json'),JSON.stringify({files:driverHashes,
    inherited_framework_commit:'0f2050bc8b76cfe2a6a8f2daf623d2dbafd6dd9e',
    source_sha:TARGET_SOURCE_HEAD,flag_mode:FLAG_MODE,product_overlays:false},null,2));

  await fsp.writeFile(
    path.join(RUNTIME_DIR, "package.json"),
    JSON.stringify({ name: "aeris-p07-phase1-qa", private: true, type: "module" })
  );

  const { output,files } = await stagePages({root:TARGET_ROOT});
  const hashes={};
  for(const relative of files)hashes[relative]=createHash('sha256').update(await fsp.readFile(path.join(output,relative))).digest('hex');
  await fsp.writeFile(path.join(EVIDENCE_DIR,'source-manifest.json'),JSON.stringify({
    sha:spawnSync('git',['rev-parse','HEAD'],{cwd:TARGET_ROOT,encoding:'utf8'}).stdout.trim(),files:hashes,
    synthetic_only:true,ai_binding:false,production_operations:0},null,2));
  const servedOutput = path.join(RUNTIME_DIR, "public");
  await fsp.cp(output, servedOutput, { recursive: true });
  await fsp.cp(path.join(output, "functions"), path.join(RUNTIME_DIR, "functions"), { recursive: true });
  await fsp.cp(path.join(output, "js"), path.join(RUNTIME_DIR, "js"), { recursive: true });
  if(CANDIDATES){assert.notEqual(TARGET_ROOT,ROOT,'Candidate overlays are for the pinned Flash review only');
    const {installCandidateOverlays}=await import('./candidate-overlays.mjs');await installCandidateOverlays(RUNTIME_DIR,EVIDENCE_DIR);}
  if(OFFLINE) {const {installOfflineRubric}=await import("./offline-rubric.mjs");await installOfflineRubric(RUNTIME_DIR,EVIDENCE_DIR);}

  const rootConfig = JSON.parse(await fsp.readFile(path.join(TARGET_ROOT, "wrangler.jsonc"), "utf8"));
  const localConfig = {
    name: "aeris-p07-phase1-local",
    pages_build_output_dir: servedOutput,
    compatibility_date: rootConfig.compatibility_date,
    send_metrics: false,
    vars: {
      ...rootConfig.vars,
      WYJ_ENVIRONMENT: "development",
      WORKERS_AI_ENABLED: "false",
      P07_D_ISOLATED_RUBRIC: OFFLINE ? "synthetic-browser-only" : "off",
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
        migrations_dir: path.join(TARGET_ROOT, "cloudflare", "migrations"),
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
  let mig = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "migrations", "apply", "WYJ_DB", "--local", "--config", path.join(RUNTIME_DIR, "wrangler.jsonc"), "--persist-to", STATE_DIR],
    { cwd: ROOT, env: cleanChildEnv(), encoding: "utf8", timeout: 180_000 }
  );
  await fsp.writeFile(path.join(EVIDENCE_DIR,'migrations-first.log'),`${mig.stdout}\n${mig.stderr}`);
  if(mig.status!==0&&/bad port/.test(`${mig.stdout}\n${mig.stderr}`)){
    // Continue the SAME local migration ledger once. No successful SQL or
    // business mutation is replayed and the first FAIL_ENV remains recorded.
    mig=spawnSync(process.execPath,[WRANGLER,'d1','migrations','apply','WYJ_DB','--local','--config',path.join(RUNTIME_DIR,'wrangler.jsonc'),'--persist-to',STATE_DIR],
      {cwd:ROOT,env:cleanChildEnv(),encoding:'utf8',timeout:180000});
    await fsp.writeFile(path.join(EVIDENCE_DIR,'migrations-resume.log'),`${mig.stdout}\n${mig.stderr}`);
  }
  assert.equal(mig.status, 0, `D1 local migration failed:\n${mig.stdout}\n${mig.stderr}`);

  // Seed synthetic admin + Task25 p07_accessibility flag ON in isolated local DB
  const now = new Date().toISOString();
  const pwHash = await hashSecret(adminSecret, secrets.WYJ_TASK12_PASSWORD_PEPPER);
  const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
  const seedSql = `
    INSERT INTO task12_users (id, username, username_normalized, password_hash, password_scheme, password_iterations, role, registered_at, created_at, updated_at, source_updated_at)
    VALUES ('aeris-p07-phase1-admin', 'wyj', 'wyj', ${q(pwHash)}, 'pbkdf2_sha256', 310000, 'super_admin', ${q(now)}, ${q(now)}, ${q(now)}, ${q(now)});
    INSERT INTO task25_feature_flags (flag_key, description, enabled, kill_switch, channels_json, rollout_basis_points, revision, updated_at, updated_by, mutation_id, request_id)
    VALUES ('p07_accessibility', 'Isolated P07 Round 3 QA', ${FLAG_OFF ? 0 : 1}, ${KILL_SWITCH ? 1 : 0}, '["stable","beta","experimental"]', 10000, 1, ${q(now)}, 'aeris-p07-phase1-admin', 'p07-round3-seed', 'p07-round3-seed');
  `;
  const seedFile = path.join(QA_WORK_ROOT, "seed.sql");
  await fsp.writeFile(seedFile, seedSql);
  const seeded = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", "WYJ_DB", "--local", "--config", path.join(RUNTIME_DIR, "wrangler.jsonc"), "--persist-to", STATE_DIR, "--file", seedFile],
    { cwd: ROOT, env: cleanChildEnv(), encoding: "utf8", timeout: 90_000 }
  );
  assert.equal(seeded.status, 0, `D1 local seed failed:\n${seeded.stdout}\n${seeded.stderr}`);

  if (WITH_APP_BROWSER || ROUND3) {
    // The complete browser matrix reads protected QR PNG objects. Seed the same
    // synthetic PNG used by that test into actual local R2, with no remote binding.
    const localR2 = new Miniflare({ modules:true,script:'export default{fetch(){return new Response("local fixture")}}',
      compatibilityDate:rootConfig.compatibility_date,r2Buckets:{WYJ_STORAGE:"aeris-p07-phase1-local"},resourcePersistencePath:path.join(STATE_DIR,"v3") });
    try {
      const bucket = await localR2.getR2Bucket("WYJ_STORAGE");
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
      let count=0;
      for(const method of PAYMENT_METHODS)for(const plan of [...PURCHASABLE_PLAN_CODES,"dual_language_lifetime"]){
        await bucket.put(qrObjectKeyFor(method.code,plan),png,{httpMetadata:{contentType:"image/png"},customMetadata:{fixture:"synthetic-local-browser"}});count++;
      }
      await fsp.writeFile(path.join(QA_WORK_ROOT,"r2-fixture.json"),JSON.stringify({local_only:true,synthetic:true,objects:count,real_payment:false}));
      if(AUDIO_CACHE){
        // A deliberately silent 100ms PCM WAV proves cache transport/player UI
        // only. It is not pronunciation or actual listening-quality evidence.
        const wav=Buffer.alloc(44+1600);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
        wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);
        wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40);
        const cacheRows=[];
        for(const [text,language] of [['hello','en'],['はな','jp'],['みず','jp']])for(const model of [TTS_DEFAULT_MODEL,TTS_FALLBACK_MODEL]){
          const key=await ttsCacheKey({text,language,voice:'default',model});
          await bucket.put(key,wav,{httpMetadata:{contentType:'audio/wav'},customMetadata:{fixture:'p07-d-synthetic-silence'}});
          cacheRows.push({text,language,model,key});
        }
        await fsp.writeFile(path.join(EVIDENCE_DIR,'audio-cache-fixture.json'),JSON.stringify({synthetic:true,silent:true,milliseconds:100,
          real_inference_calls:0,linguistic_quality:'NOT_TESTED',sha256:createHash('sha256').update(wav).digest('hex'),cacheRows},null,2));
      }
    }finally{await localR2.dispose();}
  }

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
  if(COMPILED){
    await fsp.copyFile(path.join(EVIDENCE_DIR,'source-manifest.json'),path.join(RUNTIME_DIR,'qa-source-manifest.json'));
    const build=spawnSync(process.execPath,[WRANGLER,'pages','functions','build',path.join(RUNTIME_DIR,'functions'),'--outfile',path.join(RUNTIME_DIR,'pages-worker.mjs'),'--compatibility-date',rootConfig.compatibility_date],
      {cwd:RUNTIME_DIR,env:cleanChildEnv(),encoding:'utf8',timeout:90000});
    await fsp.writeFile(path.join(EVIDENCE_DIR,'compiled-runtime-build.log'),`${build.stdout}\n${build.stderr}`);
    assert.equal(build.status,0,'Compile actual Pages Functions');
  }
  const pagesProc = spawn(
    process.execPath,
    COMPILED?[path.join(ROOT,'qa/p07-d/serve.mjs'),RUNTIME_DIR,STATE_DIR,new URL(BASE_URL).port]:[
      WRANGLER,
      "pages",
      "dev",
      servedOutput,
      "--ip",
      "127.0.0.1",
      "--port",
      new URL(BASE_URL).port,
      "--inspector-port",
      String(Number(new URL(CDP_URL).port) + 10),
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
  await fsp.writeFile(path.join(EVIDENCE_DIR,'runtime-tier.json'),JSON.stringify({
    tier:COMPILED?'actual-compiled-pages-on-pinned-miniflare':'wrangler-pages-dev',
    source_sha:spawnSync('git',['rev-parse','HEAD'],{cwd:TARGET_ROOT,encoding:'utf8'}).stdout.trim(),
    candidate_overlays:CANDIDATES,artificial_rubric:OFFLINE,synthetic_silent_audio_cache:AUDIO_CACHE,real_model_calls:0,production_operations:0},null,2));

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
      `--remote-debugging-port=${new URL(CDP_URL).port}`,
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
        if (uiJson.public_ui?.enabled === (FLAG_MODE === 'on')) {
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
    P07_D_EVIDENCE: EVIDENCE_DIR,
    P07_D_TARGET_HEAD: TARGET_SOURCE_HEAD,
    P07_D_OFFLINE: String(OFFLINE),
    P07_D_FLAG_MODE: FLAG_MODE,
    P07_D_INTERACTION_ONLY: String(INTERACTIONS),
    HOME_WIDGET_OUTPUT: path.join(EVIDENCE_DIR, "after-home-widgets.json"),
    AERIS_PHASE1_EVIDENCE_DIR: EVIDENCE_DIR,
    AERIS_P4_BEHAVIOR_OUTPUT:path.join(EVIDENCE_DIR,'p4-workspace-behavior.json'),
  });

  const suiteReports = [];
  const p4Suite=[['p4-workspace-behavior','qa/aeris/p4-behavior-browser.mjs']];
  const primarySuite=[['primary-workspaces','qa/p07-round3/primary-workspaces.mjs']];
  const suites = ZOOM_ONLY ? [] : CACHE_UPGRADE ? [['cache-upgrade','qa/p07-round3/cache-upgrade.mjs']] : LAYOUT_SUPPLEMENT ? [['layout-supplement','qa/p07-round3/layout-supplement.mjs']] : ROUND3 ? [["p07-round3-browser","qa/p07-round3/browser.mjs"],...(PRIMARY_WORKSPACES?primarySuite:[]),...(P4_WORKSPACE?p4Suite:[]),...(PREVIEW_READONLY?[["p07-round3-preview-readonly","qa/p07-round3/preview-readonly.mjs"]]:[])] : PRIMARY_WORKSPACES ? primarySuite : P4_WORKSPACE ? p4Suite : AUDIT ? [["audit-regression","qa/p07-d/audit-regression.mjs"]] : TOOLS ? [["tools-browser","local-backend/test_tools_browser.mjs"]] : MATRIX ? [["p07-d-matrix", "qa/p07-d/browser-matrix.mjs"]] : ONLY_APP_BROWSER ? [["test-app-browser", "qa/p07-d/app-browser.mjs"]] : ONLY_INDEPENDENT ? [["independent-browser-gaps", "qa/p07-phase1/independent-browser-gaps.mjs"]] : [
    ["home-widgets-browser", "qa/aeris/home-widgets-browser.mjs"],
    ["phase1-browser-verify", "qa/p07-phase1/phase1-browser-verify.mjs"],
    ...(process.argv.includes("--independent-qa") ? [["independent-browser-gaps", "qa/p07-phase1/independent-browser-gaps.mjs"]] : []),
    ...(WITH_APP_BROWSER ? [["test-app-browser", "qa/p07-d/app-browser.mjs"]] : []),
  ];

  for (const [label, relScript] of suites) {
    console.log(`RUN ${label}`);
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
    await fsp.writeFile(path.join(QA_WORK_ROOT,`${label}.log`),`${run.stdout||""}\n${run.stderr||""}`);
    await fsp.writeFile(path.join(EVIDENCE_DIR,`${label}.log`),`${run.stdout}\n${run.stderr}`);
    await fsp.writeFile(path.join(EVIDENCE_DIR,"suites.json"),JSON.stringify(suiteReports,null,2));
    if (run.status !== 0) {
      console.error(`Suite ${label} (${relScript}) failed (exit ${run.status}):\n${run.stdout}\n${run.stderr}`);
    }
  }

  // Real Chromium profile 100% / 200% / 400% page zoom verification
  const zoomStart = Date.now();
  if (!ROUND3 && !P4_WORKSPACE && !LAYOUT_SUPPLEMENT && !CACHE_UPGRADE && !PRIMARY_WORKSPACES && !ONLY_INDEPENDENT && !ONLY_APP_BROWSER && !INTERACTIONS && !TOOLS && !AUDIT) try {
    await runBrowserZoomProof(chromeExe, suiteEnv);
    suiteReports.push({suite:"browser-zoom-400",script:"Chromium HostZoomMap 100%/200%/400%",status:"PASS",durationMs:Date.now()-zoomStart});
  } catch (error) {
    suiteReports.push({suite:"browser-zoom-400",status:"FAIL",durationMs:Date.now()-zoomStart,error:error.stack});
  }
  const ok=suiteReports.every(row=>row.status==="PASS");
  await fsp.writeFile(path.join(EVIDENCE_DIR,'suites.json'),JSON.stringify(suiteReports,null,2));
  console.log(JSON.stringify({ ok, suites: suiteReports }, null, 2));
  if(!ok)process.exitCode=1;
} finally {
  killOwnedPid(pagesPid);
  killOwnedPid(chromePid);
}
