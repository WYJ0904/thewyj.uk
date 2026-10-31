import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportDirectory = process.argv[2] || "artifacts/aeris-release/node-regression";
assert.ok(!path.isAbsolute(reportDirectory) && !reportDirectory.split(/[\\/]/).includes(".."));
assert.notEqual(reportDirectory.replaceAll("\\", "/").split("/")[0].toLowerCase(), ".wrangler", "test evidence must stay outside deploy output");
const output = path.join(root, reportDirectory);
await mkdir(output, { recursive: true });

const names = (await readdir(path.join(root, "local-backend"))).filter((name) => /^test_.+\.mjs$/.test(name)).sort();
const browserNames = names.filter((name) => name.includes("_browser") || name.endsWith("_responsive.mjs"));
const scripts = names.filter((name) => !browserNames.includes(name)).map((name) => `local-backend/${name}`);
scripts.push(
  "scripts/check_js_module_graph.mjs", "scripts/check_storage_contract.mjs", "scripts/check_task15_cloud_only.mjs",
  "qa/task25/release-validation.mjs", "qa/task25/download-validation.mjs",
  "qa/task26/multi-window-client.mjs", "qa/task26/account-deletion-local.mjs", "qa/task26/durable-outbox-client.mjs",
);
const commands = [];
for (const [index, script] of scripts.entries()) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [script], {
    cwd: root, encoding: "utf8", timeout: 180_000, maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, NO_PROXY: "127.0.0.1,localhost" },
  });
  const rawLog = `${String(index + 1).padStart(2, "0")}-${path.basename(script, ".mjs")}.log`;
  await writeFile(path.join(output, rawLog), `${result.stdout || ""}\n${result.stderr || ""}`);
  commands.push({
    command: `node ${script}`, script, exit_code: result.status, signal: result.signal,
    status: result.status === 0 ? "PASS" : "FAIL", timed_out: result.error?.code === "ETIMEDOUT",
    duration_ms: Date.now() - started, raw_log: `${reportDirectory}/${rawLog}`,
    script_sha256: createHash("sha256").update(await readFile(path.join(root, script))).digest("hex"),
  });
  console.log(`[${index + 1}/${scripts.length}] ${script}: ${commands.at(-1).status}`);
  await writeFile(path.join(output, "commands.json"), `${JSON.stringify({
    scope: "local isolated Node entrypoints; command counts are not assertion counts",
    node_version: process.version,
    command_count: commands.length, pass: commands.filter((row) => row.status === "PASS").length,
    fail: commands.filter((row) => row.status === "FAIL").length, commands,
    browser_entrypoints: browserNames.map((name) => ({
      script: `local-backend/${name}`, status: "REQUIRES_BROWSER_FIXTURE",
      requirements: ["loopback Pages/backend fixture", "WYJ_TEST_BASE", "WYJ_CDP_URL", "synthetic administrator"],
      ci_job: name === "test_app_browser.mjs" ? "browser-tests" : "cloud-only-browser-test",
    })),
  }, null, 2)}\n`);
}
if (commands.some((row) => row.status !== "PASS")) process.exitCode = 1;
