(() => {
  "use strict";

  const root = typeof window === "undefined" ? globalThis : window;
  const SCHEMA_VERSION = 1;
  const MAX_WORKFLOW_BYTES = 48 * 1024;
  const MAX_WORKFLOWS = 50;
  const MAX_STEPS = 20;
  const MAX_FILES = 50;
  const MAX_IMAGES = 20;
  const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
  const OFFLINE_ACCESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const WORKFLOW_TOOL_ID = "workflow";
  const ID_PATTERN = /^(?:wf|step)_[a-z0-9][a-z0-9_-]{5,63}$/;
  const STATUS_LABELS = {
    waiting: "等待",
    running: "运行中",
    success: "完成",
    skipped: "已跳过",
    failed: "失败",
    cancelled: "已取消",
  };

  const CONFIG_SCHEMAS = Object.freeze({
    "text-encoding": {
      encoding: { type: "enum", values: ["utf-8", "gbk", "big5", "shift_jis"], default: "utf-8", label: "源文本编码" },
    },
    "remove-empty-lines": {},
    "dedupe-lines": {},
    "sort-lines": {
      order: { type: "enum", values: ["asc", "desc"], default: "asc", label: "排序方式", labels: { asc: "升序", desc: "降序" } },
    },
    "csv-json": {},
    "json-csv": {},
    "text-split": {
      lines: { type: "integer", min: 1, max: 100000, default: 1000, label: "每份行数" },
    },
    "image-resize": {
      width: { type: "integer", min: 1, max: 4096, default: 1200, label: "宽度" },
      height: { type: "integer", min: 1, max: 4096, default: 1200, label: "高度" },
    },
    "image-format": {
      format: { type: "enum", values: ["image/png", "image/jpeg", "image/webp"], default: "image/webp", label: "输出格式", labels: { "image/png": "PNG", "image/jpeg": "JPG", "image/webp": "WebP" } },
      quality: { type: "number", min: 0.1, max: 1, default: 0.85, label: "质量（0.1 - 1）" },
    },
    "text-watermark": {
      text: { type: "string", minLength: 1, maxLength: 100, default: "WYJ", label: "水印文字" },
      color: { type: "color", default: "#ffffff", label: "水印颜色" },
    },
    "exif-remove": {},
    "files-zip": {},
  });

  const CAPABILITY_REGISTRY = Object.freeze({
    "text-encoding": capability("读取文本编码", ["text-file"], ["text"], false),
    "remove-empty-lines": capability("删除空行", ["text"], ["text"], false),
    "dedupe-lines": capability("删除重复行", ["text"], ["text"], false),
    "sort-lines": capability("文本排序", ["text"], ["text"], false),
    "csv-json": capability("CSV 转 JSON", ["text"], ["json"], false),
    "json-csv": capability("JSON 转 CSV", ["json"], ["text"], false),
    "text-split": capability("文本分割", ["text"], ["archive"], false),
    "image-resize": capability("图片尺寸调整", ["image", "image-list"], ["image", "image-list"], true, preserveCollectionType),
    "image-format": capability("图片格式转换", ["image", "image-list"], ["image", "image-list"], true, preserveCollectionType),
    "text-watermark": capability("文本水印", ["image", "image-list"], ["image", "image-list"], true, preserveCollectionType),
    "exif-remove": capability("删除 EXIF", ["image", "image-list"], ["image", "image-list"], true, preserveCollectionType),
    "files-zip": capability("打包为 ZIP", ["file-list", "image-list"], ["archive"], true),
  });

  const TEMPLATE_DEFINITIONS = Object.freeze([
    {
      id: "image-publish",
      name: "图片发布处理",
      description: "调整尺寸 → WebP → 文字水印 → 删除 EXIF",
      steps: [
        ["image-resize", { width: 1200, height: 1200 }],
        ["image-format", { format: "image/webp", quality: 0.85 }],
        ["text-watermark", { text: "WYJ", color: "#ffffff" }],
        ["exif-remove", {}],
      ],
    },
    {
      id: "image-batch",
      name: "图片批量发布",
      description: "批量调整尺寸 → WebP → 删除 EXIF → ZIP",
      steps: [
        ["image-resize", { width: 1200, height: 1200 }],
        ["image-format", { format: "image/webp", quality: 0.85 }],
        ["exif-remove", {}],
        ["files-zip", {}],
      ],
    },
    {
      id: "text-clean",
      name: "文本清理排序",
      description: "读取编码 → 删除空行 → 去重 → 排序",
      steps: [
        ["text-encoding", { encoding: "utf-8" }],
        ["remove-empty-lines", {}],
        ["dedupe-lines", {}],
        ["sort-lines", { order: "asc" }],
      ],
    },
    {
      id: "csv-roundtrip",
      name: "CSV 规范转换",
      description: "读取 CSV → 结构化 JSON → 规范 CSV",
      steps: [
        ["text-encoding", { encoding: "utf-8" }],
        ["csv-json", {}],
        ["json-csv", {}],
      ],
    },
  ]);

  let bridge = null;
  let initialized = false;
  let workflows = [];
  let selectedWorkflowId = "";
  let cloudConfigIds = new Map();
  let accessOptions = { offline: false, access: null };
  let activeRun = null;
  let lastOutput = null;
  let previewUrl = "";
  let draggedStepId = "";

  function capability(name, inputTypes, outputTypes, batch, outputResolver = null) {
    return Object.freeze({
      name,
      input_types: Object.freeze([...inputTypes]),
      output_types: Object.freeze([...outputTypes]),
      batch: Boolean(batch),
      config_schema: null,
      resolve_output_type: outputResolver,
    });
  }

  function preserveCollectionType(inputType) {
    return inputType === "image-list" ? "image-list" : "image";
  }

  function byId(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.getPrototypeOf(prototype) === null;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function randomId(prefix) {
    const value = root.crypto?.randomUUID?.().replace(/-/g, "") || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `${prefix}_${value.slice(0, 24).toLowerCase()}`;
  }

  function assertExactKeys(value, allowed, label) {
    if (!isPlainObject(value)) throw new Error(`${label}必须是对象`);
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new Error(`${label}包含未知字段：${unknown.join("、")}`);
  }

  function normalizeConfig(toolId, input) {
    const schema = CONFIG_SCHEMAS[toolId];
    if (!schema) throw new Error(`未注册的工作流工具：${toolId}`);
    const source = input === undefined ? {} : input;
    assertExactKeys(source, Object.keys(schema), `${toolId} 配置`);
    const output = {};
    for (const [key, rule] of Object.entries(schema)) {
      const raw = Object.hasOwn(source, key) ? source[key] : rule.default;
      if (rule.type === "enum") {
        if (!rule.values.includes(raw)) throw new Error(`${toolId}.${key} 取值无效`);
        output[key] = raw;
      } else if (rule.type === "integer") {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < rule.min || value > rule.max) throw new Error(`${toolId}.${key} 超出范围`);
        output[key] = value;
      } else if (rule.type === "number") {
        const value = Number(raw);
        if (!Number.isFinite(value) || value < rule.min || value > rule.max) throw new Error(`${toolId}.${key} 超出范围`);
        output[key] = value;
      } else if (rule.type === "string") {
        const value = String(raw ?? "");
        if (value.length < rule.minLength || value.length > rule.maxLength) throw new Error(`${toolId}.${key} 长度无效`);
        output[key] = value;
      } else if (rule.type === "color") {
        const value = String(raw || "");
        if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${toolId}.${key} 颜色无效`);
        output[key] = value.toLowerCase();
      }
    }
    return output;
  }

  function outputTypesFor(capabilityItem, inputTypes) {
    const output = new Set();
    for (const inputType of inputTypes) {
      if (!capabilityItem.input_types.includes(inputType)) continue;
      if (capabilityItem.resolve_output_type) output.add(capabilityItem.resolve_output_type(inputType));
      else capabilityItem.output_types.forEach((type) => output.add(type));
    }
    return output;
  }

  function validateStepSequence(steps) {
    let possible = null;
    for (const step of steps.filter((item) => item.enabled)) {
      const capabilityItem = CAPABILITY_REGISTRY[step.tool_id];
      const accepted = new Set(capabilityItem.input_types);
      if (possible !== null) {
        const compatibleInputs = new Set([...possible].filter((type) => accepted.has(type)));
        if (!compatibleInputs.size) throw new Error(`步骤“${capabilityItem.name}”与上一步输出类型不兼容`);
        possible = outputTypesFor(capabilityItem, compatibleInputs);
      } else {
        possible = outputTypesFor(capabilityItem, accepted);
      }
    }
    return possible || new Set();
  }

  function validateWorkflow(input, options = {}) {
    if (!options.skipSize && new TextEncoder().encode(JSON.stringify(input)).length > MAX_WORKFLOW_BYTES) {
      throw new Error(`工作流 JSON 不能超过 ${Math.round(MAX_WORKFLOW_BYTES / 1024)} KB`);
    }
    assertExactKeys(input, ["schema_version", "id", "name", "created_at", "updated_at", "steps"], "工作流");
    if (input.schema_version !== SCHEMA_VERSION) throw new Error(`不支持的工作流版本：${input.schema_version}`);
    const id = String(input.id || "");
    if (!ID_PATTERN.test(id) || !id.startsWith("wf_")) throw new Error("工作流 ID 无效");
    const name = String(input.name || "").trim();
    if (!name || name.length > 80) throw new Error("工作流名称必须为 1 至 80 个字符");
    const createdAt = String(input.created_at || "");
    const updatedAt = String(input.updated_at || "");
    if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) throw new Error("工作流时间格式无效");
    if (!Array.isArray(input.steps) || input.steps.length > MAX_STEPS) throw new Error(`工作流最多包含 ${MAX_STEPS} 个步骤`);
    const seen = new Set();
    const steps = input.steps.map((rawStep, index) => {
      assertExactKeys(rawStep, ["id", "tool_id", "enabled", "config"], `第 ${index + 1} 步`);
      const stepId = String(rawStep.id || "");
      if (!ID_PATTERN.test(stepId) || !stepId.startsWith("step_")) throw new Error(`第 ${index + 1} 步 ID 无效`);
      if (seen.has(stepId)) throw new Error(`步骤 ID 重复：${stepId}`);
      seen.add(stepId);
      const toolId = String(rawStep.tool_id || "");
      if (!CAPABILITY_REGISTRY[toolId]) throw new Error(`未注册的工作流工具：${toolId}`);
      if (typeof rawStep.enabled !== "boolean") throw new Error(`第 ${index + 1} 步启用状态无效`);
      return { id: stepId, tool_id: toolId, enabled: rawStep.enabled, config: normalizeConfig(toolId, rawStep.config) };
    });
    validateStepSequence(steps);
    const result = { schema_version: SCHEMA_VERSION, id, name, created_at: createdAt, updated_at: updatedAt, steps };
    if (!options.skipSize && new TextEncoder().encode(JSON.stringify(result)).length > MAX_WORKFLOW_BYTES) {
      throw new Error(`工作流 JSON 不能超过 ${Math.round(MAX_WORKFLOW_BYTES / 1024)} KB`);
    }
    return result;
  }

  function blankWorkflow(name = "未命名工作流") {
    const timestamp = nowIso();
    return { schema_version: SCHEMA_VERSION, id: randomId("wf"), name, created_at: timestamp, updated_at: timestamp, steps: [] };
  }

  function workflowFromTemplate(templateId) {
    const template = TEMPLATE_DEFINITIONS.find((item) => item.id === templateId);
    if (!template) throw new Error("工作流模板不存在");
    const workflow = blankWorkflow(template.name);
    workflow.steps = template.steps.map(([toolId, config]) => ({ id: randomId("step"), tool_id: toolId, enabled: true, config: normalizeConfig(toolId, config) }));
    return validateWorkflow(workflow);
  }

  function account() {
    return bridge?.account?.() || null;
  }

  function accountId() {
    return String(bridge?.accountId?.() || account()?.id || "guest");
  }

  function isAdministrator(value = account()) {
    return Boolean(value?.is_super_admin && value?.role === "super_admin");
  }

  function entitlementSet(value = account()) {
    return new Set(Array.isArray(value?.entitlements) ? value.entitlements : []);
  }

  function hasEntitlement(code, value = account()) {
    return isAdministrator(value) || entitlementSet(value).has(code);
  }

  function storageKey() {
    return `wyjToolWorkflows:v${SCHEMA_VERSION}:${accountId()}`;
  }

  function accessCacheKey() {
    return `wyjWorkflowAccess:v1:${accountId()}`;
  }

  function safeLocalGet(key) {
    try { return root.localStorage?.getItem(key) || ""; } catch (_) { return ""; }
  }

  function safeLocalSet(key, value) {
    try { root.localStorage?.setItem(key, value); return true; } catch (_) { return false; }
  }

  function loadLocalWorkflows() {
    try {
      const parsed = JSON.parse(safeLocalGet(storageKey()) || "{}");
      const source = Array.isArray(parsed.workflows) ? parsed.workflows : [];
      workflows = source.slice(0, MAX_WORKFLOWS).flatMap((item) => {
        try { return [validateWorkflow(item)]; } catch (_) { return []; }
      });
      selectedWorkflowId = workflows.some((item) => item.id === parsed.selected_id) ? parsed.selected_id : workflows[0]?.id || "";
    } catch (_) {
      workflows = [];
      selectedWorkflowId = "";
    }
  }

  function persistLocalWorkflows() {
    const payload = { schema_version: SCHEMA_VERSION, selected_id: selectedWorkflowId, workflows: workflows.slice(0, MAX_WORKFLOWS) };
    if (!safeLocalSet(storageKey(), JSON.stringify(payload))) setSaveMessage("浏览器未允许本地保存，当前修改只在本页有效", true);
  }

  function selectedWorkflow() {
    return workflows.find((item) => item.id === selectedWorkflowId) || null;
  }

  function rememberOnlineAccess(options) {
    if (options?.offline || !options?.access?.account) return;
    const value = options.access.account;
    safeLocalSet(accessCacheKey(), JSON.stringify({
      account_id: accountId(),
      entitlements: [...entitlementSet(value)],
      is_admin: isAdministrator(value),
      checked_at: Date.now(),
    }));
  }

  function recentOfflineEntitlements() {
    try {
      const value = JSON.parse(safeLocalGet(accessCacheKey()) || "{}");
      if (String(value.account_id || "") !== accountId()) return null;
      if (!Number.isFinite(value.checked_at) || Date.now() - value.checked_at > OFFLINE_ACCESS_MAX_AGE_MS) return null;
      return value.is_admin ? new Set(["*"]) : new Set(Array.isArray(value.entitlements) ? value.entitlements : []);
    } catch (_) {
      return null;
    }
  }

  function permissionAvailable(code) {
    if (!accessOptions.offline) return hasEntitlement(code);
    const cached = recentOfflineEntitlements();
    return Boolean(cached && (cached.has("*") || cached.has(code)));
  }

  function requirePermission(code, label) {
    if (!permissionAvailable(code)) {
      if (accessOptions.offline) throw new Error(`离线权限缓存已过期或不包含${label}，请联网重新验证会员`);
      throw new Error(`当前会员不包含${label}`);
    }
  }

  function setAccess(options = {}) {
    accessOptions = { offline: Boolean(options.offline), access: options.access || null };
    rememberOnlineAccess(accessOptions);
  }

  function createResource(type, value, metadata = {}) {
    return { type, value, name: metadata.name || "", mime: metadata.mime || "", owned: Boolean(metadata.owned), cleanup: metadata.cleanup || null, items: metadata.items || null };
  }

  async function cleanupResource(resource) {
    if (!resource) return;
    try {
      if (typeof resource.cleanup === "function") await resource.cleanup();
      if (resource.value && typeof resource.value.close === "function") resource.value.close();
      if (Array.isArray(resource.value)) {
        for (const item of resource.value) {
          if (item?.resource) await cleanupResource(item.resource);
          else if (item?.value && typeof item.value.close === "function") item.value.close();
        }
      }
    } catch (_) {
      // Cleanup is best-effort and must not replace the original workflow error.
    }
  }

  function abortError() {
    const error = new Error("工作流已取消");
    error.name = "AbortError";
    return error;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
  }

  function primitive(name) {
    const value = root.WYJTools?.primitives?.[name];
    if (typeof value !== "function") throw new Error(`工具运行原语不可用：${name}`);
    return value;
  }

  function namedBlob(blob, name) {
    if (typeof File === "function") return new File([blob], name || "workflow-file", { type: blob.type || "application/octet-stream", lastModified: Date.now() });
    try { Object.defineProperty(blob, "name", { value: name || "workflow-file", configurable: true }); } catch (_) { /* Blob still remains usable. */ }
    return blob;
  }

  function imageDefaults(config = {}) {
    return {
      width: Number(config.width || 0), height: Number(config.height || 0), scale: 100,
      quality: Number(config.quality || 0.85), format: config.format || "image/png", angle: 0,
      flip: "horizontal", radius: 0, text: config.text || "WYJ", color: config.color || "#ffffff",
      background: "#ffffff", x: 0, y: 0, regionWidth: 100, regionHeight: 100,
      blur: 0, gradientEnd: "#000000", gradientAngle: 0,
    };
  }

  async function runTextCapability(toolId, resource, config, signal) {
    throwIfAborted(signal);
    if (toolId === "text-encoding") {
      const file = resource.value;
      const text = await primitive("decodeLocalText")(file, config.encoding);
      throwIfAborted(signal);
      return createResource("text", text, { name: `${resource.name || file.name || "text"}.txt`, mime: "text/plain;charset=utf-8", owned: true });
    }
    if (toolId === "csv-json") {
      const rows = primitive("validateCsvTable")(primitive("parseCsv")(String(resource.value)), resource.name || "CSV");
      const headers = rows.shift() || [];
      const names = headers.map((header, index) => String(header).trim() || `column_${index + 1}`);
      if (new Set(names).size !== names.length) throw new Error("CSV 表头存在重复字段");
      const value = rows.map((row) => Object.fromEntries(names.map((header, index) => [header, row[index] ?? ""])));
      return createResource("json", value, { name: "workflow.json", mime: "application/json", owned: true });
    }
    if (toolId === "json-csv") {
      const value = resource.value;
      if (!Array.isArray(value) || value.some((item) => !isPlainObject(item))) throw new Error("JSON 步骤需要对象数组");
      const headers = [...new Set(value.flatMap((item) => Object.keys(item)))];
      const text = primitive("csvString")([headers, ...value.map((item) => headers.map((header) => item[header] ?? ""))]);
      return createResource("text", text, { name: "workflow.csv", mime: "text/csv;charset=utf-8", owned: true });
    }
    if (toolId === "text-split") {
      const lines = String(resource.value || "").replace(/\r\n?/g, "\n").split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      if (!lines.length) throw new Error("没有可拆分的数据行");
      const entries = [];
      for (let index = 0; index < lines.length; index += config.lines) {
        throwIfAborted(signal);
        entries.push({ name: `part-${String(entries.length + 1).padStart(3, "0")}.txt`, data: new TextEncoder().encode(lines.slice(index, index + config.lines).join("\n")) });
      }
      return createResource("archive", primitive("zipBlob")(entries), { name: "workflow-text-parts.zip", mime: "application/zip", owned: true });
    }
    const option = toolId === "sort-lines" ? config.order : "";
    const text = primitive("runTextOperation")(toolId, String(resource.value ?? ""), "", "", option);
    return createResource("text", text, { name: resource.name || "workflow.txt", mime: "text/plain;charset=utf-8", owned: true });
  }

  async function transformImageItem(toolId, item, config, signal) {
    throwIfAborted(signal);
    const source = item.resource || item;
    const blob = source.value;
    const sourceName = source.name || "image";
    if (toolId === "exif-remove" && (source.mime || blob.type) === "image/jpeg") {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      throwIfAborted(signal);
      const clean = primitive("stripJpegMetadata")(bytes);
      return createResource("image", new Blob([clean], { type: "image/jpeg" }), { name: sourceName.replace(/\.[^.]+$/, "") + "-clean.jpg", mime: "image/jpeg", owned: true });
    }
    const input = namedBlob(blob, sourceName);
    const bitmap = await primitive("bitmapFromFile")(input);
    let canvas = null;
    try {
      throwIfAborted(signal);
      const canvasTool = toolId === "exif-remove" || toolId === "image-format" ? "image-format" : toolId;
      const values = imageDefaults(config);
      if (toolId !== "image-format") values.format = source.mime || blob.type || "image/png";
      canvas = await primitive("imageCanvas")(canvasTool, bitmap, values);
      throwIfAborted(signal);
      const mime = toolId === "image-format" ? config.format : (source.mime || blob.type || "image/png");
      const safeMime = ["image/png", "image/jpeg", "image/webp"].includes(mime) ? mime : "image/png";
      const output = await primitive("canvasBlob")(canvas, safeMime, toolId === "image-format" ? config.quality : 0.92);
      throwIfAborted(signal);
      const extension = safeMime === "image/jpeg" ? "jpg" : safeMime === "image/webp" ? "webp" : "png";
      return createResource("image", output, { name: `${sourceName.replace(/\.[^.]+$/, "")}-${toolId}.${extension}`, mime: safeMime, owned: true });
    } finally {
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      primitive("releaseBitmap")(bitmap);
    }
  }

  async function runImageCapability(toolId, resource, config, signal) {
    if (resource.type === "image") return transformImageItem(toolId, resource, config, signal);
    const output = [];
    for (const item of resource.value) {
      throwIfAborted(signal);
      if (item.status === "failed") { output.push(item); continue; }
      try {
        output.push({ name: item.name, status: "success", resource: await transformImageItem(toolId, item, config, signal) });
      } catch (error) {
        if (error.name === "AbortError") throw error;
        output.push({ name: item.name, status: "failed", error: error.message });
      }
    }
    const succeeded = output.filter((item) => item.status === "success").length;
    if (!succeeded) throw new Error("批量步骤中的所有图片均处理失败");
    return createResource("image-list", output, { owned: true, items: output.map(({ name, status, error = "" }) => ({ name, status, error })) });
  }

  async function runZipCapability(resource, signal) {
    const entries = [];
    const items = Array.isArray(resource.value) ? resource.value : [];
    for (const item of items) {
      throwIfAborted(signal);
      if (item.status === "failed") continue;
      const child = item.resource || item;
      const blob = child.value || child;
      entries.push({ name: child.name || item.name || `file-${entries.length + 1}`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (!entries.length) throw new Error("没有可打包的成功结果");
    return createResource("archive", primitive("zipBlob")(entries), { name: "workflow-results.zip", mime: "application/zip", owned: true, items: resource.items });
  }

  async function runCapability(step, resource, signal) {
    const toolId = step.tool_id;
    if (["text-encoding", "remove-empty-lines", "dedupe-lines", "sort-lines", "csv-json", "json-csv", "text-split"].includes(toolId)) {
      return runTextCapability(toolId, resource, step.config, signal);
    }
    if (["image-resize", "image-format", "text-watermark", "exif-remove"].includes(toolId)) {
      return runImageCapability(toolId, resource, step.config, signal);
    }
    if (toolId === "files-zip") return runZipCapability(resource, signal);
    throw new Error(`工作流工具没有运行器：${toolId}`);
  }

  async function executeWorkflow(workflowInput, inputResource, options = {}) {
    const workflow = validateWorkflow(workflowInput);
    const signal = options.signal;
    const activeSteps = workflow.steps.filter((step) => step.enabled);
    if (!activeSteps.length) throw new Error("请至少启用一个步骤");
    requirePermission("tools_access", "工作流运行权限");
    const isBatch = inputResource.type.endsWith("-list") || Boolean(options.batch);
    if (isBatch) requirePermission("tools_batch_access", "批量处理权限");
    const first = CAPABILITY_REGISTRY[activeSteps[0].tool_id];
    if (!first.input_types.includes(inputResource.type)) throw new Error(`首个步骤不接受 ${inputResource.type} 输入`);
    const statuses = workflow.steps.map((step) => ({ id: step.id, tool_id: step.tool_id, status: "waiting", duration_ms: 0, error: "", items: [] }));
    const report = () => options.onStatus?.(cloneJson(statuses));
    report();
    let current = inputResource;
    let currentOwned = Boolean(inputResource.owned);
    try {
      for (let index = 0; index < workflow.steps.length; index += 1) {
        const step = workflow.steps[index];
        const status = statuses[index];
        if (!step.enabled) { status.status = "skipped"; report(); continue; }
        throwIfAborted(signal);
        const capabilityItem = CAPABILITY_REGISTRY[step.tool_id];
        if (!capabilityItem.input_types.includes(current.type)) throw new Error(`步骤“${capabilityItem.name}”不接受 ${current.type} 输入`);
        status.status = "running";
        const started = performance.now();
        report();
        try {
          const next = await runCapability(step, current, signal);
          throwIfAborted(signal);
          status.duration_ms = Math.max(0, Math.round(performance.now() - started));
          status.status = "success";
          status.items = next.items || [];
          if (currentOwned && current !== next) await cleanupResource(current);
          current = next;
          currentOwned = Boolean(next.owned);
          report();
        } catch (error) {
          status.duration_ms = Math.max(0, Math.round(performance.now() - started));
          status.status = error.name === "AbortError" ? "cancelled" : "failed";
          status.error = error.message;
          if (error.name === "AbortError") {
            statuses.slice(index + 1).forEach((item) => { if (item.status === "waiting") item.status = "cancelled"; });
          }
          report();
          throw error;
        }
      }
      return { output: current, statuses };
    } catch (error) {
      if (currentOwned) await cleanupResource(current);
      throw error;
    }
  }

  function createRunner() {
    let running = null;
    return Object.freeze({
      run(workflow, input, options = {}) {
        if (running) throw new Error("工作流已经在运行，请先取消或等待完成");
        const controller = options.controller || new AbortController();
        const promise = executeWorkflow(workflow, input, { ...options, signal: controller.signal }).finally(() => {
          if (running?.promise === promise) running = null;
        });
        running = { controller, promise };
        return promise;
      },
      cancel() { running?.controller.abort(); },
      isRunning() { return Boolean(running); },
    });
  }

  function inputTypesFor(workflow) {
    const first = workflow?.steps?.find((step) => step.enabled);
    return first ? [...CAPABILITY_REGISTRY[first.tool_id].input_types] : [];
  }

  function sequenceOutputTypes(workflow) {
    return [...validateStepSequence(workflow?.steps || [])];
  }

  function fileSizeTotal(files) {
    return files.reduce((total, file) => total + Number(file.size || 0), 0);
  }

  function resourceFromFiles(workflow, files, batchRequested) {
    const types = inputTypesFor(workflow);
    if (!files.length) throw new Error("请选择输入文件");
    if (files.length > MAX_FILES || fileSizeTotal(files) > MAX_TOTAL_BYTES) throw new Error("文件最多 50 个且总大小不能超过 50 MB");
    if (types.includes("text-file")) {
      if (files.length !== 1) throw new Error("文本工作流每次请选择一个文件");
      return createResource("text-file", files[0], { name: files[0].name, mime: files[0].type, owned: false });
    }
    const imageOnly = files.every((file) => String(file.type || "").startsWith("image/"));
    if (types.includes("image") && imageOnly) {
      const batch = batchRequested || files.length > 1;
      if (batch) {
        if (files.length > MAX_IMAGES) throw new Error("批量图片最多 20 张");
        return createResource("image-list", files.map((file) => ({ name: file.name, status: "success", resource: createResource("image", file, { name: file.name, mime: file.type, owned: false }) })), { owned: false });
      }
      if (files.length !== 1) throw new Error("单图工作流每次请选择一张图片");
      return createResource("image", files[0], { name: files[0].name, mime: files[0].type, owned: false });
    }
    if (types.includes("file-list")) {
      return createResource("file-list", files.map((file) => ({ name: file.name, status: "success", resource: createResource("file", file, { name: file.name, mime: file.type, owned: false }) })), { owned: false });
    }
    throw new Error("所选文件类型与首个步骤不兼容");
  }

  function setSaveMessage(message, error = false) {
    const element = byId("workflowSaveState");
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("error", Boolean(error));
  }

  function markWorkflowUpdated() {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    workflow.updated_at = nowIso();
    persistLocalWorkflows();
    setSaveMessage("修改已保存在本机，点击“保存”可同步到云端");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function renderWorkflowList() {
    const target = byId("workflowList");
    if (!target) return;
    target.innerHTML = workflows.map((workflow) => `<button class="${workflow.id === selectedWorkflowId ? "active" : ""}" type="button" data-workflow-id="${workflow.id}"><strong>${escapeHtml(workflow.name)}</strong><small>${workflow.steps.length} 个步骤</small></button>`).join("") || '<p class="workflow-empty">还没有工作流。</p>';
    target.querySelectorAll("[data-workflow-id]").forEach((button) => button.addEventListener("click", () => {
      selectedWorkflowId = button.dataset.workflowId;
      persistLocalWorkflows();
      renderAll();
    }));
  }

  function renderTemplates() {
    const target = byId("workflowTemplateList");
    if (!target) return;
    target.innerHTML = TEMPLATE_DEFINITIONS.map((template) => `<button type="button" data-workflow-template="${template.id}"><strong>${template.name}</strong><small>${template.description}</small></button>`).join("");
    target.querySelectorAll("[data-workflow-template]").forEach((button) => button.addEventListener("click", () => {
      if (workflows.length >= MAX_WORKFLOWS) return setSaveMessage(`最多保存 ${MAX_WORKFLOWS} 个工作流`, true);
      const workflow = workflowFromTemplate(button.dataset.workflowTemplate);
      workflows.unshift(workflow);
      selectedWorkflowId = workflow.id;
      persistLocalWorkflows();
      renderAll();
    }));
  }

  function configFields(step) {
    const schema = CONFIG_SCHEMAS[step.tool_id];
    const fields = Object.entries(schema).map(([key, rule]) => {
      const id = `workflow-config-${step.id}-${key}`;
      if (rule.type === "enum") {
        return `<label><span>${rule.label}</span><select id="${id}" data-step-config="${key}">${rule.values.map((value) => `<option value="${escapeHtml(value)}"${step.config[key] === value ? " selected" : ""}>${escapeHtml(rule.labels?.[value] || value)}</option>`).join("")}</select></label>`;
      }
      if (rule.type === "color") return `<label><span>${rule.label}</span><input id="${id}" data-step-config="${key}" type="color" value="${escapeHtml(step.config[key])}" /></label>`;
      const type = ["integer", "number"].includes(rule.type) ? "number" : "text";
      const limits = type === "number" ? ` min="${rule.min}" max="${rule.max}"${rule.type === "number" ? ' step="0.05"' : ""}` : ` maxlength="${rule.maxLength}"`;
      return `<label><span>${rule.label}</span><input id="${id}" data-step-config="${key}" type="${type}"${limits} value="${escapeHtml(step.config[key])}" /></label>`;
    }).join("");
    return fields ? `<div class="workflow-step-config">${fields}</div>` : '<p class="workflow-step-no-config">无需额外参数</p>';
  }

  function moveStep(stepId, offset) {
    const workflow = selectedWorkflow();
    const index = workflow.steps.findIndex((step) => step.id === stepId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= workflow.steps.length) return;
    [workflow.steps[index], workflow.steps[target]] = [workflow.steps[target], workflow.steps[index]];
    markWorkflowUpdated();
    renderEditor();
  }

  function reorderStep(sourceId, targetId) {
    const workflow = selectedWorkflow();
    const source = workflow.steps.findIndex((step) => step.id === sourceId);
    const target = workflow.steps.findIndex((step) => step.id === targetId);
    if (source < 0 || target < 0 || source === target) return;
    const [item] = workflow.steps.splice(source, 1);
    workflow.steps.splice(target, 0, item);
    markWorkflowUpdated();
    renderEditor();
  }

  function bindStepEvents() {
    const workflow = selectedWorkflow();
    const list = byId("workflowStepList");
    list?.querySelectorAll("[data-step-id]").forEach((item) => {
      const stepId = item.dataset.stepId;
      item.addEventListener("dragstart", () => { draggedStepId = stepId; item.classList.add("dragging"); });
      item.addEventListener("dragend", () => { draggedStepId = ""; item.classList.remove("dragging"); });
      item.addEventListener("dragover", (event) => event.preventDefault());
      item.addEventListener("drop", (event) => { event.preventDefault(); reorderStep(draggedStepId, stepId); });
      item.querySelector("[data-step-up]")?.addEventListener("click", () => moveStep(stepId, -1));
      item.querySelector("[data-step-down]")?.addEventListener("click", () => moveStep(stepId, 1));
      item.querySelector("[data-step-duplicate]")?.addEventListener("click", () => {
        if (workflow.steps.length >= MAX_STEPS) return setSaveMessage(`最多 ${MAX_STEPS} 个步骤`, true);
        const index = workflow.steps.findIndex((step) => step.id === stepId);
        workflow.steps.splice(index + 1, 0, { ...cloneJson(workflow.steps[index]), id: randomId("step") });
        markWorkflowUpdated();
        renderEditor();
      });
      item.querySelector("[data-step-delete]")?.addEventListener("click", () => {
        workflow.steps = workflow.steps.filter((step) => step.id !== stepId);
        markWorkflowUpdated();
        renderEditor();
      });
      item.querySelector("[data-step-enabled]")?.addEventListener("change", (event) => {
        const step = workflow.steps.find((value) => value.id === stepId);
        step.enabled = event.currentTarget.checked;
        markWorkflowUpdated();
        renderEditor();
      });
      item.querySelectorAll("[data-step-config]").forEach((field) => field.addEventListener("change", () => {
        const step = workflow.steps.find((value) => value.id === stepId);
        const rule = CONFIG_SCHEMAS[step.tool_id][field.dataset.stepConfig];
        step.config[field.dataset.stepConfig] = ["integer", "number"].includes(rule.type) ? Number(field.value) : field.value;
        try { step.config = normalizeConfig(step.tool_id, step.config); markWorkflowUpdated(); }
        catch (error) { setSaveMessage(error.message, true); }
      }));
    });
  }

  function addableCapabilities(workflow) {
    const active = workflow.steps.filter((step) => step.enabled);
    if (!active.length) return Object.entries(CAPABILITY_REGISTRY);
    let possible;
    try { possible = validateStepSequence(workflow.steps); } catch (_) { return Object.entries(CAPABILITY_REGISTRY); }
    return Object.entries(CAPABILITY_REGISTRY).filter(([, item]) => item.input_types.some((type) => possible.has(type)));
  }

  function renderInputControls(workflow) {
    const types = inputTypesFor(workflow);
    const text = types.includes("text");
    const textFile = types.includes("text-file");
    const image = types.includes("image") || types.includes("image-list");
    const batchCapable = image && workflow.steps.some((step) => step.enabled && step.tool_id === "files-zip");
    byId("workflowTextInputWrap")?.classList.toggle("hidden", !text);
    byId("workflowFileInputWrap")?.classList.toggle("hidden", !(textFile || image || types.includes("file-list")));
    byId("workflowBatchToggleWrap")?.classList.toggle("hidden", !batchCapable);
    const batchToggle = byId("workflowBatchToggle");
    if (batchToggle && !batchCapable) batchToggle.checked = false;
    const fileInput = byId("workflowFileInput");
    if (fileInput) {
      fileInput.multiple = batchCapable || types.includes("file-list");
      fileInput.accept = image ? "image/png,image/jpeg,image/webp" : textFile ? ".txt,.csv,.json,text/plain,text/csv,application/json" : "";
    }
    if (byId("workflowFileInputLabel")) byId("workflowFileInputLabel").textContent = image ? (batchCapable ? "选择一组图片" : "选择一张图片") : "选择文本或数据文件";
    if (byId("workflowInputHint")) byId("workflowInputHint").textContent = types.length ? `首步输入：${types.join(" / ")}；单次最多 50 MB。` : "请先添加并启用步骤。";
    byId("runWorkflowBtn").disabled = !types.length || Boolean(activeRun);
  }

  function renderEditor() {
    const workflow = selectedWorkflow();
    byId("workflowEmptyState")?.classList.toggle("hidden", Boolean(workflow));
    byId("workflowEditorBody")?.classList.toggle("hidden", !workflow);
    if (!workflow) return;
    byId("workflowNameInput").value = workflow.name;
    const list = byId("workflowStepList");
    list.innerHTML = workflow.steps.map((step, index) => `<li class="workflow-step${step.enabled ? "" : " disabled"}" data-step-id="${step.id}" draggable="true">
      <div class="workflow-step-heading"><span class="workflow-step-number">${index + 1}</span><div><strong>${escapeHtml(CAPABILITY_REGISTRY[step.tool_id].name)}</strong><small>${escapeHtml(step.tool_id)} · ${CAPABILITY_REGISTRY[step.tool_id].input_types.join("/")} → ${CAPABILITY_REGISTRY[step.tool_id].output_types.join("/")}</small></div><label><input data-step-enabled type="checkbox"${step.enabled ? " checked" : ""} /> 启用</label></div>
      ${configFields(step)}
      <div class="workflow-step-actions"><button data-step-up type="button" aria-label="上移第 ${index + 1} 步">上移</button><button data-step-down type="button" aria-label="下移第 ${index + 1} 步">下移</button><button data-step-duplicate type="button">复制步骤</button><button data-step-delete type="button">删除</button></div>
    </li>`).join("") || '<li class="workflow-empty">还没有步骤，请从下方列表添加。</li>';
    const addable = addableCapabilities(workflow);
    byId("workflowToolSelect").innerHTML = addable.map(([id, item]) => `<option value="${id}">${item.name}</option>`).join("");
    byId("addWorkflowStepBtn").disabled = !addable.length || workflow.steps.length >= MAX_STEPS;
    bindStepEvents();
    renderInputControls(workflow);
  }

  function renderStepStatuses(statuses = []) {
    const target = byId("workflowStepStatuses");
    if (!target) return;
    target.innerHTML = statuses.map((status, index) => `<div data-workflow-step-status="${status.id}" data-status="${status.status}"><span>${index + 1}. ${escapeHtml(CAPABILITY_REGISTRY[status.tool_id]?.name || status.tool_id)}</span><strong>${STATUS_LABELS[status.status] || status.status}${status.duration_ms ? ` · ${status.duration_ms} ms` : ""}</strong>${status.error ? `<small>${escapeHtml(status.error)}</small>` : ""}</div>`).join("");
  }

  function renderItemResults(items = []) {
    const target = byId("workflowItemResults");
    if (!target) return;
    target.classList.toggle("hidden", !items.length);
    target.innerHTML = items.map((item) => `<p data-status="${item.status}"><strong>${escapeHtml(item.name)}</strong><span>${item.status === "success" ? "完成" : `失败：${escapeHtml(item.error || "未知错误")}`}</span></p>`).join("");
  }

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    const preview = byId("workflowResultPreview");
    if (preview) preview.innerHTML = "";
  }

  async function releaseLastOutput() {
    clearPreview();
    if (lastOutput) await cleanupResource(lastOutput);
    lastOutput = null;
  }

  function displayOutput(resource) {
    const textTarget = byId("workflowResultText");
    const copyButton = byId("copyWorkflowResultBtn");
    const downloadButton = byId("downloadWorkflowResultBtn");
    textTarget.value = "";
    copyButton.disabled = true;
    downloadButton.disabled = true;
    clearPreview();
    if (resource.type === "text") {
      textTarget.value = String(resource.value);
      copyButton.disabled = false;
      const blob = new Blob([resource.value], { type: resource.mime || "text/plain;charset=utf-8" });
      lastOutput = createResource("file", blob, { name: resource.name || "workflow-result.txt", mime: blob.type, owned: true });
      downloadButton.disabled = false;
    } else if (resource.type === "json") {
      textTarget.value = JSON.stringify(resource.value, null, 2);
      copyButton.disabled = false;
      const blob = new Blob([textTarget.value], { type: "application/json" });
      lastOutput = createResource("file", blob, { name: resource.name || "workflow-result.json", mime: blob.type, owned: true });
      downloadButton.disabled = false;
    } else if (["image", "archive", "file"].includes(resource.type)) {
      lastOutput = resource;
      downloadButton.disabled = false;
      textTarget.value = `${resource.name || "处理结果"}\n${resource.mime || resource.value?.type || ""}\n${resource.value?.size ?? 0} 字节`;
      if (resource.type === "image") {
        previewUrl = URL.createObjectURL(resource.value);
        const image = document.createElement("img"); image.src = previewUrl; image.alt = "工作流图片结果预览"; byId("workflowResultPreview").appendChild(image);
      }
    } else {
      lastOutput = resource;
      textTarget.value = "工作流已完成";
    }
  }

  async function runSelectedWorkflow() {
    if (activeRun) return;
    const workflow = validateWorkflow(selectedWorkflow());
    await releaseLastOutput();
    const files = [...(byId("workflowFileInput")?.files || [])];
    const batchRequested = Boolean(byId("workflowBatchToggle")?.checked);
    const types = inputTypesFor(workflow);
    const input = types.includes("text")
      ? createResource("text", byId("workflowTextInput")?.value || "", { name: "workflow-input.txt", mime: "text/plain", owned: false })
      : resourceFromFiles(workflow, files, batchRequested);
    if (batchRequested && !sequenceOutputTypes(workflow).includes("archive")) throw new Error("批量流程最后必须生成 ZIP");
    const controller = new AbortController();
    byId("runWorkflowBtn").disabled = true;
    byId("cancelWorkflowBtn").disabled = false;
    byId("workflowRunState").textContent = "运行中";
    byId("workflowRunState").dataset.status = "running";
    renderItemResults([]);
    const promise = executeWorkflow(workflow, input, {
      signal: controller.signal,
      batch: batchRequested,
      onStatus: (statuses) => {
        renderStepStatuses(statuses);
        const items = [...statuses].reverse().find((item) => item.items?.length)?.items || [];
        renderItemResults(items);
      },
    });
    activeRun = { controller, promise };
    try {
      const result = await promise;
      displayOutput(result.output);
      byId("workflowRunState").textContent = "已完成";
      byId("workflowRunState").dataset.status = "success";
    } catch (error) {
      byId("workflowRunState").textContent = error.name === "AbortError" ? "已取消" : "失败";
      byId("workflowRunState").dataset.status = error.name === "AbortError" ? "cancelled" : "failed";
      byId("workflowResultText").value = error.message;
    } finally {
      activeRun = null;
      byId("cancelWorkflowBtn").disabled = true;
      renderInputControls(workflow);
    }
  }

  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = name || "workflow-result"; document.body.appendChild(link); link.click(); link.remove();
    root.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function loadCloudWorkflows() {
    if (accessOptions.offline || !bridge?.apiGet) return;
    try {
      const data = await bridge.apiGet("/api/tools/preferences");
      const configs = Array.isArray(data.configs) ? data.configs.filter((item) => item.tool_id === WORKFLOW_TOOL_ID) : [];
      for (const item of configs) {
        try {
          const remote = validateWorkflow(item.config);
          cloudConfigIds.set(remote.id, item.id);
          const localIndex = workflows.findIndex((workflow) => workflow.id === remote.id);
          if (localIndex < 0 && workflows.length < MAX_WORKFLOWS) workflows.push(remote);
          else if (localIndex >= 0 && Date.parse(remote.updated_at) > Date.parse(workflows[localIndex].updated_at)) workflows[localIndex] = remote;
        } catch (_) { /* Invalid legacy config is ignored instead of poisoning local drafts. */ }
      }
      persistLocalWorkflows();
    } catch (error) {
      setSaveMessage(`云端工作流暂时无法读取，本地草稿仍可使用：${error.message}`, true);
    }
  }

  async function saveCurrentWorkflow() {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    workflow.name = byId("workflowNameInput").value.trim();
    workflow.updated_at = nowIso();
    const validated = validateWorkflow(workflow);
    workflows[workflows.findIndex((item) => item.id === workflow.id)] = validated;
    persistLocalWorkflows();
    renderWorkflowList();
    if (accessOptions.offline) return setSaveMessage("已保存到本机；联网后可再次点击保存同步到云端");
    if (!hasEntitlement("save_tool_config")) return setSaveMessage("已保存到本机；当前会员不包含云端配置保存");
    try {
      const data = await bridge.api("/api/tools/config/save", {
        id: cloudConfigIds.get(validated.id) || "",
        tool_id: WORKFLOW_TOOL_ID,
        name: validated.name,
        config: validated,
      });
      cloudConfigIds.set(validated.id, data.id);
      setSaveMessage("已保存到本机并同步到云端");
    } catch (error) {
      setSaveMessage(`云端保存失败，本地草稿已保留：${error.message}`, true);
    }
  }

  async function deleteCurrentWorkflow() {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    const cloudId = cloudConfigIds.get(workflow.id);
    workflows = workflows.filter((item) => item.id !== workflow.id);
    selectedWorkflowId = workflows[0]?.id || "";
    persistLocalWorkflows();
    renderAll();
    if (cloudId && !accessOptions.offline && hasEntitlement("save_tool_config")) {
      try { await bridge.api("/api/tools/config/delete", { id: cloudId }); cloudConfigIds.delete(workflow.id); }
      catch (error) { setSaveMessage(`本地已删除，但云端删除失败：${error.message}`, true); }
    }
  }

  function duplicateCurrentWorkflow() {
    const workflow = selectedWorkflow();
    if (!workflow || workflows.length >= MAX_WORKFLOWS) return;
    const copy = cloneJson(workflow);
    copy.id = randomId("wf"); copy.name = `${copy.name} 副本`.slice(0, 80); copy.created_at = nowIso(); copy.updated_at = copy.created_at;
    copy.steps = copy.steps.map((step) => ({ ...step, id: randomId("step") }));
    workflows.unshift(validateWorkflow(copy)); selectedWorkflowId = copy.id; persistLocalWorkflows(); renderAll();
  }

  function exportCurrentWorkflow() {
    const workflow = validateWorkflow(selectedWorkflow());
    downloadBlob(`${workflow.name.replace(/[\\/:*?"<>|]+/g, "_")}.workflow.json`, new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" }));
  }

  async function importWorkflowFile(file) {
    if (!file) return;
    if (file.size > MAX_WORKFLOW_BYTES) throw new Error(`工作流 JSON 不能超过 ${Math.round(MAX_WORKFLOW_BYTES / 1024)} KB`);
    const raw = JSON.parse(await file.text());
    let workflow = validateWorkflow(raw);
    if (workflows.some((item) => item.id === workflow.id)) {
      workflow = { ...workflow, id: randomId("wf"), name: `${workflow.name} 导入副本`.slice(0, 80), updated_at: nowIso(), steps: workflow.steps.map((step) => ({ ...step, id: randomId("step") })) };
      workflow = validateWorkflow(workflow);
    }
    if (workflows.length >= MAX_WORKFLOWS) throw new Error(`最多保存 ${MAX_WORKFLOWS} 个工作流`);
    workflows.unshift(workflow); selectedWorkflowId = workflow.id; persistLocalWorkflows(); renderAll();
    setSaveMessage("导入成功，权限将在运行和云端保存时重新验证");
  }

  function renderAccess() {
    const badge = byId("workflowAccessBadge");
    if (!badge) return;
    if (accessOptions.offline) badge.textContent = permissionAvailable("tools_access") ? "离线本地运行" : "需要联网验证";
    else badge.textContent = hasEntitlement("tools_batch_access") ? "支持批量与云端配置" : hasEntitlement("tools_access") ? "支持本地工作流" : "无工作流权限";
  }

  function renderAll() {
    renderWorkflowList();
    renderTemplates();
    renderEditor();
    renderAccess();
  }

  async function show(_path = "/tools/workflows", options = {}) {
    setAccess(options);
    byId("toolsDashboard")?.classList.add("hidden");
    byId("toolWorkbench")?.classList.add("hidden");
    byId("workflowWorkspace")?.classList.remove("hidden");
    byId("workflowWorkspace")?.setAttribute("aria-hidden", "false");
    loadLocalWorkflows();
    renderAll();
    await loadCloudWorkflows();
    renderAll();
  }

  function hide(options = {}) {
    if (options.cancel && activeRun) activeRun.controller.abort();
    byId("workflowWorkspace")?.classList.add("hidden");
    byId("workflowWorkspace")?.setAttribute("aria-hidden", "true");
    void releaseLastOutput();
  }

  function matches(path) {
    return /^\/tools\/workflows\/?$/.test(String(path || ""));
  }

  function init(context) {
    if (initialized) { bridge = context; return; }
    initialized = true;
    bridge = context;
    byId("openWorkflowBtn")?.addEventListener("click", async () => {
      bridge.navigate("/tools/workflows");
      await show("/tools/workflows", accessOptions);
    });
    byId("closeWorkflowBtn")?.addEventListener("click", () => {
      if (activeRun) activeRun.controller.abort();
      hide({ cancel: true });
      byId("toolsDashboard")?.classList.remove("hidden");
      bridge.navigate("/tools");
    });
    byId("createWorkflowBtn")?.addEventListener("click", () => {
      if (workflows.length >= MAX_WORKFLOWS) return setSaveMessage(`最多保存 ${MAX_WORKFLOWS} 个工作流`, true);
      const workflow = blankWorkflow(); workflows.unshift(workflow); selectedWorkflowId = workflow.id; persistLocalWorkflows(); renderAll();
    });
    byId("addWorkflowStepBtn")?.addEventListener("click", () => {
      const workflow = selectedWorkflow(); const toolId = byId("workflowToolSelect").value;
      if (!workflow || !CAPABILITY_REGISTRY[toolId] || workflow.steps.length >= MAX_STEPS) return;
      workflow.steps.push({ id: randomId("step"), tool_id: toolId, enabled: true, config: normalizeConfig(toolId, {}) });
      markWorkflowUpdated(); renderEditor();
    });
    byId("workflowNameInput")?.addEventListener("input", () => {
      const workflow = selectedWorkflow(); if (!workflow) return; workflow.name = byId("workflowNameInput").value.slice(0, 80); markWorkflowUpdated(); renderWorkflowList();
    });
    byId("saveWorkflowBtn")?.addEventListener("click", () => saveCurrentWorkflow().catch((error) => setSaveMessage(error.message, true)));
    byId("duplicateWorkflowBtn")?.addEventListener("click", duplicateCurrentWorkflow);
    byId("deleteWorkflowBtn")?.addEventListener("click", () => deleteCurrentWorkflow());
    byId("exportWorkflowBtn")?.addEventListener("click", () => { try { exportCurrentWorkflow(); } catch (error) { setSaveMessage(error.message, true); } });
    byId("importWorkflowBtn")?.addEventListener("click", () => byId("workflowImportInput").click());
    byId("workflowImportInput")?.addEventListener("change", async (event) => {
      const input = event.currentTarget;
      try { await importWorkflowFile(input.files?.[0]); }
      catch (error) { setSaveMessage(`导入失败：${error.message}`, true); }
      finally { input.value = ""; }
    });
    byId("runWorkflowBtn")?.addEventListener("click", () => runSelectedWorkflow().catch((error) => {
      byId("workflowRunState").textContent = "失败"; byId("workflowRunState").dataset.status = "failed"; byId("workflowResultText").value = error.message;
    }));
    byId("cancelWorkflowBtn")?.addEventListener("click", () => activeRun?.controller.abort());
    byId("downloadWorkflowResultBtn")?.addEventListener("click", () => lastOutput && downloadBlob(lastOutput.name || "workflow-result", lastOutput.value));
    byId("copyWorkflowResultBtn")?.addEventListener("click", () => bridge.copyText(byId("workflowResultText").value));
  }

  root.WYJWorkflows = Object.freeze({
    init,
    show,
    hide,
    matches,
    setAccess,
    schemaVersion: SCHEMA_VERSION,
    registry: Object.freeze(Object.fromEntries(Object.entries(CAPABILITY_REGISTRY).map(([id, item]) => [id, Object.freeze({ ...item, config_schema: CONFIG_SCHEMAS[id] })]))),
    templates: TEMPLATE_DEFINITIONS,
    core: Object.freeze({
      validateWorkflow,
      validateStepSequence,
      normalizeConfig,
      blankWorkflow,
      workflowFromTemplate,
      executeWorkflow,
      createRunner,
      createResource,
      cleanupResource,
      inputTypesFor,
      sequenceOutputTypes,
    }),
    test: Object.freeze({
      selectedWorkflow: () => selectedWorkflow() ? cloneJson(selectedWorkflow()) : null,
      workflows: () => cloneJson(workflows),
      lastOutput: () => lastOutput,
      isRunning: () => Boolean(activeRun),
    }),
  });
})();
