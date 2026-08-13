import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checker = path.join(root, "scripts", "check_js_module_graph.mjs");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "wyj-module-graph-"));

function write(relativePath, content = "") {
  const target = path.join(fixture, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function check(expectedStatus, expectedMessage = "") {
  const result = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WYJ_MODULE_GRAPH_ROOT: fixture },
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  if (expectedMessage) assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expectedMessage));
}

try {
  write("app.js", 'import "./js/core/a.js";\n');
  write("tools.js");
  write("js/core/a.js");
  check(0, "no cycles");

  write("js/core/a.js", 'import "./b.js";\n');
  write("js/core/b.js", 'import "./a.js";\n');
  check(1, "circular dependency");

  write("js/core/a.js", 'import "../language/quiz.js";\n');
  write("js/core/b.js");
  write("js/language/quiz.js");
  check(1, "core dependency points outward");

  write("js/core/a.js", 'import "./missing.js";\n');
  check(1, "imports missing module");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log("ES module graph checker self-tests: 4 passed");
