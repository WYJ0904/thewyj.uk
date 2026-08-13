import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { File } from "node:buffer";
import { webcrypto } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE = fs.readFileSync(path.join(ROOT, "workflows.js"), "utf8");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(field); field = ""; }
    else if (!quoted && char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some(Boolean) || !rows.length) rows.push(row);
  return rows;
}

function csvString(rows) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",")).join("\r\n");
}

function createRuntime(entitlements = ["tools_access", "tools_batch_access", "save_tool_config"], options = {}) {
  const storage = new Map();
  const account = { id: "test-user", role: "user", entitlements };
  const context = vm.createContext({
    AbortController,
    Blob,
    File,
    Map,
    Math,
    Object,
    Set,
    TextDecoder,
    TextEncoder,
    URL,
    Uint8Array,
    crypto: webcrypto,
    performance,
    setTimeout,
    clearTimeout,
    console,
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
  });
  context.window = context;
  context.WYJTools = {
    primitives: {
      async decodeLocalText(file) {
        if (options.decodeDelay) await new Promise((resolve) => setTimeout(resolve, options.decodeDelay));
        return file.text();
      },
      runTextOperation(toolId, input, _secondary, _parameter, option) {
        if (options.failTool === toolId) throw new Error("fixture failure");
        const lines = String(input).replace(/\r\n?/g, "\n").split("\n");
        if (toolId === "remove-empty-lines") return lines.filter((line) => line.trim()).join("\n");
        if (toolId === "dedupe-lines") return [...new Set(lines)].join("\n");
        if (toolId === "sort-lines") return [...lines].sort((a, b) => option === "desc" ? b.localeCompare(a) : a.localeCompare(b)).join("\n");
        return input;
      },
      parseCsv,
      csvString,
      validateCsvTable(rows) {
        if (!rows.length || rows.some((row) => row.length !== rows[0].length)) throw new Error("invalid CSV");
        return rows;
      },
      zipBlob(entries) { return new Blob(entries.map((entry) => entry.data), { type: "application/zip" }); },
      bitmapFromFile: options.bitmapFromFile || (async () => { throw new Error("image fixture not installed"); }),
      imageCanvas: options.imageCanvas || (async () => { throw new Error("image fixture not installed"); }),
      canvasBlob: options.canvasBlob || (async () => { throw new Error("image fixture not installed"); }),
      stripJpegMetadata: (bytes) => bytes,
      releaseBitmap: () => {},
    },
  };
  vm.runInContext(SOURCE, context, { filename: "workflows.js" });
  context.WYJWorkflows.init({ account: () => account, accountId: () => account.id });
  context.WYJWorkflows.setAccess({ offline: false, access: { account } });
  const inside = (value) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context);
  return { context, workflow: context.WYJWorkflows, inside };
}

function changed(runtime, value, mutate) {
  const copy = runtime.inside(value);
  mutate(copy);
  return copy;
}

let checks = 0;
const pass = () => { checks += 1; };

{
  const runtime = createRuntime();
  const valid = runtime.workflow.core.workflowFromTemplate("text-clean");
  assert.equal(runtime.workflow.core.validateWorkflow(valid).steps.length, 4);
  assert.equal(runtime.workflow.registry["sort-lines"].config_schema.order.default, "asc");
  pass();

  assert.throws(() => runtime.workflow.core.validateWorkflow(changed(runtime, valid, (value) => { value.schema_version = 99; })), /版本/);
  assert.throws(() => runtime.workflow.core.validateWorkflow(changed(runtime, valid, (value) => { value.steps[0].tool_id = "unknown-tool"; })), /未注册/);
  assert.throws(() => runtime.workflow.core.validateWorkflow(changed(runtime, valid, (value) => { value.steps[1].id = value.steps[0].id; })), /重复/);
  assert.throws(() => runtime.workflow.core.validateWorkflow(changed(runtime, valid, (value) => { value.steps[3].config.order = "sideways"; })), /无效/);
  assert.throws(() => runtime.workflow.core.validateWorkflow(changed(runtime, valid, (value) => { value.steps[1].tool_id = "files-zip"; value.steps[1].config = {}; })), /不兼容/);
  assert.throws(() => runtime.workflow.core.validateWorkflow(changed(runtime, valid, (value) => { value.payload = "x".repeat(60 * 1024); })), /48 KB/);
  assert.throws(() => runtime.workflow.core.validateWorkflow(changed(runtime, valid, (value) => {
    value.steps = Array.from({ length: 21 }, (_, index) => ({ ...value.steps[1], id: `step_${String(index).padStart(6, "0")}` }));
  })), /20/);
  pass();
}

{
  const runtime = createRuntime();
  const workflow = runtime.workflow.core.workflowFromTemplate("text-clean");
  const statuses = [];
  const input = runtime.workflow.core.createResource("text-file", new File(["beta\n\nalpha\nbeta\n"], "input.txt", { type: "text/plain" }));
  const result = await runtime.workflow.core.executeWorkflow(workflow, input, { onStatus: (value) => statuses.push(value) });
  assert.equal(result.output.type, "text");
  assert.equal(result.output.value, "alpha\nbeta");
  assert.deepEqual(Array.from(result.statuses, (item) => item.status), ["success", "success", "success", "success"]);
  assert.ok(statuses.some((value) => value.some((item) => item.status === "running")));
  pass();
}

{
  const runtime = createRuntime();
  const workflow = runtime.workflow.core.workflowFromTemplate("text-clean");
  workflow.steps[2].enabled = false;
  const input = runtime.workflow.core.createResource("text-file", new File(["b\nb\na"], "input.txt", { type: "text/plain" }));
  const result = await runtime.workflow.core.executeWorkflow(workflow, input);
  assert.equal(result.output.value, "a\nb\nb");
  assert.equal(result.statuses[2].status, "skipped");
  pass();
}

{
  const runtime = createRuntime(["tools_access"], { failTool: "sort-lines" });
  const workflow = runtime.workflow.core.workflowFromTemplate("text-clean");
  const statuses = [];
  await assert.rejects(
    runtime.workflow.core.executeWorkflow(
      workflow,
      runtime.workflow.core.createResource("text-file", new File(["b\na"], "input.txt")),
      { onStatus: (value) => statuses.splice(0, statuses.length, ...value) },
    ),
    /fixture failure/,
  );
  assert.equal(statuses[3].status, "failed");
  assert.equal(statuses.filter((item) => item.status === "success").length, 3);
  pass();
}

{
  const runtime = createRuntime(["tools_access"], { decodeDelay: 40 });
  const workflow = runtime.workflow.core.workflowFromTemplate("text-clean");
  const controller = new AbortController();
  const statuses = [];
  const promise = runtime.workflow.core.executeWorkflow(
    workflow,
    runtime.workflow.core.createResource("text-file", new File(["b\na"], "input.txt")),
    { signal: controller.signal, onStatus: (value) => statuses.splice(0, statuses.length, ...value) },
  );
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(promise, /取消/);
  assert.equal(statuses[0].status, "cancelled");
  assert.ok(statuses.slice(1).every((item) => item.status === "cancelled"));
  pass();
}

{
  let cleaned = 0;
  const runtime = createRuntime(["tools_access"], { failTool: "remove-empty-lines" });
  const workflow = runtime.workflow.core.workflowFromTemplate("text-clean");
  workflow.steps = [workflow.steps[1]];
  const input = runtime.workflow.core.createResource("text", "x", { owned: true, cleanup: () => { cleaned += 1; } });
  await assert.rejects(runtime.workflow.core.executeWorkflow(workflow, input), /fixture failure/);
  assert.equal(cleaned, 1);
  pass();
}

{
  const runtime = createRuntime(["tools_access"], { decodeDelay: 40 });
  const runner = runtime.workflow.core.createRunner();
  const workflow = runtime.workflow.core.workflowFromTemplate("text-clean");
  const input = runtime.workflow.core.createResource("text-file", new File(["x"], "input.txt"));
  const first = runner.run(workflow, input);
  assert.throws(() => runner.run(workflow, input), /已经在运行/);
  runner.cancel();
  await assert.rejects(first, /取消/);
  assert.equal(runner.isRunning(), false);
  pass();
}

{
  const runtime = createRuntime([]);
  const workflow = runtime.workflow.core.workflowFromTemplate("text-clean");
  await assert.rejects(
    runtime.workflow.core.executeWorkflow(workflow, runtime.workflow.core.createResource("text-file", new File(["x"], "input.txt"))),
    /权限/,
  );
  const forged = changed(runtime, workflow, (value) => { value.entitlements = ["tools_access"]; });
  assert.throws(() => runtime.workflow.core.validateWorkflow(forged), /未知字段/);
  pass();
}

{
  const runtime = createRuntime(["tools_access"]);
  const workflow = runtime.workflow.core.workflowFromTemplate("image-batch");
  await assert.rejects(
    runtime.workflow.core.executeWorkflow(workflow, runtime.workflow.core.createResource("image-list", []), { batch: true }),
    /批量处理权限/,
  );
  pass();
}

{
  const runtime = createRuntime(["tools_access"]);
  const workflow = runtime.workflow.core.workflowFromTemplate("csv-roundtrip");
  const input = runtime.workflow.core.createResource("text-file", new File(['name,note\nAlice,"x,y"\n王明,中文'], "input.csv", { type: "text/csv" }));
  const result = await runtime.workflow.core.executeWorkflow(workflow, input);
  assert.equal(result.output.value, 'name,note\r\nAlice,"x,y"\r\n王明,中文');
  pass();
}

console.log(`workflows.js self-checks: ${checks} groups passed`);
