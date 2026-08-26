import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const checker = path.join(root, "scripts", "check_task15_cloud_only.mjs");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "wyj-task15-gate-"));

function write(relativePath, content = "") {
  const target = path.join(fixture, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function run(expected, message) {
  const result = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WYJ_TASK15_AUDIT_ROOT: fixture },
  });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  if (message) assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(message, "u"));
}

try {
  write("functions/api/[[path]].js", 'import "../_lib/cloud.mjs";\n');
  write("functions/_lib/cloud.mjs", 'const ROUTES = new Map([["POST /api/demo", {}]]);\n');
  write("app.js", 'fetch("/api/demo", { method: "POST" });\n');
  write("tools.js");
  write("workflows.js");
  write("learning-sync.js");
  const cloudVars = {
    CLOUD_READS_ENABLED: "true",
    CLOUD_WRITES_ENABLED: "true",
    TASK11_CLOUD_READS_ENABLED: "true",
    TASK11_CLOUD_WRITES_ENABLED: "true",
    TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
    TASK13_CLOUD_READS_ENABLED: "true",
    TASK13_CLOUD_WRITES_ENABLED: "true",
    TASK13_PAYMENT_PRIMARY_ENABLED: "true",
    TASK14_CLOUD_READS_ENABLED: "true",
    TASK14_CLOUD_WRITES_ENABLED: "true",
    TASK14_TEMPORARY_PRIMARY_ENABLED: "true",
    TASK14_LEGACY_WRITES_FROZEN: "true",
    TASK15_CLOUD_ONLY_ENABLED: "true",
    WORKERS_AI_ENABLED: "true",
    LEGACY_API_FALLBACK_ENABLED: "false",
  };
  const importVars = {
    TASK11_IMPORT_ENABLED: "false",
    TASK11_PRODUCTION_IMPORT_ENABLED: "false",
    TASK12_IMPORT_ENABLED: "false",
    TASK12_PRODUCTION_IMPORT_ENABLED: "false",
    TASK13_IMPORT_ENABLED: "false",
    TASK13_PRODUCTION_IMPORT_ENABLED: "false",
    TASK14_IMPORT_ENABLED: "false",
    TASK14_PRODUCTION_IMPORT_ENABLED: "false",
    TASK15_IMPORT_ENABLED: "false",
    TASK15_PRODUCTION_IMPORT_ENABLED: "false",
  };
  write("wrangler.jsonc", JSON.stringify({
    env: {
      preview: { vars: cloudVars },
      production: { vars: { ...cloudVars, ...importVars } },
    },
  }));
  run(0, "cloud-only gate passed");

  write("functions/_lib/cloud.mjs", 'const upstream = "http://127.0.0.1:8765";\n');
  run(1, "local Python endpoint");

  write("functions/_lib/cloud.mjs", 'const ROUTES = new Map([["POST /api/demo", {}]]);\n');
  write("app.js", 'fetch("/api/not-cloud");\n');
  run(1, "no Cloudflare handler");

  write("app.js", 'fetch("/api/demo"); if (response.status === 401) clearSession();\n');
  run(1, "generic HTTP 401");

  write("app.js", 'fetch("/api/demo");\n');
  write("wrangler.jsonc", JSON.stringify({
    env: {
      preview: { vars: cloudVars },
      production: { vars: { ...cloudVars, ...importVars, WORKERS_AI_ENABLED: "false" } },
    },
  }));
  run(1, "production.WORKERS_AI_ENABLED");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log("Task 15 cloud-only gate self-tests: 5 passed");
