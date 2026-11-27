(() => {
  "use strict";

  const root = typeof window === "undefined" ? globalThis : window;
  /** #7: feedback helper published by js/core/perf.js (classic script boundary). */
  const perf = () => root.WYJPerf;
  async function withFeedback(element, name, action) {
    const helper = perf()?.withInteractionFeedback;
    return helper ? helper(element, name, action) : action();
  }
  const SCHEMA_VERSION = 1;
  const MAX_WORKFLOW_BYTES = 48 * 1024;
  const MAX_WORKFLOWS = 50;
  const MAX_STEPS = 20;
  const MAX_FILES = 50;
  const MAX_IMAGES = 20;
  const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
  const MAX_WORLD_NODE_OFFSET = 4800;
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
  const workflowSessionStates = new Map();
  const activeRunsBySession = new Map();
  let lastSeenAccountId = "";
  let previewUrl = "";
  let extraPreviewUrls = [];
  let pendingFilePickerMode = "replace";
  let draggedStepId = "";

  function currentSessionKey(workflowId = selectedWorkflowId) {
    if (!workflowId) return "";
    return `${accountId()}::${workflowId}`;
  }

  function currentActiveRun() {
    const key = currentSessionKey();
    return key ? activeRunsBySession.get(key) || null : null;
  }

  function currentLastOutput() {
    const key = currentSessionKey();
    return key ? workflowSessionStates.get(key)?.lastOutput || null : null;
  }

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

  function chainOutputForInputType(activeSteps, inputType) {
    if (!activeSteps.length) return new Set();
    let current = new Set([inputType]);
    for (const step of activeSteps) {
      const cap = CAPABILITY_REGISTRY[step.tool_id];
      if (!cap) return new Set();
      const accepted = new Set([...current].filter((type) => cap.input_types.includes(type)));
      if (!accepted.size) return new Set();
      current = outputTypesFor(cap, accepted);
      if (!current.size) return new Set();
    }
    return current;
  }

  function isImageFile(file) {
    if (!file) return false;
    const mime = String(file.type || "").toLowerCase();
    if (mime.startsWith("image/")) return true;
    return /\.(png|jpe?g|webp)$/i.test(String(file.name || ""));
  }

  function isTextDataFile(file) {
    if (!file) return false;
    const mime = String(file.type || "").toLowerCase();
    if (mime.startsWith("text/") || mime === "application/json") return true;
    return /\.(txt|csv|json|tsv|log|md)$/i.test(String(file.name || ""));
  }

  function getWorkflowInputPolicy(workflow) {
    const activeSteps = (workflow?.steps || []).filter((step) => step.enabled);
    if (!activeSteps.length) {
      return {
        ready: false,
        mode: "empty",
        types: [],
        outputTypes: [],
        acceptsText: false,
        acceptsFiles: false,
        multiple: false,
        supportsSingle: false,
        supportsBatch: false,
        requiresBatch: false,
        supportsArchive: false,
        maxFiles: 0,
        maxBytes: MAX_TOTAL_BYTES,
        accept: "",
        unitLabel: "个文件",
        label: "请先添加并启用处理节点",
        hint: "请先在画布中添加并启用至少一个处理节点。",
        dropSub: "请先配置节点",
      };
    }

    let outputTypes = [];
    try {
      outputTypes = [...validateStepSequence(activeSteps)];
    } catch (error) {
      return {
        ready: false,
        mode: "invalid-sequence",
        sequenceError: error.message,
        types: inputTypesFor(workflow),
        outputTypes: [],
        acceptsText: false,
        acceptsFiles: false,
        multiple: false,
        supportsSingle: false,
        supportsBatch: false,
        requiresBatch: false,
        supportsArchive: false,
        maxFiles: 0,
        maxBytes: MAX_TOTAL_BYTES,
        accept: "",
        unitLabel: "个文件",
        label: "节点连接不兼容",
        hint: `当前启用节点序列不兼容：${error.message}`,
        dropSub: "请调整节点顺序",
      };
    }

    const firstCap = CAPABILITY_REGISTRY[activeSteps[0].tool_id];
    const types = [...firstCap.input_types];
    const outForText = types.includes("text") ? chainOutputForInputType(activeSteps, "text") : new Set();
    const outForTextFile = types.includes("text-file") ? chainOutputForInputType(activeSteps, "text-file") : new Set();
    const outForImageSingle = types.includes("image") ? chainOutputForInputType(activeSteps, "image") : new Set();
    const outForImageList = types.includes("image-list") ? chainOutputForInputType(activeSteps, "image-list") : new Set();
    const outForFileList = types.includes("file-list") ? chainOutputForInputType(activeSteps, "file-list") : new Set();

    if (outForFileList.size > 0) {
      return {
        ready: true,
        mode: "file-list",
        types,
        outputTypes,
        acceptsText: false,
        acceptsFiles: true,
        multiple: true,
        supportsSingle: true,
        supportsBatch: true,
        requiresBatch: true,
        supportsArchive: outForFileList.has("archive"),
        maxFiles: MAX_FILES,
        maxBytes: MAX_TOTAL_BYTES,
        accept: "",
        unitLabel: "个文件",
        label: `选择或追加多文件（最多 ${MAX_FILES} 个）`,
        hint: `首步输入：${formatTypesLabel(types)}；支持单次或分次多选，最多 ${MAX_FILES} 个文件且总计不超过 ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB。`,
        dropSub: `或拖拽到此处（最多 ${MAX_FILES} 个，支持追加）`,
      };
    }

    if (outForImageSingle.size > 0 || outForImageList.size > 0) {
      const supportsSingle = outForImageSingle.size > 0;
      const supportsBatch = outForImageList.size > 0;
      const supportsArchive = outForImageList.has("archive") || outForImageSingle.has("archive");
      const maxFiles = supportsBatch ? MAX_IMAGES : 1;
      return {
        ready: true,
        mode: supportsBatch ? "image-batch" : "image-single",
        types,
        outputTypes,
        acceptsText: false,
        acceptsFiles: true,
        multiple: supportsBatch,
        supportsSingle,
        supportsBatch,
        requiresBatch: !supportsSingle && supportsBatch,
        supportsArchive,
        maxFiles,
        maxBytes: MAX_TOTAL_BYTES,
        accept: "image/png,image/jpeg,image/webp",
        unitLabel: "张图片",
        label: supportsBatch ? `选择图片（支持批量，最多 ${maxFiles} 张）` : "选择单张图片（最多 1 张）",
        hint: supportsBatch
          ? `首步输入：${formatTypesLabel(types)}；支持多选、拖拽及分次追加，最多 ${maxFiles} 张图片，总计不超过 ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB。`
          : `首步输入：${formatTypesLabel(types)}；当前工作流仅支持单张图片（1 张），不超过 ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB。`,
        dropSub: supportsBatch ? `或拖拽到此处（最多 ${maxFiles} 张，支持多选与追加）` : "或拖拽 1 张图片到此处",
      };
    }

    if (outForTextFile.size > 0) {
      return {
        ready: true,
        mode: "text-file",
        types,
        outputTypes,
        acceptsText: false,
        acceptsFiles: true,
        multiple: false,
        supportsSingle: true,
        supportsBatch: false,
        requiresBatch: false,
        supportsArchive: outForTextFile.has("archive"),
        maxFiles: 1,
        maxBytes: MAX_TOTAL_BYTES,
        accept: ".txt,.csv,.json,text/plain,text/csv,application/json",
        unitLabel: "个文本文件",
        label: "选择 1 个文本或数据文件",
        hint: `首步输入：${formatTypesLabel(types)}；当前工作流仅支持 1 个文件（.txt/.csv/.json），不超过 ${Math.round(MAX_TOTAL_BYTES / (1024 * 1024))} MB。`,
        dropSub: "或拖拽 1 个文本/CSV/JSON 文件到此处",
      };
    }

    if (outForText.size > 0) {
      return {
        ready: true,
        mode: "text",
        types,
        outputTypes,
        acceptsText: true,
        acceptsFiles: false,
        multiple: false,
        supportsSingle: true,
        supportsBatch: false,
        requiresBatch: false,
        supportsArchive: outForText.has("archive"),
        maxFiles: 0,
        maxBytes: MAX_TOTAL_BYTES,
        accept: "",
        unitLabel: "段文本",
        label: "输入文本",
        hint: `首步输入：${formatTypesLabel(types)}；请在下方文本框输入或粘贴内容。`,
        dropSub: "",
      };
    }

    return {
      ready: false,
      mode: "unsupported-start",
      types,
      outputTypes,
      acceptsText: false,
      acceptsFiles: false,
      multiple: false,
      supportsSingle: false,
      supportsBatch: false,
      requiresBatch: false,
      supportsArchive: false,
      maxFiles: 0,
      maxBytes: MAX_TOTAL_BYTES,
      accept: "",
      unitLabel: "个文件",
      label: "首节点需要前置输入转换",
      hint: `首个启用节点需要 ${formatTypesLabel(types)}，请在其前方添加对应的输入步骤。`,
      dropSub: "",
    };
  }

  function fileMatchErrorForPolicy(policy, file) {
    if (!file) return "文件无效";
    if (policy.mode === "image-batch" || policy.mode === "image-single") {
      if (!isImageFile(file)) return "格式不符（需 PNG/JPG/WebP 图片）";
      return "";
    }
    if (policy.mode === "text-file") {
      if (!isTextDataFile(file)) return "格式不符（需文本/CSV/JSON 文件）";
      return "";
    }
    if (policy.mode === "file-list") return "";
    return "当前工作流不需要文件输入";
  }

  function validateInputFilesForPolicy(policy, files = []) {
    if (!policy.ready) {
      return { valid: false, reason: "policy", message: policy.hint || "当前工作流尚未就绪" };
    }
    if (!policy.acceptsFiles) {
      return { valid: false, reason: "no-file-input", message: policy.hint };
    }
    const list = Array.isArray(files) ? [...files] : [];
    if (!list.length) {
      return { valid: false, reason: "empty", message: policy.mode === "image-batch" || policy.mode === "image-single" ? "请选择输入图片" : "请选择输入文件" };
    }
    const typeIssues = list
      .map((file, index) => ({ index, file, issue: fileMatchErrorForPolicy(policy, file) }))
      .filter((entry) => Boolean(entry.issue));
    if (typeIssues.length) {
      return {
        valid: false,
        reason: "type",
        typeIssues,
        message: `有 ${typeIssues.length} 个文件格式与当前工作流不兼容：${typeIssues.slice(0, 3).map((item) => item.file.name).join("、")}${typeIssues.length > 3 ? " 等" : ""}`,
      };
    }
    if (list.length > policy.maxFiles) {
      const excessCount = list.length - policy.maxFiles;
      return {
        valid: false,
        reason: "count",
        excessCount,
        message: policy.maxFiles === 1
          ? `当前工作流仅支持 1 ${policy.unitLabel}，已多出 ${excessCount} 个；超限文件未加入待执行队列，请移除多余项。`
          : `已选择 ${list.length} ${policy.unitLabel}，超出上限 ${policy.maxFiles} ${policy.unitLabel}（多出 ${excessCount} 项）；超限文件未加入待执行队列，请移除多余项。`,
      };
    }
    const totalBytes = fileSizeTotal(list);
    if (totalBytes > policy.maxBytes) {
      const excessBytes = totalBytes - policy.maxBytes;
      return {
        valid: false,
        reason: "size",
        excessBytes,
        totalBytes,
        message: `总大小 ${formatBytes(totalBytes)} 超出上限 ${formatBytes(policy.maxBytes)}（超出 ${formatBytes(excessBytes)}）；超限文件未加入待执行队列，请移除部分文件。`,
      };
    }
    return { valid: true, totalBytes, count: list.length };
  }

  function resourceFromFiles(workflow, files, batchRequested) {
    const policy = getWorkflowInputPolicy(workflow);
    const check = validateInputFilesForPolicy(policy, files);
    if (!check.valid) throw new Error(check.message);
    if (policy.mode === "text-file") {
      return createResource("text-file", files[0], { name: files[0].name, mime: files[0].type, owned: false });
    }
    if (policy.mode === "image-batch" || policy.mode === "image-single") {
      const batch = policy.requiresBatch || Boolean(batchRequested) || files.length > 1;
      if (batch) {
        if (!policy.supportsBatch) throw new Error("当前工作流仅支持单张图片");
        return createResource("image-list", files.map((file) => ({ name: file.name, status: "success", resource: createResource("image", file, { name: file.name, mime: file.type, owned: false }) })), { owned: false });
      }
      return createResource("image", files[0], { name: files[0].name, mime: files[0].type, owned: false });
    }
    if (policy.mode === "file-list") {
      return createResource("file-list", files.map((file) => ({ name: file.name, status: "success", resource: createResource("file", file, { name: file.name, mime: file.type, owned: false }) })), { owned: false });
    }
    throw new Error("所选文件类型与首个步骤不兼容");
  }

  const CAPABILITY_META = Object.freeze({
    "text-encoding": { category: "text", categoryLabel: "文本处理", icon: "text", description: "按指定字符编码读取本地文本或表格文件，输出标准 UTF-8 文本。" },
    "remove-empty-lines": { category: "text", categoryLabel: "文本处理", icon: "trimLines", description: "移除所有空白行，保留有效文本行顺序。" },
    "dedupe-lines": { category: "text", categoryLabel: "文本处理", icon: "dedupe", description: "按首次出现顺序去除完全重复的行。" },
    "sort-lines": { category: "text", categoryLabel: "文本处理", icon: "sort", description: "对全部文本行执行升序或降序排列。" },
    "csv-json": { category: "convert", categoryLabel: "数据转换", icon: "table", description: "将带表头的 CSV 文本解析为结构化 JSON 对象数组。" },
    "json-csv": { category: "convert", categoryLabel: "数据转换", icon: "table", description: "将 JSON 对象数组序列化为标准逗号分隔 CSV 文本。" },
    "text-split": { category: "archive", categoryLabel: "文件打包", icon: "split", description: "按指定行数切分长文本，并打包为多文件 ZIP 压缩包。" },
    "image-resize": { category: "image", categoryLabel: "图片处理", icon: "resize", description: "按目标像素宽高重新调整单张或批量图片尺寸。" },
    "image-format": { category: "image", categoryLabel: "图片处理", icon: "format", description: "将图片转换为 PNG、JPG 或 WebP，并可调节输出质量。" },
    "text-watermark": { category: "image", categoryLabel: "图片处理", icon: "watermark", description: "在图片右下角叠加半透明文字水印与指定颜色。" },
    "exif-remove": { category: "image", categoryLabel: "图片处理", icon: "shield", description: "清除图片中的 EXIF 元数据与拍摄隐私信息。" },
    "files-zip": { category: "archive", categoryLabel: "文件打包", icon: "zip", description: "将多文件或批量图片结果就地打包为单个 ZIP 文件。" },
  });

  const NODE_CATEGORIES = Object.freeze([
    { id: "all", label: "全部" },
    { id: "text", label: "文本处理" },
    { id: "convert", label: "数据转换" },
    { id: "image", label: "图片处理" },
    { id: "archive", label: "文件打包" },
  ]);

  const TYPE_LABELS = Object.freeze({
    "text-file": "文本文件",
    text: "文本",
    json: "JSON",
    image: "单张图片",
    "image-list": "批量图片",
    "file-list": "多文件",
    archive: "ZIP 压缩包",
  });

  const WF_ICON_PATHS = Object.freeze({
    text: '<path d="M4 6h16M4 12h11M4 18h14"/>',
    trimLines: '<path d="M4 6h16M4 18h16M8 12h8"/><path d="m12 8-2 2h4l-2-2zm0 8-2-2h4l-2 2z"/>',
    dedupe: '<path d="M4 7h11M4 12h8M4 17h11"/><path d="m16 10 2 2 3-3"/>',
    sort: '<path d="M7 5v14M4 16l3 3 3-3M14 7h6M14 12h4M14 17h2"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 10v10"/>',
    split: '<path d="M4 6h6v12H4zM14 6h6v12h-6zM12 4v16"/>',
    resize: '<path d="M15 4h5v5M20 4l-6 6M9 20H4v-5M4 20l6-6"/>',
    format: '<path d="M7 7h10l-2.5-2.5M17 17H7l2.5 2.5M17 7v4M7 17v-4"/>',
    watermark: '<path d="M4 7h16M8 7v10M16 7v10M6 17h12"/>',
    shield: '<path d="M12 3 5 6v6c0 4.5 3 7.8 7 9 4-1.2 7-4.5 7-9V6z"/><path d="m9.5 12 2 2 3.5-4"/>',
    zip: '<path d="M6 3h8l4 4v14H6z"/><path d="M12 6v2M12 10v2M12 14v2M10 17h4"/>',
    play: '<polygon points="6 4 20 12 6 20 6 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    arrowRight: '<path d="m9 6 6 6-6 6"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  });

  const COLOR_SWATCHES = Object.freeze(["#ffffff", "#242424", "#b83328", "#2d5a9e"]);

  let viewMode = "list";
  let selectedStepId = "";
  let runnerExpanded = false;
  let workflowSearchQuery = "";
  let pickerOpen = false;
  let pickerInsertIndex = -1;
  let pickerCategory = "all";
  let pickerSearchQuery = "";
  let pickerActiveIndex = 0;
  let openRowMenuId = "";
  let canvasViewport = { panX: 0, panY: 0, zoom: 1 };
  let canvasNodeOffsets = {};
  let currentRunEpoch = 0;
  let execVisualState = null;
  const nodeShiftAnims = new Map();
  let lastStatuses = [];
  let lastRunError = null;
  let edgeSyncRaf = 0;
  let edgeSyncUntil = 0;
  let pointerDragState = null;
  let canvasPanState = null;
  let canvasResizeObserver = null;
  let pickerReturnFocus = null;
  let listFeedbackTimer = 0;
  let canvasAlertTimer = 0;

  function isReducedMotion() {
    return Boolean(
      root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
      || root.document?.documentElement?.dataset?.androidReducedMotion === "true",
    );
  }

  function isMobileCanvas() {
    return (root.innerWidth || 1280) <= 768;
  }

  function capabilityIconSvg(toolId, className = "wf-svg-icon") {
    const iconName = CAPABILITY_META[toolId]?.icon || "text";
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${WF_ICON_PATHS[iconName] || WF_ICON_PATHS.text}</svg>`;
  }

  function uiIconSvg(name, className = "wf-svg-icon") {
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${WF_ICON_PATHS[name] || WF_ICON_PATHS.text}</svg>`;
  }

  function formatTypesLabel(types = []) {
    return (types || []).map((t) => TYPE_LABELS[t] || t).join(" / ");
  }

  function formatTimestamp(iso) {
    const ms = Date.parse(String(iso || ""));
    if (!Number.isFinite(ms)) return "刚刚";
    try {
      const date = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    } catch (_) {
      return String(iso).slice(0, 16).replace("T", " ");
    }
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function summarizeStepConfig(step) {
    const schema = CONFIG_SCHEMAS[step.tool_id] || {};
    const cfg = step.config || {};
    if (step.tool_id === "text-encoding") return `编码 ${String(cfg.encoding || "utf-8").toUpperCase()}`;
    if (step.tool_id === "sort-lines") return schema.order?.labels?.[cfg.order] || cfg.order || "升序";
    if (step.tool_id === "text-split") return `每份 ${cfg.lines ?? 1000} 行`;
    if (step.tool_id === "image-resize") return `${cfg.width ?? 1200} × ${cfg.height ?? 1200} px`;
    if (step.tool_id === "image-format") {
      const fmt = schema.format?.labels?.[cfg.format] || cfg.format || "WebP";
      return `${fmt} · 质量 ${Math.round(Number(cfg.quality ?? 0.85) * 100)}%`;
    }
    if (step.tool_id === "text-watermark") {
      const text = String(cfg.text || "WYJ");
      const clipped = text.length > 12 ? `${text.slice(0, 12)}…` : text;
      return `“${clipped}” · ${cfg.color || "#ffffff"}`;
    }
    return "无需额外参数";
  }

  function workflowFlowSummary(workflow) {
    const active = (workflow?.steps || []).filter((s) => s.enabled);
    if (!active.length) return { inputLabel: "未配置", outputLabel: "未配置" };
    const inTypes = inputTypesFor(workflow);
    let outTypes = [];
    try { outTypes = sequenceOutputTypes(workflow); } catch (_) { outTypes = []; }
    return {
      inputLabel: formatTypesLabel(inTypes) || "未配置",
      outputLabel: formatTypesLabel(outTypes) || "不兼容",
    };
  }

  function canvasUiStorageKey() {
    return `wyjWorkflowCanvasUi:v1:${accountId()}`;
  }

  function clampNodeOffset(x, y) {
    const nx = Number.isFinite(Number(x)) ? Math.max(-MAX_WORLD_NODE_OFFSET, Math.min(MAX_WORLD_NODE_OFFSET, Number(x))) : 0;
    const ny = Number.isFinite(Number(y)) ? Math.max(-MAX_WORLD_NODE_OFFSET, Math.min(MAX_WORLD_NODE_OFFSET, Number(y))) : 0;
    return { x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10 };
  }

  function sanitizeNodeOffsets(rawOffsets, workflow) {
    const validIds = workflow?.steps ? new Set(workflow.steps.map((s) => s.id)) : null;
    const out = {};
    if (!rawOffsets || typeof rawOffsets !== "object") return out;
    for (const [stepId, val] of Object.entries(rawOffsets)) {
      if (validIds && !validIds.has(stepId)) continue;
      if (!val || typeof val !== "object") continue;
      const clamped = clampNodeOffset(val.x, val.y);
      if (Math.abs(clamped.x) >= 0.5 || Math.abs(clamped.y) >= 0.5) out[stepId] = clamped;
    }
    return out;
  }

  function getStepOffset(stepId) {
    const val = canvasNodeOffsets?.[stepId];
    return val ? { x: Number(val.x) || 0, y: Number(val.y) || 0 } : { x: 0, y: 0 };
  }

  function loadCanvasUiFor(workflowId, workflow = null) {
    if (!workflowId) return { viewport: { panX: 0, panY: 0, zoom: 1 }, nodeOffsets: {}, hasSaved: false };
    try {
      const map = JSON.parse(safeLocalGet(canvasUiStorageKey()) || "{}");
      const saved = map?.[workflowId];
      if (saved && typeof saved === "object") {
        const viewport = Number.isFinite(saved.zoom) && Number.isFinite(saved.panX) && Number.isFinite(saved.panY)
          ? {
            panX: Number(saved.panX),
            panY: Number(saved.panY),
            zoom: Math.min(1.8, Math.max(0.32, Number(saved.zoom))),
          }
          : { panX: 0, panY: 0, zoom: 1 };
        const nodeOffsets = sanitizeNodeOffsets(saved.nodeOffsets, workflow);
        return { viewport, nodeOffsets, hasSaved: Number.isFinite(saved.zoom) };
      }
    } catch (_) {}
    return { viewport: { panX: 0, panY: 0, zoom: 1 }, nodeOffsets: {}, hasSaved: false };
  }

  function loadCanvasViewportFor(workflowId) {
    return loadCanvasUiFor(workflowId).viewport;
  }

  function persistCanvasViewport() {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    canvasNodeOffsets = sanitizeNodeOffsets(canvasNodeOffsets, workflow);
    try {
      const map = JSON.parse(safeLocalGet(canvasUiStorageKey()) || "{}");
      map[workflow.id] = {
        panX: Math.round(canvasViewport.panX),
        panY: Math.round(canvasViewport.panY),
        zoom: Number(canvasViewport.zoom.toFixed(3)),
        nodeOffsets: canvasNodeOffsets,
      };
      safeLocalSet(canvasUiStorageKey(), JSON.stringify(map));
    } catch (_) {}
  }

  function removeCanvasUiFor(workflowId) {
    if (!workflowId) return;
    try {
      const map = JSON.parse(safeLocalGet(canvasUiStorageKey()) || "{}");
      if (map && Object.prototype.hasOwnProperty.call(map, workflowId)) {
        delete map[workflowId];
        safeLocalSet(canvasUiStorageKey(), JSON.stringify(map));
      }
    } catch (_) {}
  }

  function syncNodeTraceGeometry(node) {
    const svg = node?.querySelector?.(".wf-node-trace-svg");
    const rect = node?.querySelector?.(".wf-node-trace-rect");
    if (!rect || !node) return;
    if (svg && node.isConnected && typeof root.getComputedStyle === "function") {
      const pos = root.getComputedStyle(svg)?.position;
      if (pos && pos !== "absolute") {
        svg.setAttribute("width", "0");
        svg.setAttribute("height", "0");
        return;
      }
      svg.removeAttribute("width");
      svg.removeAttribute("height");
    }
    const w = Math.max(12, node.offsetWidth - 2);
    const h = Math.max(12, node.offsetHeight - 2);
    rect.setAttribute("x", "1");
    rect.setAttribute("y", "1");
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "13");
    rect.setAttribute("ry", "13");
  }

  function applyNodeOffsetsToDom(list, workflow) {
    if (!list) return;
    canvasNodeOffsets = sanitizeNodeOffsets(canvasNodeOffsets, workflow);
    const mobile = isMobileCanvas();
    list.querySelectorAll(":scope > li.wf-node").forEach((node) => {
      const off = mobile ? { x: 0, y: 0 } : getStepOffset(node.dataset.stepId);
      node.style.setProperty("--wf-off-x", `${off.x.toFixed(1)}px`);
      node.style.setProperty("--wf-off-y", `${off.y.toFixed(1)}px`);
      syncNodeTraceGeometry(node);
    });
  }

  function applyCanvasTransform({ animate = false } = {}) {
    const stage = byId("workflowCanvasStage");
    const grid = byId("workflowCanvasGrid");
    const readout = byId("canvasZoomResetBtn");
    if (!stage) return;
    const reduced = isReducedMotion();
    if (animate && !reduced) stage.classList.add("is-animating");
    else stage.classList.remove("is-animating");
    const mobile = isMobileCanvas();
    if (mobile) {
      stage.style.transform = "";
      stage.style.transformOrigin = "";
    } else {
      stage.style.transform = `translate3d(${canvasViewport.panX.toFixed(1)}px, ${canvasViewport.panY.toFixed(1)}px, 0) scale(${canvasViewport.zoom.toFixed(3)})`;
      stage.style.transformOrigin = "0 0";
    }
    if (grid) {
      const effectiveZoom = mobile ? 1 : canvasViewport.zoom;
      const step = Math.max(12, 20 * effectiveZoom);
      grid.style.backgroundSize = `${step.toFixed(1)}px ${step.toFixed(1)}px`;
      grid.style.backgroundPosition = mobile
        ? "0px 0px"
        : `${(canvasViewport.panX % step).toFixed(1)}px ${(canvasViewport.panY % step).toFixed(1)}px`;
    }
    if (readout) readout.textContent = `${Math.round((mobile ? 1 : canvasViewport.zoom) * 100)}%`;
  }

  function fitCanvasToView({ animate = true } = {}) {
    const viewport = byId("workflowCanvasViewport");
    const stage = byId("workflowCanvasStage");
    if (!viewport || !stage) return;
    if (isMobileCanvas()) {
      canvasViewport = { panX: 0, panY: 0, zoom: 1 };
      applyCanvasTransform({ animate });
      scheduleEdgeSync(animate ? 260 : 0);
      return;
    }
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (!vw || !vh) return;
    const list = byId("workflowStepList");
    const trailing = byId("canvasTrailingAddBtn");
    const nodes = [...(list ? list.querySelectorAll(":scope > li.wf-node") : [])];
    const listLeft = list ? list.offsetLeft : 0;
    const listTop = list ? list.offsetTop : 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const off = getStepOffset(node.dataset.stepId);
      const left = listLeft + node.offsetLeft + off.x;
      const top = listTop + node.offsetTop + off.y;
      const right = left + node.offsetWidth;
      const bottom = top + node.offsetHeight;
      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }
    if (trailing && !trailing.classList.contains("hidden")) {
      const tLeft = listLeft + trailing.offsetLeft;
      const tTop = listTop + trailing.offsetTop;
      minX = Math.min(minX, tLeft);
      minY = Math.min(minY, tTop);
      maxX = Math.max(maxX, tLeft + trailing.offsetWidth);
      maxY = Math.max(maxY, tTop + trailing.offsetHeight);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 280;
      maxY = 180;
    }
    minX -= 56;
    minY -= 44;
    maxX += 64;
    maxY += 44;
    const flowW = Math.max(maxX - minX, 280);
    const flowH = Math.max(maxY - minY, 220);
    const fitZoom = Math.min((vw - 32) / flowW, (vh - 32) / flowH);
    const zoom = flowW <= vw - 24 && flowH <= vh - 24 ? 1 : Math.min(1, Math.max(0.32, fitZoom));
    const contentCX = (minX + maxX) / 2;
    const contentCY = (minY + maxY) / 2;
    const panX = Math.round(vw / 2 - contentCX * zoom);
    const panY = Math.round(vh / 2 - contentCY * zoom);
    canvasViewport = { panX, panY, zoom };
    applyCanvasTransform({ animate });
    persistCanvasViewport();
    scheduleEdgeSync(animate ? 280 : 0);
  }

  function setCanvasZoom(nextZoom, focalClientX = null, focalClientY = null) {
    const viewport = byId("workflowCanvasViewport");
    const clamped = Math.min(1.8, Math.max(0.32, Number(nextZoom) || 1));
    if (viewport && focalClientX !== null && focalClientY !== null && !isMobileCanvas()) {
      const rect = viewport.getBoundingClientRect();
      const vx = focalClientX - rect.left;
      const vy = focalClientY - rect.top;
      const worldX = (vx - canvasViewport.panX) / canvasViewport.zoom;
      const worldY = (vy - canvasViewport.panY) / canvasViewport.zoom;
      canvasViewport.zoom = clamped;
      canvasViewport.panX = vx - worldX * clamped;
      canvasViewport.panY = vy - worldY * clamped;
    } else {
      canvasViewport.zoom = clamped;
    }
    applyCanvasTransform({ animate: false });
    persistCanvasViewport();
    syncCanvasEdges();
  }

  function setSaveMessage(message, error = false) {
    const element = byId("workflowSaveState");
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("error", Boolean(error));
    element.dataset.tone = error ? "error" : message ? "saved" : "idle";
  }

  function setListFeedback(message, error = false) {
    const el = byId("workflowListFeedback");
    if (!el) return;
    if (listFeedbackTimer) root.clearTimeout(listFeedbackTimer);
    if (!message) {
      el.textContent = "";
      el.classList.add("hidden");
      delete el.dataset.tone;
      return;
    }
    el.textContent = message;
    el.classList.remove("hidden");
    el.dataset.tone = error ? "error" : "info";
    if (!error) {
      listFeedbackTimer = root.setTimeout(() => {
        el.classList.add("hidden");
      }, 4000);
    }
  }

  function showCanvasAlert(message, tone = "error") {
    const el = byId("workflowCanvasAlert");
    if (!el) return;
    if (canvasAlertTimer) root.clearTimeout(canvasAlertTimer);
    if (!message) {
      el.textContent = "";
      el.classList.add("hidden");
      delete el.dataset.tone;
      return;
    }
    el.textContent = message;
    el.classList.remove("hidden");
    el.dataset.tone = tone;
    canvasAlertTimer = root.setTimeout(() => {
      if (el.isConnected) el.classList.add("hidden");
    }, 5200);
  }

  function markWorkflowUpdated() {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    workflow.updated_at = nowIso();
    persistLocalWorkflows();
    setSaveMessage("本地已保存，点击保存可同步云端");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function setViewMode(nextMode, options = {}) {
    viewMode = nextMode === "editor" ? "editor" : "list";
    const workspace = byId("workflowWorkspace");
    if (workspace) workspace.dataset.wfView = viewMode;
    openRowMenuId = "";
    closeEditorMoreMenu();
    if (viewMode === "list") {
      closeNodePicker({ restoreFocus: false });
      selectedStepId = "";
      syncInspectorVisibility();
      renderWorkflowList();
      renderTemplates();
    } else {
      if (options.openRunner) setRunnerExpanded(true, { scroll: true });
      else if (options.closeRunner) setRunnerExpanded(false);
      renderEditor({ fitView: options.fitView !== false });
    }
  }

  function setRunnerExpanded(expanded, options = {}) {
    runnerExpanded = Boolean(expanded);
    const workspace = byId("workflowWorkspace");
    const panel = byId("workflowRunnerPanel");
    const toggleBtn = byId("toggleWorkflowRunnerBtn");
    if (workspace) workspace.dataset.wfRunner = runnerExpanded ? "open" : "closed";
    if (panel) panel.setAttribute("aria-hidden", String(!runnerExpanded));
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", String(runnerExpanded));
    if (runnerExpanded && options.scroll && panel) {
      root.requestAnimationFrame?.(() => {
        panel.scrollIntoView?.({ block: "nearest", behavior: isReducedMotion() ? "auto" : "smooth" });
      });
    }
  }

  function syncInspectorVisibility() {
    const workspace = byId("workflowWorkspace");
    const panel = byId("workflowInspectorPanel");
    const workflow = selectedWorkflow();
    const step = workflow?.steps?.find((item) => item.id === selectedStepId) || null;
    const isOpen = viewMode === "editor" && Boolean(step);
    if (!step) selectedStepId = "";
    if (workspace) workspace.dataset.wfInspector = isOpen ? "open" : "closed";
    if (panel) panel.setAttribute("aria-hidden", String(!isOpen));
    byId("workflowStepList")?.querySelectorAll("[data-step-id]").forEach((node) => {
      node.dataset.selected = String(node.dataset.stepId === selectedStepId);
    });
  }

  function closeEditorMoreMenu() {
    const btn = byId("workflowMoreMenuBtn");
    const menu = byId("workflowEditorMoreMenu");
    if (menu) menu.classList.add("hidden");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function renderWorkflowList() {
    const target = byId("workflowList");
    const countBadge = byId("workflowCountBadge");
    if (countBadge) countBadge.textContent = String(workflows.length);
    if (!target) return;
    const q = workflowSearchQuery.trim().toLowerCase();
    const filtered = q
      ? workflows.filter((wf) => {
        if (wf.name.toLowerCase().includes(q)) return true;
        return wf.steps.some((step) => {
          const cap = CAPABILITY_REGISTRY[step.tool_id];
          return step.tool_id.toLowerCase().includes(q) || (cap?.name || "").toLowerCase().includes(q);
        });
      })
      : workflows;

    if (!workflows.length) {
      target.innerHTML = `<div class="wf-empty-box">
        <p class="workflow-empty">还没有保存的工作流。可以从空白画布创建，或直接选用下方内置模板。</p>
        <button class="primary" type="button" data-wf-empty-create>新建空白工作流</button>
      </div>`;
      target.querySelector("[data-wf-empty-create]")?.addEventListener("click", () => createAndOpenBlankWorkflow());
      return;
    }

    if (!filtered.length) {
      target.innerHTML = `<div class="wf-empty-box">
        <p class="workflow-empty">没有匹配“${escapeHtml(workflowSearchQuery)}”的工作流。</p>
        <button class="button-secondary" type="button" data-wf-clear-search>清空筛选</button>
      </div>`;
      target.querySelector("[data-wf-clear-search]")?.addEventListener("click", () => {
        workflowSearchQuery = "";
        const input = byId("workflowSearchInput");
        if (input) input.value = "";
        renderWorkflowList();
      });
      return;
    }

    target.innerHTML = filtered.map((workflow) => {
      const flow = workflowFlowSummary(workflow);
      const isSynced = cloudConfigIds.has(workflow.id);
      const isMenuOpen = openRowMenuId === workflow.id;
      const isActive = workflow.id === selectedWorkflowId;
      return `<article class="wf-list-row${isActive ? " is-selected" : ""}" role="listitem" data-workflow-row="${workflow.id}">
        <button class="wf-row-main${isActive ? " active" : ""}" type="button" data-workflow-id="${workflow.id}">
          <div class="wf-row-head">
            <strong class="wf-row-title">${escapeHtml(workflow.name)}</strong>
            ${isSynced ? '<span class="wf-sync-tag">已同步</span>' : '<span class="wf-local-tag">本机草稿</span>'}
          </div>
          <div class="wf-row-meta">
            <span>${workflow.steps.length} 个步骤</span>
            <span class="wf-row-flow">${escapeHtml(flow.inputLabel)} → ${escapeHtml(flow.outputLabel)}</span>
            <time datetime="${escapeHtml(workflow.updated_at)}">${escapeHtml(formatTimestamp(workflow.updated_at))}</time>
          </div>
        </button>
        <div class="wf-row-actions">
          <button class="button-secondary wf-row-btn" type="button" data-wf-edit="${workflow.id}">编辑</button>
          <button class="button-ghost wf-row-btn" type="button" data-wf-run="${workflow.id}">运行</button>
          <div class="wf-row-menu-wrap">
            <button class="button-ghost wf-icon-btn" type="button" data-wf-row-menu="${workflow.id}" aria-haspopup="menu" aria-expanded="${isMenuOpen}" aria-label="更多操作：${escapeHtml(workflow.name)}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>
            </button>
            <div class="wf-popover-menu${isMenuOpen ? "" : " hidden"}" role="menu" aria-label="工作流操作">
              <button type="button" role="menuitem" data-wf-row-dup="${workflow.id}">复制流程</button>
              <button type="button" role="menuitem" data-wf-row-export="${workflow.id}">导出 JSON</button>
              <div class="wf-menu-divider" role="separator"></div>
              <button type="button" role="menuitem" class="danger-text" data-wf-row-delete="${workflow.id}">删除</button>
            </div>
          </div>
        </div>
      </article>`;
    }).join("");

    target.querySelectorAll("[data-workflow-id]").forEach((button) => button.addEventListener("click", () => {
      openWorkflowInEditor(button.dataset.workflowId);
    }));
    target.querySelectorAll("[data-wf-edit]").forEach((button) => button.addEventListener("click", () => {
      openWorkflowInEditor(button.dataset.wfEdit);
    }));
    target.querySelectorAll("[data-wf-run]").forEach((button) => button.addEventListener("click", () => {
      openWorkflowInEditor(button.dataset.wfRun, { openRunner: true });
    }));
    target.querySelectorAll("[data-wf-row-menu]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = button.dataset.wfRowMenu;
      openRowMenuId = openRowMenuId === id ? "" : id;
      renderWorkflowList();
      if (openRowMenuId) {
        const firstItem = target.querySelector(`[data-workflow-row="${id}"] [role="menuitem"]`);
        firstItem?.focus?.({ preventScroll: true });
      }
    }));
    target.querySelectorAll("[data-wf-row-dup]").forEach((button) => button.addEventListener("click", () => {
      duplicateWorkflowById(button.dataset.wfRowDup);
    }));
    target.querySelectorAll("[data-wf-row-export]").forEach((button) => button.addEventListener("click", () => {
      try {
        const wf = workflows.find((item) => item.id === button.dataset.wfRowExport);
        if (wf) exportWorkflowObject(wf);
      } catch (error) { setListFeedback(error.message, true); }
      openRowMenuId = "";
      renderWorkflowList();
    }));
    target.querySelectorAll("[data-wf-row-delete]").forEach((button) => button.addEventListener("click", () => {
      void deleteWorkflowById(button.dataset.wfRowDelete);
    }));
  }

  function renderTemplates() {
    const target = byId("workflowTemplateList");
    if (!target) return;
    target.innerHTML = TEMPLATE_DEFINITIONS.map((template) => {
      const dummyWorkflow = {
        steps: template.steps.map(([toolId, cfg], idx) => ({
          id: `step_tpl_${idx}`,
          tool_id: toolId,
          enabled: true,
          config: cfg || {},
        })),
      };
      const flow = workflowFlowSummary(dummyWorkflow);
      const miniSteps = template.steps.map(([toolId], idx) => {
        const capName = CAPABILITY_REGISTRY[toolId]?.name || toolId;
        return `<span class="wf-tpl-node" title="${escapeHtml(capName)}">${capabilityIconSvg(toolId, "wf-tpl-node-icon")}<span>${escapeHtml(capName)}</span></span>${idx < template.steps.length - 1 ? `<span class="wf-tpl-arrow" aria-hidden="true">${uiIconSvg("arrowRight", "wf-tpl-arrow-svg")}</span>` : ""}`;
      }).join("");
      return `<button class="wf-template-card" type="button" data-workflow-template="${template.id}">
        <div class="wf-tpl-head">
          <strong>${escapeHtml(template.name)}</strong>
          <span class="wf-tpl-io">${escapeHtml(flow.inputLabel)} → ${escapeHtml(flow.outputLabel)}</span>
        </div>
        <p class="wf-tpl-desc">${escapeHtml(template.description)}</p>
        <div class="wf-tpl-flow" aria-hidden="true">${miniSteps}</div>
      </button>`;
    }).join("");

    target.querySelectorAll("[data-workflow-template]").forEach((button) => button.addEventListener("click", () => {
      if (workflows.length >= MAX_WORKFLOWS) {
        setListFeedback(`最多保存 ${MAX_WORKFLOWS} 个工作流`, true);
        setSaveMessage(`最多保存 ${MAX_WORKFLOWS} 个工作流`, true);
        return;
      }
      const workflow = workflowFromTemplate(button.dataset.workflowTemplate);
      workflows.unshift(workflow);
      selectedWorkflowId = workflow.id;
      selectedStepId = "";
      clearSessionState(workflow.id);
      resetRunnerUiState(getSessionState(workflow.id, workflow));
      canvasViewport = { panX: 0, panY: 0, zoom: 1 };
      canvasNodeOffsets = {};
      persistLocalWorkflows();
      setSaveMessage("已从模板创建，点击保存可同步云端");
      setViewMode("editor", { fitView: true, closeRunner: true });
    }));
  }

  function createEmptySessionState(workflow = null) {
    const policy = workflow ? getWorkflowInputPolicy(workflow) : null;
    return {
      workflowId: workflow?.id || "",
      queuedFiles: [],
      rejectedFiles: [],
      inputValidation: null,
      textInput: "",
      batchRequested: Boolean(policy?.requiresBatch),
      batchTouched: false,
      runState: { status: "waiting", label: "等待", progressText: "" },
      statuses: [],
      itemResults: [],
      runError: null,
      lastStatuses: [],
      lastOutput: null,
      downloadBundle: null,
      outputSummary: null,
      copyStatus: "",
      downloadDone: false,
    };
  }

  function getSessionState(workflowId = selectedWorkflowId, workflow = null) {
    const key = currentSessionKey(workflowId);
    if (!key) return createEmptySessionState(workflow);
    if (!workflowSessionStates.has(key)) {
      const targetWf = workflow || workflows.find((item) => item.id === workflowId) || null;
      workflowSessionStates.set(key, createEmptySessionState(targetWf));
    }
    return workflowSessionStates.get(key);
  }

  function clearSessionState(workflowId) {
    const key = currentSessionKey(workflowId);
    if (!key) return;
    const existing = workflowSessionStates.get(key);
    if (existing?.lastOutput) void cleanupResource(existing.lastOutput);
    workflowSessionStates.delete(key);
  }

  function abortRunsOutsideAccount(activeAccountKey) {
    for (const [key, run] of activeRunsBySession.entries()) {
      if (!key.startsWith(`${activeAccountKey}::`)) {
        run.controller.abort();
        activeRunsBySession.delete(key);
      }
    }
  }

  function resetRunnerUiState(targetSession = null) {
    const session = targetSession || getSessionState();
    lastStatuses = Array.isArray(session.lastStatuses) ? cloneJson(session.lastStatuses) : [];
    lastRunError = session.runError ? { ...session.runError } : null;
    stopAllVisualAnimations();
    showCanvasAlert("");
    const runState = byId("workflowRunState");
    if (runState) {
      runState.textContent = session.runState?.label || "等待";
      runState.dataset.status = session.runState?.status || "waiting";
    }
    const progressEl = byId("workflowRunProgressText");
    if (progressEl) progressEl.textContent = session.runState?.progressText || "";
    const statusesEl = byId("workflowStepStatuses");
    if (statusesEl) statusesEl.innerHTML = "";
    renderItemResults(session.itemResults || []);
    if (session.outputSummary) {
      restoreSessionResultUi(session);
    } else {
      renderTypedOutputCard(null);
      const resultText = byId("workflowResultText");
      if (resultText) resultText.value = "";
      byId("workflowResultTextWrap")?.classList.remove("hidden");
      if (byId("workflowResultTextLabel")) byId("workflowResultTextLabel").textContent = "最终结果";
      const copyBtn = byId("copyWorkflowResultBtn");
      if (copyBtn) {
        copyBtn.disabled = true;
        copyBtn.textContent = session.copyStatus || copyBtn.dataset.originalLabel || "复制结果";
      }
      const dlBtn = byId("downloadWorkflowResultBtn");
      if (dlBtn) {
        dlBtn.disabled = true;
        dlBtn.textContent = dlBtn.dataset.originalLabel || "下载结果";
      }
      clearPreview();
    }
  }

  function openWorkflowInEditor(workflowId, options = {}) {
    const workflow = workflows.find((item) => item.id === workflowId);
    if (!workflow) return;
    selectedWorkflowId = workflowId;
    selectedStepId = "";
    const session = getSessionState(workflowId, workflow);
    resetRunnerUiState(session);
    const ui = loadCanvasUiFor(workflowId, workflow);
    canvasViewport = ui.viewport;
    canvasNodeOffsets = ui.nodeOffsets;
    persistLocalWorkflows();
    setSaveMessage("");
    setViewMode("editor", { openRunner: Boolean(options.openRunner), closeRunner: !options.openRunner, fitView: !ui.hasSaved });
  }

  function createAndOpenBlankWorkflow() {
    if (workflows.length >= MAX_WORKFLOWS) {
      setListFeedback(`最多保存 ${MAX_WORKFLOWS} 个工作流`, true);
      setSaveMessage(`最多保存 ${MAX_WORKFLOWS} 个工作流`, true);
      return;
    }
    const workflow = blankWorkflow();
    workflows.unshift(workflow);
    selectedWorkflowId = workflow.id;
    selectedStepId = "";
    clearSessionState(workflow.id);
    const session = getSessionState(workflow.id, workflow);
    resetRunnerUiState(session);
    canvasViewport = { panX: 0, panY: 0, zoom: 1 };
    canvasNodeOffsets = {};
    persistLocalWorkflows();
    setSaveMessage("已新建空白工作流");
    setViewMode("editor", { fitView: true, closeRunner: true });
  }

  function candidateCompatibility(workflow, toolId, insertIndex) {
    const cap = CAPABILITY_REGISTRY[toolId];
    if (!cap) return { compatible: false, reason: "未注册的能力" };
    const steps = workflow?.steps || [];
    const idx = insertIndex < 0 || insertIndex > steps.length ? steps.length : insertIndex;
    const prevSteps = steps.slice(0, idx).filter((s) => s.enabled);
    const nextSteps = steps.slice(idx).filter((s) => s.enabled);

    let incomingTypes = new Set(cap.input_types);
    if (prevSteps.length) {
      let prevOut;
      try {
        prevOut = validateStepSequence(prevSteps);
      } catch (err) {
        return { compatible: false, reason: err.message };
      }
      incomingTypes = new Set([...prevOut].filter((t) => cap.input_types.includes(t)));
      if (!incomingTypes.size) {
        return {
          compatible: false,
          reason: `需要 ${formatTypesLabel(cap.input_types)}，但前序输出为 ${formatTypesLabel([...prevOut])}`,
        };
      }
    }

    if (nextSteps.length) {
      const candidateOut = outputTypesFor(cap, incomingTypes);
      const nextCap = CAPABILITY_REGISTRY[nextSteps[0].tool_id];
      const nextAccepted = new Set(nextCap.input_types);
      const bridgeTypes = new Set([...candidateOut].filter((t) => nextAccepted.has(t)));
      if (!bridgeTypes.size) {
        return {
          compatible: false,
          reason: `输出 ${formatTypesLabel([...candidateOut])}，无法衔接后续“${nextCap.name}”(${formatTypesLabel(nextCap.input_types)})`,
        };
      }
      // Verify the remainder of the sequence stays valid with this inserted step.
      const trial = [
        ...steps.slice(0, idx),
        { id: "step_trial_check", tool_id: toolId, enabled: true, config: normalizeConfig(toolId, {}) },
        ...steps.slice(idx),
      ];
      try {
        validateStepSequence(trial);
      } catch (err) {
        return { compatible: false, reason: err.message };
      }
    }

    return { compatible: true, reason: "可与当前流程衔接" };
  }

  function addableCapabilities(workflow, insertIndex = -1) {
    return Object.entries(CAPABILITY_REGISTRY).filter(([toolId]) => candidateCompatibility(workflow, toolId, insertIndex).compatible);
  }

  function insertStepAt(toolId, insertIndex = -1) {
    const workflow = selectedWorkflow();
    if (!workflow || !CAPABILITY_REGISTRY[toolId]) return;
    if (workflow.steps.length >= MAX_STEPS) {
      showCanvasAlert(`每个工作流最多包含 ${MAX_STEPS} 个步骤`, "error");
      setSaveMessage(`最多 ${MAX_STEPS} 个步骤`, true);
      return;
    }
    const compat = candidateCompatibility(workflow, toolId, insertIndex);
    if (!compat.compatible) {
      showCanvasAlert(`无法添加“${CAPABILITY_REGISTRY[toolId].name}”：${compat.reason}`, "error");
      return;
    }
    const idx = insertIndex < 0 || insertIndex > workflow.steps.length ? workflow.steps.length : insertIndex;
    const newStep = { id: randomId("step"), tool_id: toolId, enabled: true, config: normalizeConfig(toolId, {}) };
    const snap = captureNodeFlip();
    workflow.steps.splice(idx, 0, newStep);
    selectedStepId = newStep.id;
    lastStatuses = [];
    lastRunError = null;
    if (workflow.id) {
      const s = getSessionState(workflow.id, workflow);
      s.lastStatuses = [];
      s.runError = null;
    }
    markWorkflowUpdated();
    renderEditor({ flipSnapshot: snap, fitView: workflow.steps.length <= 2 });
  }

  function captureNodeFlip() {
    const list = byId("workflowStepList");
    if (!list || isReducedMotion()) return null;
    if (root.WYJMotion?.captureFlipSnapshot) {
      return root.WYJMotion.captureFlipSnapshot(list, { selector: ":scope > li.wf-node", getKey: (el) => el.dataset.stepId });
    }
    const map = new Map();
    list.querySelectorAll(":scope > li.wf-node").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) map.set(el.dataset.stepId, { element: el, rect });
    });
    return map;
  }

  function playNodeFlip(beforeSnapshot) {
    const list = byId("workflowStepList");
    if (!list || !beforeSnapshot || isReducedMotion()) return;
    if (root.WYJMotion?.playFlipSnapshot) {
      root.WYJMotion.playFlipSnapshot(list, beforeSnapshot, {
        selector: ":scope > li.wf-node",
        getKey: (el) => el.dataset.stepId,
        duration: 280,
        scale: false,
        animateEnter: true,
      });
      scheduleEdgeSync(300);
      return;
    }
    scheduleEdgeSync(20);
  }

  function tryCommitReorderedSteps(mutateCandidateFn, failurePrefix = "无法调整节点顺序") {
    const workflow = selectedWorkflow();
    if (!workflow) return false;
    const candidate = cloneJson(workflow.steps);
    mutateCandidateFn(candidate);
    try {
      validateStepSequence(candidate);
    } catch (error) {
      showCanvasAlert(`${failurePrefix}：${error.message}`, "error");
      return false;
    }
    const snap = captureNodeFlip();
    workflow.steps = candidate;
    lastStatuses = [];
    lastRunError = null;
    if (workflow.id) {
      const s = getSessionState(workflow.id, workflow);
      s.lastStatuses = [];
      s.runError = null;
    }
    showCanvasAlert("");
    markWorkflowUpdated();
    renderEditor({ flipSnapshot: snap, fitView: false });
    return true;
  }

  function moveStep(stepId, offset) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    const index = workflow.steps.findIndex((step) => step.id === stepId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= workflow.steps.length) return;
    tryCommitReorderedSteps((steps) => {
      [steps[index], steps[target]] = [steps[target], steps[index]];
    });
  }

  function reorderStep(sourceId, targetId) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    const source = workflow.steps.findIndex((step) => step.id === sourceId);
    const target = workflow.steps.findIndex((step) => step.id === targetId);
    if (source < 0 || target < 0 || source === target) return;
    tryCommitReorderedSteps((steps) => {
      const [item] = steps.splice(source, 1);
      steps.splice(target, 0, item);
    });
  }

    const SVG_NS = "http://www.w3.org/2000/svg";

  function computeBezierEdge(x1, y1, x2, y2, vertical) {
    const c = 0.28;
    if (vertical) {
      const dy = y2 - y1;
      const offset = dy >= 0 ? Math.max(22, 0.5 * dy) : c * 25 * Math.sqrt(-dy);
      const cy1 = y1 + offset;
      const cy2 = y2 - offset;
      const mx = x1 * 0.5 + x2 * 0.5;
      const my = y1 * 0.125 + cy1 * 0.375 + cy2 * 0.375 + y2 * 0.125;
      return { path: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${cy1.toFixed(1)}, ${x2.toFixed(1)} ${cy2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`, mx, my };
    }
    const dx = x2 - x1;
    const offset = dx >= 0 ? Math.max(26, 0.5 * dx) : c * 25 * Math.sqrt(-dx);
    const cx1 = x1 + offset;
    const cx2 = x2 - offset;
    const mx = x1 * 0.125 + cx1 * 0.375 + cx2 * 0.375 + x2 * 0.125;
    const my = y1 * 0.5 + y2 * 0.5;
    return { path: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cx1.toFixed(1)} ${y1.toFixed(1)}, ${cx2.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`, mx, my };
  }

  function ensureEdgeSvgDefs(svg) {
    let defs = svg.querySelector(":scope > defs");
    if (!defs) {
      defs = document.createElementNS(SVG_NS, "defs");
      defs.innerHTML = `<marker id="wf-arrow-idle" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="currentColor"/></marker>`;
      svg.prepend(defs);
    }
    return defs;
  }

  function ensureEdgeGradient(defs, edgeId, x1, y1, x2, y2) {
    const safeId = `wf-grad-${String(edgeId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    let grad = defs.querySelector(`#${safeId}`);
    if (!grad) {
      grad = document.createElementNS(SVG_NS, "linearGradient");
      grad.setAttribute("id", safeId);
      grad.setAttribute("gradientUnits", "userSpaceOnUse");
      grad.innerHTML = `<stop offset="0%" stop-color="var(--wf-exec-flow)" stop-opacity="0.2"/><stop offset="65%" stop-color="var(--wf-exec-flow)" stop-opacity="0.88"/><stop offset="100%" stop-color="var(--wf-exec-flow-head)" stop-opacity="1"/>`;
      defs.appendChild(grad);
    }
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    grad.setAttribute("x1", x1.toFixed(1));
    grad.setAttribute("y1", y1.toFixed(1));
    grad.setAttribute("x2", (dx < 1 && dy < 1 ? x2 + 1 : x2).toFixed(1));
    grad.setAttribute("y2", (dy < 1 && dx < 1 ? y2 + 1 : y2).toFixed(1));
    return `url(#${safeId})`;
  }

  function upsertEdgeGroup(svg, defs, spec) {
    let group = svg.querySelector(`[data-edge-id="${spec.edgeId}"]`);
    if (!group) {
      group = document.createElementNS(SVG_NS, "g");
      group.classList.add("wf-edge-group");
      group.dataset.edgeId = spec.edgeId;
      const hit = document.createElementNS(SVG_NS, "path");
      hit.setAttribute("class", "wf-edge-hit");
      hit.setAttribute("fill", "none");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", "14");
      const base = document.createElementNS(SVG_NS, "path");
      base.setAttribute("class", "wf-edge-base");
      base.setAttribute("fill", "none");
      base.setAttribute("stroke", "currentColor");
      base.setAttribute("stroke-width", "2");
      if (!spec.isExit) base.setAttribute("marker-end", "url(#wf-arrow-idle)");
      const pulse = document.createElementNS(SVG_NS, "path");
      pulse.setAttribute("class", "wf-edge-pulse");
      pulse.setAttribute("fill", "none");
      pulse.setAttribute("opacity", "0");
      pulse.setAttribute("pathLength", "100");
      pulse.setAttribute("stroke-dasharray", "30 70");
      group.append(hit, base, pulse);
      svg.appendChild(group);
    }
    group.classList.toggle("wf-edge-entry", Boolean(spec.isEntry));
    group.classList.toggle("wf-edge-exit", Boolean(spec.isExit));
    group.dataset.edgeState = spec.edgeState;
    group.dataset.edgeValid = String(spec.edgeValid);
    const gradUrl = ensureEdgeGradient(defs, spec.edgeId, spec.x1, spec.y1, spec.x2, spec.y2);
    const hit = group.querySelector(".wf-edge-hit");
    const base = group.querySelector(".wf-edge-base");
    const pulse = group.querySelector(".wf-edge-pulse");
    if (hit) hit.setAttribute("d", spec.path);
    if (base) base.setAttribute("d", spec.path);
    if (pulse) {
      pulse.setAttribute("d", spec.path);
      pulse.setAttribute("stroke", gradUrl);
    }
  }

  function syncCanvasEdges({ orderedStepIds = null, candidateSteps = null } = {}) {
    const stage = byId("workflowCanvasStage");
    const svg = byId("workflowCanvasEdges");
    const inserts = byId("workflowEdgeInserts");
    const list = byId("workflowStepList");
    const workflow = selectedWorkflow();
    if (!stage || !svg || !inserts || !list || !workflow || viewMode !== "editor") return;

    const rawNodes = [...list.querySelectorAll(":scope > li.wf-node")];
    const nodeById = new Map(rawNodes.map((n) => [n.dataset.stepId, n]));
    const nodes = Array.isArray(orderedStepIds)
      ? orderedStepIds.map((id) => nodeById.get(id)).filter(Boolean)
      : rawNodes;
    nodes.forEach((n) => syncNodeTraceGeometry(n));

    const stageRect = stage.getBoundingClientRect();
    const zoom = isMobileCanvas() ? 1 : (canvasViewport.zoom || 1);
    const w = Math.max(stage.scrollWidth, Math.round(stageRect.width / zoom), 100);
    const h = Math.max(stage.scrollHeight, Math.round(stageRect.height / zoom), 100);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));

    if (!nodes.length) {
      svg.querySelectorAll("[data-edge-id]").forEach((el) => el.remove());
      inserts.innerHTML = "";
      return;
    }

    const stepsSeq = Array.isArray(candidateSteps) ? candidateSteps : workflow.steps;
    const stepById = new Map(stepsSeq.map((s) => [s.id, s]));
    const vertical = isMobileCanvas();
    const statusById = new Map(lastStatuses.map((s) => [s.id, s]));
    const defs = ensureEdgeSvgDefs(svg);
    const desiredIds = new Set();
    const insertButtons = [];

    const firstNode = nodes[0];
    const firstStep = stepById.get(firstNode.dataset.stepId);
    const firstStatus = statusById.get(firstStep?.id)?.status || "waiting";
    const firstIn = firstNode.querySelector('[data-port="in"]') || firstNode;
    const firstRect = firstIn.getBoundingClientRect();
    const inX = (firstRect.left + firstRect.width / 2 - stageRect.left) / zoom;
    const inY = (firstRect.top + firstRect.height / 2 - stageRect.top) / zoom;
    const entryStartX = vertical ? inX : inX - 44;
    const entryStartY = vertical ? inY - 34 : inY;
    const entryEdge = computeBezierEdge(entryStartX, entryStartY, inX, inY, vertical);
    desiredIds.add("__entry__");
    upsertEdgeGroup(svg, defs, {
      edgeId: "__entry__",
      isEntry: true,
      isExit: false,
      x1: entryStartX,
      y1: entryStartY,
      x2: inX,
      y2: inY,
      path: entryEdge.path,
      edgeState: firstStatus === "running" ? "running" : firstStatus === "success" ? "success" : firstStatus === "failed" ? "failed" : "idle",
      edgeValid: true,
    });

    for (let i = 0; i < nodes.length - 1; i += 1) {
      const fromNode = nodes[i];
      const toNode = nodes[i + 1];
      const fromId = fromNode.dataset.stepId;
      const toId = toNode.dataset.stepId;
      const outPort = fromNode.querySelector('[data-port="out"]') || fromNode;
      const inPort = toNode.querySelector('[data-port="in"]') || toNode;
      const outRect = outPort.getBoundingClientRect();
      const inRect = inPort.getBoundingClientRect();
      const x1 = (outRect.left + outRect.width / 2 - stageRect.left) / zoom;
      const y1 = (outRect.top + outRect.height / 2 - stageRect.top) / zoom;
      const x2 = (inRect.left + inRect.width / 2 - stageRect.left) / zoom;
      const y2 = (inRect.top + inRect.height / 2 - stageRect.top) / zoom;

      const { path, mx, my } = computeBezierEdge(x1, y1, x2, y2, vertical);
      const fromStep = stepById.get(fromId);
      const toStep = stepById.get(toId);
      const fromStatus = statusById.get(fromId)?.status || "waiting";
      const toStatus = statusById.get(toId)?.status || "waiting";
      let edgeState = "idle";
      if (toStatus === "running" && (fromStatus === "success" || fromStatus === "skipped")) edgeState = "running";
      else if (fromStatus === "failed" || toStatus === "failed") edgeState = "failed";
      else if (fromStatus === "success" && toStatus === "success") edgeState = "success";
      else if (fromStatus === "skipped" || toStatus === "skipped") edgeState = "skipped";
      else if (fromStatus === "cancelled" || toStatus === "cancelled") edgeState = "cancelled";

      let edgeValid = true;
      try { validateStepSequence([fromStep, toStep].filter((s) => s && s.enabled)); } catch (_) { edgeValid = false; }
      if (!edgeValid) edgeState = "invalid";

      const edgeId = `${fromId}__${toId}`;
      desiredIds.add(edgeId);
      upsertEdgeGroup(svg, defs, {
        edgeId,
        isEntry: false,
        isExit: false,
        x1,
        y1,
        x2,
        y2,
        path,
        edgeState,
        edgeValid,
      });

      insertButtons.push({ index: i + 1, mx, my });
    }

    const lastNode = nodes[nodes.length - 1];
    const lastStep = stepById.get(lastNode.dataset.stepId);
    const lastStatus = statusById.get(lastStep?.id)?.status || "waiting";
    const lastOut = lastNode.querySelector('[data-port="out"]') || lastNode;
    const lastRect = lastOut.getBoundingClientRect();
    const outX = (lastRect.left + lastRect.width / 2 - stageRect.left) / zoom;
    const outY = (lastRect.top + lastRect.height / 2 - stageRect.top) / zoom;
    const exitEndX = vertical ? outX : outX + 44;
    const exitEndY = vertical ? outY + 34 : outY;
    const exitEdge = computeBezierEdge(outX, outY, exitEndX, exitEndY, vertical);
    desiredIds.add("__exit__");
    upsertEdgeGroup(svg, defs, {
      edgeId: "__exit__",
      isEntry: false,
      isExit: true,
      x1: outX,
      y1: outY,
      x2: exitEndX,
      y2: exitEndY,
      path: exitEdge.path,
      edgeState: lastStatus === "success" ? "success" : lastStatus === "failed" ? "failed" : "idle",
      edgeValid: true,
    });

    svg.querySelectorAll("[data-edge-id]").forEach((el) => {
      if (!desiredIds.has(el.dataset.edgeId)) el.remove();
    });

    if (pointerDragState?.moved) {
      inserts.classList.add("hidden");
      return;
    }
    inserts.classList.remove("hidden");
    inserts.innerHTML = "";
    insertButtons.forEach(({ index, mx, my }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wf-edge-insert-btn";
      btn.dataset.insertIndex = String(index);
      btn.setAttribute("aria-label", `在第 ${index} 与 ${index + 1} 步之间插入节点`);
      btn.title = "在此处插入节点";
      btn.innerHTML = uiIconSvg("plus", "wf-edge-plus-icon");
      btn.style.left = `${mx.toFixed(1)}px`;
      btn.style.top = `${my.toFixed(1)}px`;
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        openNodePicker(index, btn);
      });
      inserts.append(btn);
    });
  }

  function scheduleEdgeSync(durationMs = 0) {
    const targetEnd = root.performance?.now ? root.performance.now() + durationMs : Date.now() + durationMs;
    edgeSyncUntil = Math.max(edgeSyncUntil, targetEnd);
    if (edgeSyncRaf || typeof root.requestAnimationFrame !== "function") {
      if (typeof root.requestAnimationFrame !== "function") syncCanvasEdges();
      return;
    }
    const tick = () => {
      edgeSyncRaf = 0;
      syncCanvasEdges();
      const now = root.performance?.now ? root.performance.now() : Date.now();
      if (now < edgeSyncUntil) {
        edgeSyncRaf = root.requestAnimationFrame(tick);
      }
    };
    edgeSyncRaf = root.requestAnimationFrame(tick);
  }

  function renderInspector() {
    const workflow = selectedWorkflow();
    const step = workflow?.steps?.find((item) => item.id === selectedStepId) || null;
    syncInspectorVisibility();
    if (!workflow || !step) return;

    const index = workflow.steps.findIndex((item) => item.id === step.id);
    const cap = CAPABILITY_REGISTRY[step.tool_id];
    const meta = CAPABILITY_META[step.tool_id] || {};
    const schema = CONFIG_SCHEMAS[step.tool_id] || {};
    const statusObj = lastStatuses.find((item) => item.id === step.id);
    const status = statusObj?.status || "waiting";

    const iconEl = byId("inspectorNodeIcon");
    if (iconEl) iconEl.innerHTML = capabilityIconSvg(step.tool_id);
    if (byId("inspectorStepBadge")) byId("inspectorStepBadge").textContent = `第 ${index + 1} 步 · ${meta.categoryLabel || "处理"}`;
    if (byId("inspectorNodeTitle")) byId("inspectorNodeTitle").textContent = cap.name;

    const fieldsHtml = Object.entries(schema).map(([key, rule]) => {
      const id = `wf-insp-${step.id}-${key}`;
      const val = step.config[key];
      if (rule.type === "enum") {
        // <= 5 options: direct segmented pills + synced native select for contract compatibility.
        const pills = rule.values.map((opt) => {
          const label = rule.labels?.[opt] || opt;
          const active = val === opt;
          return `<button type="button" class="wf-seg-btn${active ? " is-active" : ""}" role="radio" aria-checked="${active}" data-inspector-enum-key="${key}" data-inspector-enum-val="${escapeHtml(opt)}">${escapeHtml(label)}</button>`;
        }).join("");
        const selectOpts = rule.values.map((opt) => `<option value="${escapeHtml(opt)}"${val === opt ? " selected" : ""}>${escapeHtml(rule.labels?.[opt] || opt)}</option>`).join("");
        return `<div class="wf-field-group">
          <span class="wf-field-label">${escapeHtml(rule.label)}</span>
          <div class="wf-seg-group" role="radiogroup" aria-label="${escapeHtml(rule.label)}">${pills}</div>
          <select id="${id}" class="sr-only" data-ds-select="native" data-step-config="${key}" tabindex="-1" aria-hidden="true">${selectOpts}</select>
        </div>`;
      }
      if (rule.type === "number") {
        const pct = Math.round(Number(val) * 100);
        return `<div class="wf-field-group">
          <div class="wf-field-head"><label class="wf-field-label" for="${id}">${escapeHtml(rule.label)}</label><strong class="wf-field-readout" data-readout-for="${key}">${pct}% (${escapeHtml(val)})</strong></div>
          <div class="wf-slider-row">
            <input type="range" class="wf-range-input" min="${rule.min}" max="${rule.max}" step="0.05" value="${escapeHtml(val)}" data-step-slider="${key}" aria-label="${escapeHtml(rule.label)}" />
            <input id="${id}" type="number" class="wf-compact-num" min="${rule.min}" max="${rule.max}" step="0.05" value="${escapeHtml(val)}" data-step-config="${key}" />
          </div>
          <p class="wf-field-error hidden" data-field-error="${key}" role="alert"></p>
        </div>`;
      }
      if (rule.type === "integer") {
        return `<div class="wf-field-group">
          <div class="wf-field-head"><label class="wf-field-label" for="${id}">${escapeHtml(rule.label)}</label><small class="wf-field-hint">${rule.min} – ${rule.max}</small></div>
          <input id="${id}" type="number" min="${rule.min}" max="${rule.max}" step="1" value="${escapeHtml(val)}" data-step-config="${key}" />
          <p class="wf-field-error hidden" data-field-error="${key}" role="alert"></p>
        </div>`;
      }
      if (rule.type === "color") {
        const swatches = COLOR_SWATCHES.map((hex) => `<button type="button" class="wf-color-swatch${val === hex ? " is-active" : ""}" data-swatch-color="${hex}" data-swatch-key="${key}" aria-label="选择颜色 ${hex}" title="${hex}"><span class="wf-swatch-chip" data-swatch-hex="${hex}"></span></button>`).join("");
        return `<div class="wf-field-group">
          <div class="wf-field-head"><label class="wf-field-label" for="${id}">${escapeHtml(rule.label)}</label><code class="wf-hex-code" data-readout-for="${key}">${escapeHtml(val)}</code></div>
          <div class="wf-color-row">
            <input id="${id}" type="color" value="${escapeHtml(val)}" data-step-config="${key}" />
            <div class="wf-swatch-list">${swatches}</div>
          </div>
          <p class="wf-field-error hidden" data-field-error="${key}" role="alert"></p>
        </div>`;
      }
      return `<div class="wf-field-group">
        <div class="wf-field-head"><label class="wf-field-label" for="${id}">${escapeHtml(rule.label)}</label><small class="wf-field-hint" data-readout-for="${key}">${String(val || "").length} / ${rule.maxLength}</small></div>
        <input id="${id}" type="text" maxlength="${rule.maxLength}" value="${escapeHtml(val)}" data-step-config="${key}" />
        <p class="wf-field-error hidden" data-field-error="${key}" role="alert"></p>
      </div>`;
    }).join("");

    const body = byId("workflowInspectorBody");
    if (!body) return;
    body.innerHTML = `
      <div class="wf-insp-meta">
        <p class="wf-insp-desc">${escapeHtml(meta.description || "")}</p>
        <div class="wf-insp-io">
          <span class="wf-io-pill">输入：${escapeHtml(formatTypesLabel(cap.input_types))}</span>
          <span class="wf-io-arrow" aria-hidden="true">→</span>
          <span class="wf-io-pill">输出：${escapeHtml(formatTypesLabel(cap.output_types))}</span>
        </div>
        ${statusObj ? `<div class="wf-insp-status" data-status="${status}"><span>运行状态：${escapeHtml(STATUS_LABELS[status] || status)}</span>${statusObj.duration_ms ? `<small>${statusObj.duration_ms} ms</small>` : ""}${statusObj.error ? `<p class="wf-insp-err-detail">${escapeHtml(statusObj.error)}</p>` : ""}</div>` : ""}
      </div>

      <div class="wf-insp-toggle-row">
        <label class="wf-switch-label" for="wfInspectorEnabled">
          <input id="wfInspectorEnabled" type="checkbox"${step.enabled ? " checked" : ""} data-inspector-enabled />
          <span>启用此步骤</span>
        </label>
        <span class="wf-id-tag">${escapeHtml(step.tool_id)}</span>
      </div>

      <section class="wf-insp-params" aria-label="节点参数">
        <h3>参数配置</h3>
        ${fieldsHtml || '<p class="workflow-step-no-config">此节点无需额外配置参数，将直接按当前顺序执行。</p>'}
      </section>

      <section class="wf-insp-actions" aria-label="节点操作">
        <h3>节点管理</h3>
        <div class="wf-insp-action-grid">
          <button class="button-secondary" type="button" data-inspector-up${index === 0 ? " disabled" : ""}>前移一步</button>
          <button class="button-secondary" type="button" data-inspector-down${index >= workflow.steps.length - 1 ? " disabled" : ""}>后移一步</button>
          <button class="button-secondary" type="button" data-inspector-duplicate>复制节点</button>
          <button class="button-ghost danger-text" type="button" data-inspector-delete>删除节点</button>
        </div>
      </section>
    `;

    // Apply swatch background colors via CSSOM (CSP-safe, zero inline style attr).
    body.querySelectorAll(".wf-swatch-chip[data-swatch-hex]").forEach((chip) => {
      chip.style.backgroundColor = chip.dataset.swatchHex;
    });

    const commitConfigValue = (key, rawVal) => {
      const rule = schema[key];
      if (!rule) return;
      const errEl = body.querySelector(`[data-field-error="${key}"]`);
      const nextConfig = { ...step.config };
      nextConfig[key] = ["integer", "number"].includes(rule.type) ? Number(rawVal) : rawVal;
      try {
        step.config = normalizeConfig(step.tool_id, nextConfig);
        if (errEl) { errEl.textContent = ""; errEl.classList.add("hidden"); }
        markWorkflowUpdated();
        // Refresh canvas node summary without closing or rebuilding inspector inputs.
        const nodeSummary = byId("workflowStepList")?.querySelector(`[data-step-id="${step.id}"] .wf-node-summary`);
        if (nodeSummary) nodeSummary.textContent = summarizeStepConfig(step);
      } catch (error) {
        if (errEl) { errEl.textContent = error.message; errEl.classList.remove("hidden"); }
        setSaveMessage(error.message, true);
      }
    };

    body.querySelectorAll("[data-inspector-enum-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.inspectorEnumKey;
        const value = btn.dataset.inspectorEnumVal;
        const hiddenSel = body.querySelector(`select[data-step-config="${key}"]`);
        if (hiddenSel) hiddenSel.value = value;
        body.querySelectorAll(`[data-inspector-enum-key="${key}"]`).forEach((b) => {
          const active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-checked", String(active));
        });
        commitConfigValue(key, value);
      });
    });

    body.querySelectorAll("[data-step-slider]").forEach((slider) => {
      slider.addEventListener("input", () => {
        const key = slider.dataset.stepSlider;
        const numInput = body.querySelector(`[data-step-config="${key}"]`);
        const readout = body.querySelector(`[data-readout-for="${key}"]`);
        if (numInput) numInput.value = slider.value;
        if (readout) readout.textContent = `${Math.round(Number(slider.value) * 100)}% (${slider.value})`;
        commitConfigValue(key, slider.value);
      });
    });

    body.querySelectorAll("[data-swatch-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.swatchKey;
        const hex = btn.dataset.swatchColor;
        const colorInput = body.querySelector(`input[data-step-config="${key}"]`);
        const readout = body.querySelector(`[data-readout-for="${key}"]`);
        if (colorInput) colorInput.value = hex;
        if (readout) readout.textContent = hex;
        body.querySelectorAll(`[data-swatch-key="${key}"]`).forEach((b) => b.classList.toggle("is-active", b === btn));
        commitConfigValue(key, hex);
      });
    });

    body.querySelectorAll("[data-step-config]").forEach((field) => {
      const key = field.dataset.stepConfig;
      const syncDisplay = () => {
        const rule = schema[key];
        const readout = body.querySelector(`[data-readout-for="${key}"]`);
        if (rule?.type === "number") {
          const slider = body.querySelector(`[data-step-slider="${key}"]`);
          if (slider) slider.value = field.value;
          if (readout) readout.textContent = `${Math.round(Number(field.value) * 100)}% (${field.value})`;
        } else if (rule?.type === "color") {
          if (readout) readout.textContent = String(field.value).toLowerCase();
          body.querySelectorAll(`[data-swatch-key="${key}"]`).forEach((b) => b.classList.toggle("is-active", b.dataset.swatchColor === String(field.value).toLowerCase()));
        } else if (rule?.type === "string" && readout) {
          readout.textContent = `${String(field.value || "").length} / ${rule.maxLength}`;
        }
      };
      field.addEventListener("input", () => {
        syncDisplay();
        if (field.tagName !== "SELECT") commitConfigValue(key, field.value);
      });
      field.addEventListener("change", () => {
        syncDisplay();
        commitConfigValue(key, field.value);
      });
    });

    body.querySelector("[data-inspector-enabled]")?.addEventListener("change", (event) => {
      toggleStepEnabled(step.id, event.currentTarget.checked);
    });
    body.querySelector("[data-inspector-up]")?.addEventListener("click", () => moveStep(step.id, -1));
    body.querySelector("[data-inspector-down]")?.addEventListener("click", () => moveStep(step.id, 1));
    body.querySelector("[data-inspector-duplicate]")?.addEventListener("click", () => duplicateStepById(step.id));
    body.querySelector("[data-inspector-delete]")?.addEventListener("click", () => deleteStepById(step.id));
  }

  function toggleStepEnabled(stepId, enabled) {
    const workflow = selectedWorkflow();
    const step = workflow?.steps?.find((value) => value.id === stepId);
    if (!step) return;
    const prev = step.enabled;
    step.enabled = Boolean(enabled);
    try {
      validateStepSequence(workflow.steps);
    } catch (error) {
      step.enabled = prev;
      showCanvasAlert(`无法${enabled ? "启用" : "停用"}节点：${error.message}`, "error");
      renderEditor({ fitView: false });
      return;
    }
    showCanvasAlert("");
    markWorkflowUpdated();
    renderEditor({ fitView: false });
  }

  function duplicateStepById(stepId) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    if (workflow.steps.length >= MAX_STEPS) {
      showCanvasAlert(`最多 ${MAX_STEPS} 个步骤`, "error");
      return setSaveMessage(`最多 ${MAX_STEPS} 个步骤`, true);
    }
    const index = workflow.steps.findIndex((step) => step.id === stepId);
    if (index < 0) return;
    const dup = { ...cloneJson(workflow.steps[index]), id: randomId("step") };
    const snap = captureNodeFlip();
    workflow.steps.splice(index + 1, 0, dup);
    try {
      validateStepSequence(workflow.steps);
    } catch (error) {
      workflow.steps.splice(index + 1, 1);
      showCanvasAlert(`无法复制该步骤：${error.message}`, "error");
      return;
    }
    selectedStepId = dup.id;
    markWorkflowUpdated();
    renderEditor({ flipSnapshot: snap, fitView: false });
  }

  function deleteStepById(stepId) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    const index = workflow.steps.findIndex((step) => step.id === stepId);
    if (index < 0) return;
    const removed = workflow.steps.splice(index, 1)[0];
    try {
      validateStepSequence(workflow.steps);
    } catch (error) {
      workflow.steps.splice(index, 0, removed);
      showCanvasAlert(`删除后后续节点不兼容：${error.message}`, "error");
      return;
    }
    delete canvasNodeOffsets[stepId];
    if (selectedStepId === stepId) selectedStepId = "";
    lastStatuses = lastStatuses.filter((item) => item.id !== stepId);
    const snap = captureNodeFlip();
    showCanvasAlert("");
    markWorkflowUpdated();
    persistCanvasViewport();
    renderEditor({ flipSnapshot: snap, fitView: false });
  }

  function bindStepEvents() {
    const list = byId("workflowStepList");
    list?.querySelectorAll("[data-step-id]").forEach((item) => {
      const stepId = item.dataset.stepId;

      item.addEventListener("click", (event) => {
        if (event.target.closest("button, input, select, label")) return;
        selectedStepId = stepId;
        renderInspector();
      });

      item.addEventListener("keydown", (event) => {
        if (event.target !== item) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectedStepId = stepId;
          renderInspector();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          if (currentActiveRun()) return showCanvasAlert("工作流正在执行，暂不调整节点顺序", "error");
          moveStep(stepId, -1);
          byId("workflowStepList")?.querySelector(`[data-step-id="${stepId}"]`)?.focus({ preventScroll: true });
        } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          if (currentActiveRun()) return showCanvasAlert("工作流正在执行，暂不调整节点顺序", "error");
          moveStep(stepId, 1);
          byId("workflowStepList")?.querySelector(`[data-step-id="${stepId}"]`)?.focus({ preventScroll: true });
        }
      });

      // HTML5 drag-drop kept for full compatibility + automated drag tests.
      item.addEventListener("dragstart", (event) => {
        if (pointerDragState) { event.preventDefault(); return; }
        draggedStepId = stepId;
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => { draggedStepId = ""; item.classList.remove("dragging"); });
      item.addEventListener("dragover", (event) => event.preventDefault());
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        if (currentActiveRun()) return;
        reorderStep(draggedStepId, stepId);
      });

      // Continuous 2D Pointer Drag within zone + cross-zone hysteresis reorder.
      item.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.isPrimary === false) return;
        const fromHandle = Boolean(event.target.closest("[data-wf-drag-handle]"));
        if (!fromHandle && (isMobileCanvas() || event.target.closest("button, input, select, label, a"))) return;
        if (currentActiveRun()) {
          if (fromHandle) {
            event.preventDefault();
            showCanvasAlert("工作流正在运行，完成后再调整节点位置", "error");
          }
          return;
        }
        const workflow = selectedWorkflow();
        if (!workflow) return;
        const nodes = [...list.querySelectorAll(":scope > li.wf-node")];
        const startIdx = workflow.steps.findIndex((s) => s.id === stepId);
        if (startIdx < 0) return;

        // Suppress native HTML5 drag ghost when mouse gesture starts.
        item.draggable = false;
        if (fromHandle) event.preventDefault();
        event.stopPropagation();

        // Capture stable, un-animated slot layout basis in world coordinates.
        const slots = nodes.map((node) => ({
          stepId: node.dataset.stepId,
          x: node.offsetLeft,
          y: node.offsetTop,
          cx: node.offsetLeft + node.offsetWidth / 2,
          cy: node.offsetTop + node.offsetHeight / 2,
          w: node.offsetWidth,
          h: node.offsetHeight,
        }));
        const originalOrder = workflow.steps.map((s) => s.id);

        pointerDragState = {
          stepId,
          item,
          fromHandle,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          latestX: event.clientX,
          latestY: event.clientY,
          originOff: getStepOffset(stepId),
          startIdx,
          candidateIdx: startIdx,
          originalOrder,
          candidateOrder: [...originalOrder],
          slots,
          moved: false,
          nodes,
          shiftTargets: new Map(),
          lastValid: true,
        };
      });

      item.querySelector("[data-step-up]")?.addEventListener("click", (e) => { e.stopPropagation(); moveStep(stepId, -1); });
      item.querySelector("[data-step-down]")?.addEventListener("click", (e) => { e.stopPropagation(); moveStep(stepId, 1); });
      item.querySelector("[data-step-duplicate]")?.addEventListener("click", (e) => { e.stopPropagation(); duplicateStepById(stepId); });
      item.querySelector("[data-step-delete]")?.addEventListener("click", (e) => { e.stopPropagation(); deleteStepById(stepId); });
      item.querySelector("[data-step-enabled]")?.addEventListener("change", (event) => {
        event.stopPropagation();
        toggleStepEnabled(stepId, event.currentTarget.checked);
      });
    });
  }

  function renderInputValidation(session) {
    const el = byId("workflowInputValidation");
    if (!el) return;
    const validation = session?.inputValidation;
    if (!validation?.message) {
      el.innerHTML = "";
      el.classList.add("hidden");
      delete el.dataset.tone;
      return;
    }
    el.dataset.tone = validation.tone || "error";
    el.classList.remove("hidden");
    el.innerHTML = `<span>${escapeHtml(validation.message)}</span>`;
  }

  function reconcileSessionFilesWithPolicy(workflow, session) {
    const policy = getWorkflowInputPolicy(workflow);
    if (!session) return policy;
    if (!policy.ready || !policy.acceptsFiles) {
      if (session.queuedFiles.length || session.rejectedFiles.length) {
        session.queuedFiles = [];
        session.rejectedFiles = [];
        session.inputValidation = null;
      }
      return policy;
    }

    const survivingQueue = [];
    const movedRejected = [];
    for (const file of session.queuedFiles) {
      const issue = fileMatchErrorForPolicy(policy, file);
      if (issue) {
        movedRejected.push({ file, kind: "type", reason: issue });
      } else if (survivingQueue.length >= policy.maxFiles) {
        movedRejected.push({ file, kind: "over-limit", reason: `超出上限 ${policy.maxFiles}` });
      } else if (fileSizeTotal(survivingQueue) + Number(file.size || 0) > policy.maxBytes) {
        movedRejected.push({ file, kind: "size", reason: "超出总大小上限" });
      } else {
        survivingQueue.push(file);
      }
    }

    if (movedRejected.length) {
      session.queuedFiles = survivingQueue;
      session.rejectedFiles = [...movedRejected, ...session.rejectedFiles];
    }

    if (session.rejectedFiles.length) {
      // Check if only valid-type rejected files exist and whether queued + validRejected now fit!
      const typeBad = [];
      const candidateGood = [];
      for (const entry of session.rejectedFiles) {
        const issue = fileMatchErrorForPolicy(policy, entry.file);
        if (issue) typeBad.push({ file: entry.file, kind: "type", reason: issue });
        else candidateGood.push(entry.file);
      }
      const combined = [...session.queuedFiles, ...candidateGood];
      const fitCheck = candidateGood.length ? validateInputFilesForPolicy(policy, combined) : { valid: false };
      if (fitCheck.valid) {
        session.queuedFiles = combined;
        session.rejectedFiles = typeBad;
        session.inputValidation = typeBad.length
          ? { tone: "error", message: `其余 ${candidateGood.length} 项已加入待执行队列；仍有 ${typeBad.length} 个文件格式不兼容。` }
          : { tone: "info", message: `已满足数量与大小要求，共 ${combined.length} ${policy.unitLabel}已加入待执行队列。` };
      } else if (candidateGood.length) {
        const combinedCheck = validateInputFilesForPolicy(policy, combined);
        session.rejectedFiles = [
          ...typeBad,
          ...candidateGood.map((file) => ({
            file,
            kind: combinedCheck.reason === "size" ? "size" : "over-limit",
            reason: combinedCheck.reason === "size" ? "总大小超限" : `超出上限（${combined.length}/${policy.maxFiles}）`,
          })),
        ];
        session.inputValidation = {
          tone: "error",
          message: combinedCheck.message || `已选择文件超出当前工作流限制，请移除多余项。`,
        };
      } else if (typeBad.length) {
        session.rejectedFiles = typeBad;
        session.inputValidation = {
          tone: "error",
          message: `有 ${typeBad.length} 个文件格式与当前工作流不兼容，已阻止进入待执行队列，请移除。`,
        };
      }
    } else if (session.inputValidation?.tone === "error") {
      const qCheck = validateInputFilesForPolicy(policy, session.queuedFiles);
      if (qCheck.valid || !session.queuedFiles.length) session.inputValidation = null;
    }

    return policy;
  }

  function handleIncomingWorkflowFiles(workflow, incomingFiles, { mode = "replace" } = {}) {
    if (!workflow) return;
    const policy = getWorkflowInputPolicy(workflow);
    const session = getSessionState(workflow.id, workflow);
    const incoming = [...(incomingFiles || [])].filter(Boolean);
    if (!incoming.length) return;

    if (!policy.ready || !policy.acceptsFiles) {
      session.rejectedFiles = incoming.map((file) => ({ file, kind: "type", reason: policy.hint }));
      session.inputValidation = { tone: "error", message: policy.hint };
      renderSelectedFilesManifest();
      return;
    }

    const baseQueued = mode === "append" ? [...session.queuedFiles] : [];
    const baseRejected = mode === "append" ? [...session.rejectedFiles.filter((e) => e.kind !== "type")] : [];
    const compatible = [];
    const badType = [];

    for (const file of incoming) {
      const issue = fileMatchErrorForPolicy(policy, file);
      if (issue) badType.push({ file, kind: "type", reason: issue });
      else compatible.push(file);
    }

    const stagedGood = [...baseRejected.map((e) => e.file), ...compatible];
    const combined = [...baseQueued, ...stagedGood];

    if (!stagedGood.length && badType.length) {
      session.queuedFiles = baseQueued;
      session.rejectedFiles = badType;
      session.inputValidation = {
        tone: "error",
        message: `所选 ${badType.length} 个文件格式与当前工作流不兼容：${badType.slice(0, 3).map((b) => b.file.name).join("、")}${badType.length > 3 ? " 等" : ""}`,
      };
      renderSelectedFilesManifest();
      return;
    }

    const check = validateInputFilesForPolicy(policy, combined);
    if (check.valid && !badType.length) {
      session.queuedFiles = combined;
      session.rejectedFiles = [];
      session.inputValidation = null;
      renderSelectedFilesManifest();
      return;
    }

    if (check.valid && badType.length) {
      session.queuedFiles = combined;
      session.rejectedFiles = badType;
      session.inputValidation = {
        tone: "error",
        message: `${badType.length} 个文件格式不符未加入队列，其余 ${combined.length} ${policy.unitLabel}已就绪。`,
      };
      renderSelectedFilesManifest();
      return;
    }

    // Over count or over size: NEVER push over-limit items into executable queuedFiles, and NEVER silently truncate!
    session.queuedFiles = baseQueued;
    const tagReason = check.reason === "size"
      ? `总大小超限（${formatBytes(fileSizeTotal(combined))}/${formatBytes(policy.maxBytes)}）`
      : `超限未入队（${combined.length}/${policy.maxFiles}）`;
    session.rejectedFiles = [
      ...badType,
      ...stagedGood.map((file) => ({
        file,
        kind: check.reason === "size" ? "size" : "over-limit",
        reason: tagReason,
      })),
    ];
    session.inputValidation = {
      tone: "error",
      message: check.message,
      excessCount: check.excessCount || 0,
      excessBytes: check.excessBytes || 0,
    };
    renderSelectedFilesManifest();
  }

  function renderInputControls(workflow) {
    const policy = getWorkflowInputPolicy(workflow);
    const session = workflow ? getSessionState(workflow.id, workflow) : createEmptySessionState();
    reconcileSessionFilesWithPolicy(workflow, session);

    byId("workflowTextInputWrap")?.classList.toggle("hidden", !policy.acceptsText);
    const textInput = byId("workflowTextInput");
    if (textInput && policy.acceptsText && textInput.value !== (session.textInput || "")) {
      textInput.value = session.textInput || "";
    }

    byId("workflowFileInputWrap")?.classList.toggle("hidden", !policy.acceptsFiles);
    byId("workflowBatchToggleWrap")?.classList.toggle("hidden", !policy.supportsBatch);
    const batchToggle = byId("workflowBatchToggle");
    if (batchToggle) {
      if (!policy.supportsBatch) {
        session.batchRequested = false;
        batchToggle.checked = false;
      } else {
        if (!session.batchTouched) session.batchRequested = Boolean(policy.requiresBatch);
        batchToggle.checked = Boolean(session.batchRequested);
      }
    }
    const batchLabel = byId("workflowBatchToggleLabel");
    if (batchLabel) {
      batchLabel.textContent = policy.supportsArchive ? "批量运行并打包结果" : "按批量图片队列运行";
    }

    const fileInput = byId("workflowFileInput");
    if (fileInput) {
      fileInput.multiple = Boolean(policy.multiple);
      fileInput.accept = policy.accept || "";
    }
    if (byId("workflowFileInputLabel")) byId("workflowFileInputLabel").textContent = policy.label;
    if (byId("workflowFileDropSub")) byId("workflowFileDropSub").textContent = policy.dropSub || "或拖拽到此处";
    if (byId("workflowInputHint")) byId("workflowInputHint").textContent = policy.hint;

    const runBtn = byId("runWorkflowBtn");
    if (runBtn) runBtn.disabled = !policy.ready || Boolean(currentActiveRun());
    renderSelectedFilesManifest();
  }

  function renderSelectedFilesManifest() {
    const container = byId("workflowSelectedFiles");
    const workflow = selectedWorkflow();
    if (!container) return;
    if (!workflow) {
      renderInputValidation(null);
      container.innerHTML = "";
      container.classList.add("hidden");
      return;
    }
    const policy = getWorkflowInputPolicy(workflow);
    const session = getSessionState(workflow.id, workflow);
    renderInputValidation(session);

    const queued = session.queuedFiles || [];
    const rejected = session.rejectedFiles || [];
    if (!queued.length && !rejected.length) {
      container.innerHTML = "";
      container.classList.add("hidden");
      return;
    }

    const queuedBytes = fileSizeTotal(queued);
    const stagedBytes = fileSizeTotal([...queued, ...rejected.filter((e) => e.kind !== "type").map((e) => e.file)]);
    container.classList.remove("hidden");
    container.innerHTML = `
      <div class="wf-files-head">
        <div class="wf-files-summary">
          <span class="wf-files-count-pill">待执行队列 ${queued.length} / ${policy.maxFiles} ${escapeHtml(policy.unitLabel)}</span>
          <span>总大小 ${formatBytes(queuedBytes)} / ${formatBytes(policy.maxBytes)}</span>
        </div>
        <div class="wf-files-actions">
          ${policy.multiple ? '<button class="button-ghost wf-files-append" type="button" id="appendWorkflowFilesBtn">继续添加</button>' : ""}
          <button class="button-ghost wf-files-clear" type="button" id="clearWorkflowFilesBtn">清空全部</button>
        </div>
      </div>
      ${queued.length ? `
        <ul class="wf-files-list" id="workflowReadyFileList" aria-label="待执行文件队列">
          ${queued.map((file, index) => `
            <li data-wf-file-idx="${index}">
              <div class="wf-file-main">
                <span class="wf-file-index">${index + 1}.</span>
                <span class="wf-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
              </div>
              <div class="wf-file-meta">
                <span>${formatBytes(file.size)}</span>
                <span class="wf-file-status" data-tone="ok">就绪</span>
                <button class="wf-file-remove" type="button" data-wf-remove-file="${index}" aria-label="移除 ${escapeHtml(file.name)}" title="移除此文件">移除</button>
              </div>
            </li>
          `).join("")}
        </ul>
      ` : ""}
      ${rejected.length ? `
        <div class="wf-rejected-section" id="workflowRejectedFilesSection">
          <div class="wf-files-head">
            <span>未入队文件（${rejected.length} 项 · 含暂存合计 ${queued.length + rejected.filter((e) => e.kind !== "type").length}/${policy.maxFiles} · ${formatBytes(stagedBytes)}）</span>
            <button class="button-ghost wf-files-clear" type="button" id="clearRejectedFilesBtn">清除未入队</button>
          </div>
          <ul class="wf-files-list wf-files-list--rejected" id="workflowRejectedFileList" aria-label="未入队或超限文件">
            ${rejected.map((entry, index) => `
              <li class="is-rejected" data-wf-rejected-idx="${index}">
                <div class="wf-file-main">
                  <span class="wf-file-index">•</span>
                  <span class="wf-file-name" title="${escapeHtml(entry.file.name)}">${escapeHtml(entry.file.name)}</span>
                </div>
                <div class="wf-file-meta">
                  <span>${formatBytes(entry.file.size)}</span>
                  <span class="wf-file-status" data-tone="error">${escapeHtml(entry.reason)}</span>
                  <button class="wf-file-remove" type="button" data-wf-remove-rejected="${index}" aria-label="移除未入队文件 ${escapeHtml(entry.file.name)}" title="移除此项">移除</button>
                </div>
              </li>
            `).join("")}
          </ul>
        </div>
      ` : ""}
    `;

    byId("appendWorkflowFilesBtn")?.addEventListener("click", () => {
      const fileInput = byId("workflowFileInput");
      if (!fileInput) return;
      pendingFilePickerMode = "append";
      fileInput.value = "";
      fileInput.click();
    });

    byId("clearWorkflowFilesBtn")?.addEventListener("click", () => {
      session.queuedFiles = [];
      session.rejectedFiles = [];
      session.inputValidation = null;
      const fileInput = byId("workflowFileInput");
      if (fileInput) fileInput.value = "";
      renderSelectedFilesManifest();
    });

    byId("clearRejectedFilesBtn")?.addEventListener("click", () => {
      session.rejectedFiles = [];
      session.inputValidation = null;
      renderSelectedFilesManifest();
    });

    container.querySelectorAll("[data-wf-remove-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.wfRemoveFile);
        if (!Number.isInteger(idx) || idx < 0 || idx >= session.queuedFiles.length) return;
        session.queuedFiles.splice(idx, 1);
        reconcileSessionFilesWithPolicy(workflow, session);
        renderSelectedFilesManifest();
      });
    });

    container.querySelectorAll("[data-wf-remove-rejected]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.wfRemoveRejected);
        if (!Number.isInteger(idx) || idx < 0 || idx >= session.rejectedFiles.length) return;
        session.rejectedFiles.splice(idx, 1);
        reconcileSessionFilesWithPolicy(workflow, session);
        renderSelectedFilesManifest();
      });
    });
  }

  function renderEditor(options = {}) {
    const workflow = selectedWorkflow();
    byId("workflowEmptyState")?.classList.toggle("hidden", Boolean(workflow));
    byId("workflowEditorBody")?.classList.toggle("hidden", !workflow);
    if (!workflow) return;

    const nameInput = byId("workflowNameInput");
    if (nameInput && nameInput !== document.activeElement) nameInput.value = workflow.name;

    const flow = workflowFlowSummary(workflow);
    const summaryEl = byId("workflowCanvasSummary");
    if (summaryEl) {
      summaryEl.innerHTML = `<span class="wf-summary-chip">${workflow.steps.length} / ${MAX_STEPS} 节点</span><span class="wf-summary-chip">${escapeHtml(flow.inputLabel)} → ${escapeHtml(flow.outputLabel)}</span>`;
    }

    const list = byId("workflowStepList");
    const statusById = new Map(lastStatuses.map((s) => [s.id, s]));
    const hasSteps = workflow.steps.length > 0;
    byId("workflowCanvasEmpty")?.classList.toggle("hidden", hasSteps);
    byId("canvasTrailingAddBtn")?.classList.toggle("hidden", !hasSteps || workflow.steps.length >= MAX_STEPS);

    list.innerHTML = workflow.steps.map((step, index) => {
      const cap = CAPABILITY_REGISTRY[step.tool_id];
      const statusObj = statusById.get(step.id);
      const status = statusObj?.status || (step.enabled ? "waiting" : "skipped");
      const statusLabel = STATUS_LABELS[status] || status;
      const isSelected = step.id === selectedStepId;
      return `<li class="workflow-step wf-node${step.enabled ? "" : " disabled"}" data-step-id="${step.id}" data-flip-key="${step.id}" data-step-status="${status}" data-selected="${isSelected}" data-enabled="${step.enabled}" draggable="true" tabindex="0" aria-label="第 ${index + 1} 步：${escapeHtml(cap.name)}，状态：${escapeHtml(statusLabel)}">
        <svg class="wf-node-trace-svg" width="0" height="0" fill="none" aria-hidden="true" focusable="false"><rect class="wf-node-trace-rect" x="1" y="1" width="268" height="148" rx="13" ry="13" pathLength="100" fill="none" stroke="none" opacity="0"></rect></svg>
        <span class="wf-port wf-port-in" data-port="in" aria-hidden="true"></span>
        <div class="wf-node-header">
          <button class="wf-node-drag-handle" type="button" data-wf-drag-handle aria-label="拖动调整第 ${index + 1} 步顺序" title="拖动调整顺序">${uiIconSvg("grip", "wf-grip-icon")}</button>
          <span class="wf-node-index">${index + 1}</span>
          <span class="wf-node-icon">${capabilityIconSvg(step.tool_id)}</span>
          <div class="wf-node-title-col">
            <strong class="wf-node-name">${escapeHtml(cap.name)}</strong>
            <small class="wf-node-io-text">${escapeHtml(formatTypesLabel(cap.input_types))} → ${escapeHtml(formatTypesLabel(cap.output_types))}</small>
          </div>
          <span class="wf-node-status-pill" data-status="${status}">${escapeHtml(statusLabel)}${statusObj?.duration_ms ? ` · ${statusObj.duration_ms}ms` : ""}</span>
        </div>
        <p class="wf-node-summary">${escapeHtml(summarizeStepConfig(step))}</p>
        ${statusObj?.error ? `<p class="wf-node-error" role="status">${escapeHtml(statusObj.error)}</p>` : ""}
        <div class="wf-node-footer">
          <label class="wf-node-enable"><input data-step-enabled type="checkbox"${step.enabled ? " checked" : ""} /><span>启用</span></label>
          <div class="workflow-step-actions wf-node-actions">
            <button class="button-ghost wf-node-act" data-step-up type="button" aria-label="上移第 ${index + 1} 步" title="前移"${index === 0 ? " disabled" : ""}>前移</button>
            <button class="button-ghost wf-node-act" data-step-down type="button" aria-label="下移第 ${index + 1} 步" title="后移"${index >= workflow.steps.length - 1 ? " disabled" : ""}>后移</button>
            <button class="button-ghost wf-node-act" data-step-duplicate type="button" title="复制节点">复制</button>
            <button class="button-ghost wf-node-act danger-text" data-step-delete type="button" title="删除节点">删除</button>
          </div>
        </div>
        <span class="wf-port wf-port-out" data-port="out" aria-hidden="true"></span>
      </li>`;
    }).join("");

    // Keep hidden compatibility select synced.
    const addable = addableCapabilities(workflow);
    const toolSelect = byId("workflowToolSelect");
    if (toolSelect) {
      toolSelect.innerHTML = addable.map(([id, item]) => `<option value="${id}">${escapeHtml(item.name)}</option>`).join("");
    }
    const addBtn = byId("addWorkflowStepBtn");
    if (addBtn) addBtn.disabled = !addable.length || workflow.steps.length >= MAX_STEPS;

    applyNodeOffsetsToDom(list, workflow);
    bindStepEvents();
    renderInputControls(workflow);

    if (selectedStepId && workflow.steps.some((s) => s.id === selectedStepId)) {
      const inspBody = byId("workflowInspectorBody");
      const activeInsideInspector = inspBody && inspBody.contains(document.activeElement);
      if (!activeInsideInspector) renderInspector();
      else syncInspectorVisibility();
    } else {
      selectedStepId = "";
      syncInspectorVisibility();
    }

    if (options.flipSnapshot) playNodeFlip(options.flipSnapshot);
    applyCanvasTransform({ animate: false });
    if (options.fitView) {
      root.requestAnimationFrame?.(() => fitCanvasToView({ animate: false }));
    } else {
      scheduleEdgeSync(options.flipSnapshot ? 300 : 40);
    }
  }

  function renderNodePickerList() {
    const workflow = selectedWorkflow();
    const listEl = byId("workflowNodePickerList");
    const catsEl = byId("workflowNodeCategories");
    if (!workflow || !listEl || !catsEl) return;

    catsEl.innerHTML = NODE_CATEGORIES.map((cat) => {
      const active = pickerCategory === cat.id;
      return `<button type="button" role="tab" aria-selected="${active}" class="wf-picker-cat-pill${active ? " is-active" : ""}" data-picker-cat="${cat.id}">${escapeHtml(cat.label)}</button>`;
    }).join("");

    catsEl.querySelectorAll("[data-picker-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        pickerCategory = btn.dataset.pickerCat;
        pickerActiveIndex = 0;
        renderNodePickerList();
      });
    });

    const q = pickerSearchQuery.trim().toLowerCase();
    const entries = Object.entries(CAPABILITY_REGISTRY).map(([toolId, cap]) => {
      const meta = CAPABILITY_META[toolId] || {};
      const compat = candidateCompatibility(workflow, toolId, pickerInsertIndex);
      return { toolId, cap, meta, compat };
    }).filter(({ toolId, cap, meta }) => {
      if (pickerCategory !== "all" && meta.category !== pickerCategory) return false;
      if (!q) return true;
      const haystack = `${cap.name} ${toolId} ${meta.description || ""} ${meta.categoryLabel || ""} ${cap.input_types.join(" ")} ${cap.output_types.join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });

    if (!entries.length) {
      listEl.innerHTML = `<div class="wf-picker-empty"><p>没有找到匹配的节点能力，可以清空搜索词查看全部 12 项能力。</p></div>`;
      return;
    }

    if (pickerActiveIndex >= entries.length) pickerActiveIndex = 0;

    listEl.innerHTML = entries.map(({ toolId, cap, meta, compat }, idx) => {
      const isActive = idx === pickerActiveIndex;
      return `<button type="button" role="option" aria-selected="${isActive}" class="wf-picker-item${compat.compatible ? "" : " is-incompatible"}${isActive ? " is-active" : ""}" data-picker-tool="${toolId}" ${compat.compatible ? "" : 'disabled aria-disabled="true"'}>
        <span class="wf-picker-item-icon">${capabilityIconSvg(toolId)}</span>
        <span class="wf-picker-item-copy">
          <span class="wf-picker-item-title-row">
            <strong>${escapeHtml(cap.name)}</strong>
            <span class="wf-picker-cat-tag">${escapeHtml(meta.categoryLabel || "")}</span>
          </span>
          <small class="wf-picker-item-desc">${escapeHtml(meta.description || "")}</small>
          <span class="wf-picker-item-io">
            <span>${escapeHtml(formatTypesLabel(cap.input_types))} → ${escapeHtml(formatTypesLabel(cap.output_types))}</span>
            <em class="wf-compat-pill" data-compatible="${compat.compatible}">${compat.compatible ? "可衔接" : escapeHtml(compat.reason)}</em>
          </span>
        </span>
      </button>`;
    }).join("");

    listEl.querySelectorAll("[data-picker-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const toolId = btn.dataset.pickerTool;
        const idx = pickerInsertIndex;
        closeNodePicker({ restoreFocus: false });
        insertStepAt(toolId, idx);
      });
    });
  }

  function openNodePicker(insertIndex = -1, triggerEl = null) {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    pickerReturnFocus = triggerEl || document.activeElement;
    pickerInsertIndex = insertIndex;
    pickerCategory = "all";
    pickerSearchQuery = "";
    pickerActiveIndex = 0;
    pickerOpen = true;
    const searchInput = byId("workflowNodeSearch");
    if (searchInput) searchInput.value = "";
    const sub = byId("wfNodePickerSubtitle");
    if (sub) {
      sub.textContent = insertIndex >= 0 && insertIndex < workflow.steps.length
        ? `在第 ${insertIndex} 步与第 ${insertIndex + 1} 步之间插入兼容节点`
        : "选择要追加到流程末尾的处理能力";
    }
    const layer = byId("workflowNodePicker");
    if (layer) {
      layer.classList.remove("hidden");
      layer.setAttribute("aria-hidden", "false");
    }
    renderNodePickerList();
    root.requestAnimationFrame?.(() => {
      searchInput?.focus?.({ preventScroll: true });
    });
  }

  function closeNodePicker({ restoreFocus = true } = {}) {
    if (!pickerOpen) return;
    pickerOpen = false;
    const layer = byId("workflowNodePicker");
    if (layer) {
      layer.classList.add("hidden");
      layer.setAttribute("aria-hidden", "true");
    }
    if (restoreFocus && pickerReturnFocus?.isConnected) {
      pickerReturnFocus.focus?.({ preventScroll: true });
    }
    pickerReturnFocus = null;
  }

  function stopAllVisualAnimations() {
    if (execVisualState) {
      execVisualState.timers?.forEach((t) => root.clearTimeout(t));
      execVisualState.anims?.forEach((a) => { try { a.cancel(); } catch (_) {} });
      execVisualState = null;
    }
    byId("workflowCanvasEdges")?.querySelectorAll(".wf-edge-pulse").forEach((p) => {
      try { p.getAnimations?.().forEach((a) => a.cancel()); } catch (_) {}
      p.style.opacity = "0";
    });
    byId("workflowStepList")?.querySelectorAll(".wf-node-trace-rect").forEach((r) => {
      try { r.getAnimations?.().forEach((a) => a.cancel()); } catch (_) {}
      r.style.strokeDasharray = "";
      r.style.strokeDashoffset = "";
    });
  }

  function playEdgeLightPulse(edgeId, durationMs = 260) {
    if (isReducedMotion()) return;
    const svg = byId("workflowCanvasEdges");
    const pulse = svg?.querySelector(`[data-edge-id="${edgeId}"] .wf-edge-pulse`);
    if (!pulse || typeof pulse.animate !== "function") return;
    try {
      pulse.getAnimations?.().forEach((a) => a.cancel());
      const anim = pulse.animate(
        [
          { strokeDashoffset: 30, opacity: 0.25 },
          { opacity: 1, offset: 0.18 },
          { strokeDashoffset: -100, opacity: 0.92, offset: 0.86 },
          { strokeDashoffset: -100, opacity: 0 },
        ],
        {
          duration: durationMs,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "none",
        },
      );
      if (document?.hidden) anim.pause();
      if (execVisualState) execVisualState.anims.push(anim);
    } catch (_) {}
  }

  function startNodeBorderTrace(stepId) {
    const node = byId("workflowStepList")?.querySelector(`[data-step-id="${stepId}"]`);
    const rect = node?.querySelector(".wf-node-trace-rect");
    if (!node || !rect) return;
    syncNodeTraceGeometry(node);
    if (isReducedMotion() || typeof rect.animate !== "function") return;
    const existing = execVisualState?.nodeBorderAnims?.get(stepId);
    if (existing && existing.playState === "running") return;
    try {
      rect.getAnimations?.().forEach((a) => a.cancel());
      rect.style.strokeDasharray = "30 70";
      const anim = rect.animate(
        [
          { strokeDashoffset: 0 },
          { strokeDashoffset: -100 },
        ],
        {
          duration: 1450,
          iterations: Infinity,
          easing: "linear",
        },
      );
      if (document?.hidden) anim.pause();
      if (execVisualState) {
        execVisualState.nodeBorderAnims.set(stepId, anim);
        execVisualState.anims.push(anim);
      }
    } catch (_) {}
  }

  function stopNodeBorderTrace(stepId) {
    const anim = execVisualState?.nodeBorderAnims?.get(stepId);
    if (anim) {
      try { anim.cancel(); } catch (_) {}
      execVisualState.nodeBorderAnims.delete(stepId);
    }
    const rect = byId("workflowStepList")?.querySelector(`[data-step-id="${stepId}"] .wf-node-trace-rect`);
    if (rect) {
      try { rect.getAnimations?.().forEach((a) => a.cancel()); } catch (_) {}
      rect.style.strokeDasharray = "";
      rect.style.strokeDashoffset = "";
    }
  }

  function startVisualExecutionRun(workflow) {
    stopAllVisualAnimations();
    currentRunEpoch += 1;
    const epoch = currentRunEpoch;
    execVisualState = {
      epoch,
      stepIds: (workflow?.steps || []).map((s) => s.id),
      prevStatusById: new Map(),
      pulsedEdges: new Set(),
      nodeBorderAnims: new Map(),
      anims: [],
      timers: [],
      relayTail: 0,
    };
    const firstActive = (workflow?.steps || []).find((s) => s.enabled);
    if (firstActive) {
      execVisualState.pulsedEdges.add("__entry__");
      playEdgeLightPulse("__entry__", 220);
    }
    return epoch;
  }

  function syncVisualExecutionRun(epoch, statuses = [], { completed = false, failed = false, cancelled = false } = {}) {
    if (!execVisualState || execVisualState.epoch !== epoch) return;
    const state = execVisualState;
    const orderedIds = statuses.map((s) => s.id);
    const activeOrder = statuses.filter((s) => s.status !== "skipped").map((s) => s.id);

    const schedulePulse = (edgeId, delayMs = 0) => {
      if (!edgeId || state.pulsedEdges.has(edgeId)) return;
      state.pulsedEdges.add(edgeId);
      if (delayMs <= 0) {
        playEdgeLightPulse(edgeId, 240);
      } else {
        const timer = root.setTimeout(() => {
          if (execVisualState?.epoch === epoch) playEdgeLightPulse(edgeId, 240);
        }, delayMs);
        state.timers.push(timer);
      }
    };

    const incomingEdgeFor = (stepId) => {
      const idx = orderedIds.indexOf(stepId);
      if (idx <= 0) return "__entry__";
      const prevId = orderedIds[idx - 1];
      return `${prevId}__${stepId}`;
    };

    if (failed || cancelled) {
      for (const s of statuses) stopNodeBorderTrace(s.id);
      state.timers.forEach((t) => root.clearTimeout(t));
      state.timers = [];
      return;
    }

    let catchupStagger = 0;
    for (const s of statuses) {
      const prev = state.prevStatusById.get(s.id) || "waiting";
      if (s.status === "running") {
        const activeIdx = activeOrder.indexOf(s.id);
        const edgeId = activeIdx === 0 ? "__entry__" : incomingEdgeFor(s.id);
        schedulePulse(edgeId, 0);
        startNodeBorderTrace(s.id);
      } else if (s.status === "success" && prev !== "success") {
        stopNodeBorderTrace(s.id);
        if (prev !== "running") {
          const activeIdx = activeOrder.indexOf(s.id);
          const edgeId = activeIdx === 0 ? "__entry__" : incomingEdgeFor(s.id);
          schedulePulse(edgeId, catchupStagger);
          catchupStagger += 85;
        }
      } else if (s.status === "failed" || s.status === "cancelled" || s.status === "skipped") {
        stopNodeBorderTrace(s.id);
      }
      state.prevStatusById.set(s.id, s.status);
    }

    if (completed) {
      for (const s of statuses) stopNodeBorderTrace(s.id);
      schedulePulse("__exit__", catchupStagger);
    }
  }

  function renderStepStatuses(statuses = []) {
    lastStatuses = Array.isArray(statuses) ? cloneJson(statuses) : [];
    const target = byId("workflowStepStatuses");
    const progressEl = byId("workflowRunProgressText");
    if (progressEl) {
      const activeTotal = statuses.filter((s) => s.status !== "skipped").length || statuses.length;
      const doneCount = statuses.filter((s) => s.status === "success").length;
      const runningStep = statuses.find((s) => s.status === "running");
      if (runningStep) {
        progressEl.textContent = `正在执行：${CAPABILITY_REGISTRY[runningStep.tool_id]?.name || runningStep.tool_id}（已完成 ${doneCount}/${activeTotal}）`;
      } else if (statuses.length) {
        progressEl.textContent = `已完成 ${doneCount}/${activeTotal} 步`;
      } else {
        progressEl.textContent = "";
      }
    }
    // Sync live status onto canvas node cards and edges without tearing down the DOM.
    const list = byId("workflowStepList");
    if (list) {
      statuses.forEach((status) => {
        const node = list.querySelector(`[data-step-id="${status.id}"]`);
        if (!node) return;
        node.dataset.stepStatus = status.status;
        syncNodeTraceGeometry(node);
        const pill = node.querySelector(".wf-node-status-pill");
        if (pill) {
          pill.dataset.status = status.status;
          pill.textContent = `${STATUS_LABELS[status.status] || status.status}${status.duration_ms ? ` · ${status.duration_ms}ms` : ""}`;
        }
        let errNode = node.querySelector(".wf-node-error");
        if (status.error) {
          if (!errNode) {
            errNode = document.createElement("p");
            errNode.className = "wf-node-error";
            errNode.setAttribute("role", "status");
            node.querySelector(".wf-node-summary")?.after(errNode);
          }
          errNode.textContent = status.error;
        } else if (errNode) {
          errNode.remove();
        }
      });
      syncCanvasEdges();
    }
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
    for (const url of extraPreviewUrls) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    extraPreviewUrls = [];
    const preview = byId("workflowResultPreview");
    if (preview) preview.innerHTML = "";
  }

  async function releaseLastOutput(targetSession = null) {
    const session = targetSession || getSessionState();
    if (!targetSession || currentSessionKey() === currentSessionKey(session.workflowId)) {
      clearPreview();
    }
    if (session.lastOutput) await cleanupResource(session.lastOutput);
    session.lastOutput = null;
    session.downloadBundle = null;
    session.outputSummary = null;
    session.copyStatus = "";
    session.downloadDone = false;
  }

  function renderTypedOutputCard(kind, detailHtml) {
    const typed = byId("workflowTypedOutput");
    if (!typed) return;
    if (!kind) {
      typed.innerHTML = "";
      typed.classList.add("hidden");
      return;
    }
    typed.classList.remove("hidden");
    typed.dataset.outputKind = kind;
    typed.innerHTML = detailHtml;
    typed.querySelectorAll("[data-focus-failed-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedStepId = btn.dataset.focusFailedStep;
        renderInspector();
      });
    });
    typed.querySelectorAll("[data-wf-download-item]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.wfDownloadItem);
        const out = currentLastOutput();
        if (!out || out.type !== "image-list" || !Array.isArray(out.value)) return;
        const entry = out.value[idx];
        const blob = entry?.resource?.value || entry?.value;
        const name = entry?.resource?.name || entry?.name || `image-${idx + 1}.png`;
        if (blob) downloadBlob(name, blob);
      });
    });
  }

  function renderPreviewForOutput(resource) {
    clearPreview();
    const container = byId("workflowResultPreview");
    if (!container || !resource) return;
    if (resource.type === "image" && resource.value) {
      previewUrl = URL.createObjectURL(resource.value);
      const image = document.createElement("img");
      image.src = previewUrl;
      image.alt = "工作流图片结果预览";
      container.appendChild(image);
      return;
    }
    if (resource.type === "image-list" && Array.isArray(resource.value)) {
      const succeeded = resource.value.filter((item) => item.status === "success" && (item.resource?.value || item.value));
      if (!succeeded.length) return;
      const gallery = document.createElement("div");
      gallery.className = "wf-image-gallery";
      succeeded.slice(0, 12).forEach((item, index) => {
        const blob = item.resource?.value || item.value;
        const name = item.resource?.name || item.name || `result-${index + 1}`;
        const url = URL.createObjectURL(blob);
        extraPreviewUrls.push(url);
        const card = document.createElement("div");
        card.className = "wf-image-thumb-card";
        const img = document.createElement("img");
        img.src = url;
        img.alt = `处理结果：${name}`;
        const caption = document.createElement("span");
        caption.textContent = name;
        caption.title = name;
        card.append(img, caption);
        gallery.appendChild(card);
      });
      container.appendChild(gallery);
    }
  }

  function restoreSessionResultUi(session) {
    if (!session) return;
    const textTarget = byId("workflowResultText");
    const textWrap = byId("workflowResultTextWrap");
    const textLabel = byId("workflowResultTextLabel");
    const copyButton = byId("copyWorkflowResultBtn");
    const downloadButton = byId("downloadWorkflowResultBtn");
    const statusesEl = byId("workflowStepStatuses");

    if (statusesEl) {
      const statuses = session.lastStatuses || [];
      statusesEl.innerHTML = statuses.map((status, index) => `<div data-workflow-step-status="${status.id}" data-status="${status.status}"><span>${index + 1}. ${escapeHtml(CAPABILITY_REGISTRY[status.tool_id]?.name || status.tool_id)}</span><strong>${STATUS_LABELS[status.status] || status.status}${status.duration_ms ? ` · ${status.duration_ms} ms` : ""}</strong>${status.error ? `<small>${escapeHtml(status.error)}</small>` : ""}</div>`).join("");
    }

    const summary = session.outputSummary;
    if (!summary) return;
    if (textTarget) textTarget.value = summary.resultText || "";
    if (textWrap) textWrap.classList.toggle("hidden", Boolean(summary.resultTextHidden));
    if (textLabel) textLabel.textContent = summary.resultTextLabel || "最终结果";
    if (copyButton) {
      copyButton.disabled = !summary.canCopy;
      copyButton.textContent = session.copyStatus || copyButton.dataset.originalLabel || "复制结果";
    }
    if (downloadButton) {
      downloadButton.disabled = !summary.canDownload;
      downloadButton.textContent = downloadButton.dataset.originalLabel || "下载结果";
    }
    renderTypedOutputCard(summary.kind, summary.detailHtml);
    renderPreviewForOutput(session.lastOutput);
  }

  function displayErrorOutput(error, targetSession = null) {
    const session = targetSession || getSessionState();
    const statuses = session.lastStatuses || lastStatuses || [];
    const failedStep = statuses.find((s) => s.status === "failed");
    const stepName = failedStep ? (CAPABILITY_REGISTRY[failedStep.tool_id]?.name || failedStep.tool_id) : "";
    const errObj = { stepId: failedStep?.id || "", message: error.message };
    session.runError = errObj;
    const detailHtml = `
      <div class="wf-output-banner" data-tone="error">
        <div>
          <strong>${failedStep ? `步骤“${escapeHtml(stepName)}”执行失败` : "工作流未能执行"}</strong>
          <p>${escapeHtml(error.message)}</p>
        </div>
        ${failedStep ? `<button class="button-secondary" type="button" data-focus-failed-step="${failedStep.id}">定位到失败节点</button>` : ""}
      </div>
    `;
    session.outputSummary = {
      kind: "error",
      detailHtml,
      resultText: error.message,
      resultTextLabel: "错误详情",
      resultTextHidden: false,
      canCopy: false,
      canDownload: false,
    };
    if (currentSessionKey() === currentSessionKey(session.workflowId)) {
      lastRunError = errObj;
      byId("workflowResultTextWrap")?.classList.remove("hidden");
      if (byId("workflowResultTextLabel")) byId("workflowResultTextLabel").textContent = "错误详情";
      renderTypedOutputCard("error", detailHtml);
    }
  }

  async function buildImageListDownloadArchive(resource) {
    const items = Array.isArray(resource?.value) ? resource.value : [];
    const entries = [];
    for (const item of items) {
      if (item.status === "failed") continue;
      const child = item.resource || item;
      const blob = child?.value || child;
      if (!blob || typeof blob.arrayBuffer !== "function") continue;
      entries.push({
        name: child.name || item.name || `image-${entries.length + 1}.png`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    if (!entries.length) return null;
    return createResource("archive", primitive("zipBlob")(entries), {
      name: "workflow-images.zip",
      mime: "application/zip",
      owned: true,
    });
  }

  function displayOutput(resource, targetSession = null, downloadArchive = null) {
    const session = targetSession || getSessionState();
    const isCurrent = currentSessionKey() === currentSessionKey(session.workflowId);
    session.runError = null;
    session.copyStatus = "";
    session.downloadDone = false;

    let summary = null;
    if (resource.type === "text") {
      const value = String(resource.value);
      const blob = new Blob([value], { type: resource.mime || "text/plain;charset=utf-8" });
      session.lastOutput = createResource("file", blob, { name: resource.name || "workflow-result.txt", mime: blob.type, owned: true });
      const lines = value ? value.split(/\r?\n/).length : 0;
      summary = {
        kind: "text",
        detailHtml: `<div class="wf-output-banner" data-tone="success"><div><strong>文本处理完成</strong><p>${escapeHtml(resource.name || "workflow-result.txt")} · ${value.length} 字符 · ${lines} 行</p></div></div>`,
        resultText: value,
        resultTextLabel: "文本输出结果",
        resultTextHidden: false,
        canCopy: true,
        canDownload: true,
      };
    } else if (resource.type === "json") {
      const formatted = JSON.stringify(resource.value, null, 2);
      const blob = new Blob([formatted], { type: "application/json" });
      session.lastOutput = createResource("file", blob, { name: resource.name || "workflow-result.json", mime: blob.type, owned: true });
      const countText = Array.isArray(resource.value) ? `${resource.value.length} 条记录` : "JSON 对象";
      summary = {
        kind: "json",
        detailHtml: `<div class="wf-output-banner" data-tone="success"><div><strong>JSON 转换完成</strong><p>${escapeHtml(resource.name || "workflow.json")} · ${countText} · ${formatBytes(blob.size)}</p></div></div>`,
        resultText: formatted,
        resultTextLabel: "结构化 JSON 输出",
        resultTextHidden: false,
        canCopy: true,
        canDownload: true,
      };
    } else if (resource.type === "image") {
      session.lastOutput = resource;
      summary = {
        kind: "image",
        detailHtml: `<div class="wf-output-banner" data-tone="success"><div><strong>图片处理完成</strong><p>${escapeHtml(resource.name || "output-image")} · ${escapeHtml(resource.mime || resource.value?.type || "")} · ${formatBytes(resource.value?.size || 0)}</p></div></div>`,
        resultText: `${resource.name || "处理结果"}\n${resource.mime || resource.value?.type || ""}\n${resource.value?.size ?? 0} 字节`,
        resultTextLabel: "最终结果",
        resultTextHidden: true,
        canCopy: false,
        canDownload: true,
      };
    } else if (resource.type === "image-list") {
      session.lastOutput = resource;
      session.downloadBundle = downloadArchive || null;
      const allItems = Array.isArray(resource.value) ? resource.value : [];
      const succeeded = allItems.filter((item) => item.status === "success");
      const failedCount = allItems.length - succeeded.length;
      const downloadButtons = allItems.map((item, idx) => {
        if (item.status !== "success") return "";
        const outName = item.resource?.name || item.name || `image-${idx + 1}`;
        return `<button class="button-ghost wf-node-act" type="button" data-wf-download-item="${idx}">下载 ${escapeHtml(outName)}</button>`;
      }).join("");
      summary = {
        kind: "image-list",
        detailHtml: `
          <div class="wf-output-banner" data-tone="success">
            <div>
              <strong>批量图片处理完成</strong>
              <p>共 ${succeeded.length} 张成功${failedCount ? `，${failedCount} 张失败` : ""}；可直接点击下方按钮下载单张，或点击“下载结果”获取本地打包 ZIP。</p>
              ${downloadButtons ? `<div class="wf-item-downloads">${downloadButtons}</div>` : ""}
            </div>
          </div>
        `,
        resultText: succeeded.map((item) => `${item.resource?.name || item.name}: ${formatBytes(item.resource?.value?.size || 0)}`).join("\n"),
        resultTextLabel: "批量图片清单",
        resultTextHidden: true,
        canCopy: false,
        canDownload: Boolean(downloadArchive || succeeded.length),
      };
    } else if (resource.type === "archive" || resource.type === "file") {
      session.lastOutput = resource;
      const itemCount = Array.isArray(resource.items) ? resource.items.filter((i) => i.status === "success").length : 0;
      summary = {
        kind: "archive",
        detailHtml: `<div class="wf-output-banner" data-tone="success"><div><strong>${resource.type === "archive" ? "ZIP 压缩包已生成" : "文件产物已生成"}</strong><p>${escapeHtml(resource.name || "workflow-results.zip")} · ${formatBytes(resource.value?.size || 0)}${itemCount ? ` · 包含 ${itemCount} 项成功产物` : ""}</p></div></div>`,
        resultText: `${resource.name || "处理结果"}\n${resource.mime || resource.value?.type || ""}\n${resource.value?.size ?? 0} 字节`,
        resultTextLabel: "最终结果",
        resultTextHidden: true,
        canCopy: false,
        canDownload: true,
      };
    } else {
      session.lastOutput = resource;
      summary = {
        kind: "text",
        detailHtml: `<div class="wf-output-banner" data-tone="success"><div><strong>工作流已完成</strong></div></div>`,
        resultText: "工作流已完成",
        resultTextLabel: "最终结果",
        resultTextHidden: false,
        canCopy: false,
        canDownload: false,
      };
    }

    session.outputSummary = summary;
    if (isCurrent) {
      lastRunError = null;
      restoreSessionResultUi(session);
    }
  }

  async function runSelectedWorkflow() {
    const workflow = validateWorkflow(selectedWorkflow());
    const runSessionKey = currentSessionKey(workflow.id);
    if (!runSessionKey || activeRunsBySession.has(runSessionKey)) return;
    const targetSession = getSessionState(workflow.id, workflow);
    setRunnerExpanded(true, { scroll: true });
    await releaseLastOutput(targetSession);
    if (currentSessionKey() === runSessionKey) renderTypedOutputCard(null);

    const policy = getWorkflowInputPolicy(workflow);
    const files = [...(targetSession.queuedFiles || [])];
    const batchRequested = Boolean(targetSession.batchRequested);

    if (policy.acceptsFiles && !files.length && targetSession.rejectedFiles?.length) {
      throw new Error(targetSession.inputValidation?.message || "存在未入队的超限或无效文件，请先移除多余文件");
    }

    const input = policy.acceptsText
      ? createResource("text", byId("workflowTextInput")?.value || targetSession.textInput || "", { name: "workflow-input.txt", mime: "text/plain", owned: false })
      : resourceFromFiles(workflow, files, batchRequested);

    const controller = new AbortController();
    const isVisibleSession = () => currentSessionKey() === runSessionKey && viewMode === "editor";
    targetSession.runState = { status: "running", label: "运行中", progressText: "" };
    targetSession.itemResults = [];
    targetSession.lastStatuses = [];

    if (currentSessionKey() === runSessionKey) {
      const cancelBtn = byId("cancelWorkflowBtn");
      const runBtn = byId("runWorkflowBtn");
      if (runBtn) runBtn.disabled = true;
      if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.classList.remove("hidden"); }
      if (byId("workflowRunState")) {
        byId("workflowRunState").textContent = "运行中";
        byId("workflowRunState").dataset.status = "running";
      }
      showCanvasAlert("");
      renderItemResults([]);
    }

    const runEpoch = startVisualExecutionRun(workflow);
    const promise = executeWorkflow(workflow, input, {
      signal: controller.signal,
      batch: batchRequested,
      onStatus: (statuses) => {
        targetSession.lastStatuses = cloneJson(statuses);
        const activeTotal = statuses.filter((s) => s.status !== "skipped").length || statuses.length;
        const doneCount = statuses.filter((s) => s.status === "success").length;
        const runningStep = statuses.find((s) => s.status === "running");
        targetSession.runState = {
          status: "running",
          label: "运行中",
          progressText: runningStep
            ? `正在执行：${CAPABILITY_REGISTRY[runningStep.tool_id]?.name || runningStep.tool_id}（已完成 ${doneCount}/${activeTotal}）`
            : `已完成 ${doneCount}/${activeTotal} 步`,
        };
        const items = [...statuses].reverse().find((item) => item.items?.length)?.items || [];
        targetSession.itemResults = cloneJson(items);
        if (currentSessionKey() === runSessionKey) {
          renderStepStatuses(statuses);
          if (isVisibleSession()) syncVisualExecutionRun(runEpoch, statuses);
          renderItemResults(items);
        }
      },
    });
    activeRunsBySession.set(runSessionKey, { controller, promise, workflowId: workflow.id });
    try {
      const result = await promise;
      const downloadArchive = result.output?.type === "image-list"
        ? await buildImageListDownloadArchive(result.output)
        : null;
      targetSession.lastStatuses = cloneJson(result.statuses || targetSession.lastStatuses || []);
      targetSession.runState = { status: "success", label: "已完成", progressText: targetSession.runState.progressText };
      displayOutput(result.output, targetSession, downloadArchive);
      if (currentSessionKey() === runSessionKey) {
        if (isVisibleSession()) syncVisualExecutionRun(runEpoch, result.statuses || lastStatuses, { completed: true });
        if (byId("workflowRunState")) {
          byId("workflowRunState").textContent = "已完成";
          byId("workflowRunState").dataset.status = "success";
        }
      }
    } catch (error) {
      const isAbort = error.name === "AbortError";
      targetSession.runState = {
        status: isAbort ? "cancelled" : "failed",
        label: isAbort ? "已取消" : "失败",
        progressText: targetSession.runState.progressText,
      };
      if (currentSessionKey() === runSessionKey) {
        if (isVisibleSession()) syncVisualExecutionRun(runEpoch, targetSession.lastStatuses || lastStatuses, { failed: !isAbort, cancelled: isAbort });
        if (byId("workflowRunState")) {
          byId("workflowRunState").textContent = isAbort ? "已取消" : "失败";
          byId("workflowRunState").dataset.status = isAbort ? "cancelled" : "failed";
        }
        if (byId("workflowResultText")) byId("workflowResultText").value = error.message;
      }
      if (!isAbort) displayErrorOutput(error, targetSession);
    } finally {
      activeRunsBySession.delete(runSessionKey);
      if (currentSessionKey() === runSessionKey) {
        const cancelBtn = byId("cancelWorkflowBtn");
        if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.classList.add("hidden"); }
        renderInputControls(selectedWorkflow());
      }
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
      renderWorkflowList();
    } catch (error) {
      setSaveMessage(`云端保存失败，本地草稿已保留：${error.message}`, true);
    }
  }

  async function deleteWorkflowById(id) {
    const workflow = workflows.find((item) => item.id === id);
    if (!workflow) return;
    const key = currentSessionKey(workflow.id);
    if (key && activeRunsBySession.has(key)) {
      activeRunsBySession.get(key).controller.abort();
      activeRunsBySession.delete(key);
    }
    clearSessionState(workflow.id);
    const cloudId = cloudConfigIds.get(workflow.id);
    workflows = workflows.filter((item) => item.id !== workflow.id);
    removeCanvasUiFor(workflow.id);
    if (selectedWorkflowId === workflow.id) {
      selectedWorkflowId = workflows[0]?.id || "";
      selectedStepId = "";
      const nextWf = selectedWorkflow();
      resetRunnerUiState(nextWf ? getSessionState(nextWf.id, nextWf) : null);
      const ui = loadCanvasUiFor(selectedWorkflowId, nextWf);
      canvasViewport = ui.viewport;
      canvasNodeOffsets = ui.nodeOffsets;
    }
    openRowMenuId = "";
    persistLocalWorkflows();
    if (viewMode === "editor" && !selectedWorkflow()) {
      setViewMode("list");
    } else {
      renderAll();
    }
    setListFeedback(`已删除工作流“${workflow.name}”`);
    if (cloudId && !accessOptions.offline && hasEntitlement("save_tool_config")) {
      try { await bridge.api("/api/tools/config/delete", { id: cloudId }); cloudConfigIds.delete(workflow.id); }
      catch (error) { setSaveMessage(`本地已删除，但云端删除失败：${error.message}`, true); }
    }
  }

  async function deleteCurrentWorkflow() {
    const workflow = selectedWorkflow();
    if (!workflow) return;
    await deleteWorkflowById(workflow.id);
  }

  function duplicateWorkflowById(id) {
    const workflow = workflows.find((item) => item.id === id);
    if (!workflow || workflows.length >= MAX_WORKFLOWS) return;
    const copy = cloneJson(workflow);
    copy.id = randomId("wf");
    copy.name = `${copy.name} 副本`.slice(0, 80);
    copy.created_at = nowIso();
    copy.updated_at = copy.created_at;
    const stepIdMap = new Map();
    copy.steps = copy.steps.map((step) => {
      const nextId = randomId("step");
      stepIdMap.set(step.id, nextId);
      return { ...step, id: nextId };
    });
    const validatedCopy = validateWorkflow(copy);
    workflows.unshift(validatedCopy);
    const srcUi = loadCanvasUiFor(workflow.id, workflow);
    const remappedOffsets = {};
    for (const [oldStepId, offset] of Object.entries(srcUi.nodeOffsets || {})) {
      const nextStepId = stepIdMap.get(oldStepId);
      if (nextStepId) remappedOffsets[nextStepId] = { ...offset };
    }
    selectedWorkflowId = validatedCopy.id;
    selectedStepId = "";
    clearSessionState(validatedCopy.id);
    resetRunnerUiState(getSessionState(validatedCopy.id, validatedCopy));
    canvasViewport = { ...srcUi.viewport };
    canvasNodeOffsets = remappedOffsets;
    openRowMenuId = "";
    persistLocalWorkflows();
    persistCanvasViewport();
    renderAll();
    setSaveMessage("已复制为新工作流");
  }

  function duplicateCurrentWorkflow() {
    const workflow = selectedWorkflow();
    if (workflow) duplicateWorkflowById(workflow.id);
  }

  function exportWorkflowObject(workflow) {
    const valid = validateWorkflow(workflow);
    downloadBlob(`${valid.name.replace(/[\\/:*?"<>|]+/g, "_")}.workflow.json`, new Blob([JSON.stringify(valid, null, 2)], { type: "application/json" }));
  }

  function exportCurrentWorkflow() {
    exportWorkflowObject(selectedWorkflow());
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
    workflows.unshift(workflow);
    selectedWorkflowId = workflow.id;
    selectedStepId = "";
    clearSessionState(workflow.id);
    resetRunnerUiState(getSessionState(workflow.id, workflow));
    canvasViewport = { panX: 0, panY: 0, zoom: 1 };
    canvasNodeOffsets = {};
    persistLocalWorkflows();
    setViewMode("editor", { fitView: true, closeRunner: true });
    setSaveMessage("导入成功，权限将在运行和云端保存时重新验证");
    setListFeedback(`已导入工作流“${workflow.name}”`);
  }

  function renderAccess() {
    const badge = byId("workflowAccessBadge");
    if (!badge) return;
    if (accessOptions.offline) badge.textContent = permissionAvailable("tools_access") ? "离线本地运行" : "需要联网验证";
    else badge.textContent = hasEntitlement("tools_batch_access") ? "支持批量与云端配置" : hasEntitlement("tools_access") ? "支持本地工作流" : "无工作流权限";
  }

  function renderAll(options = {}) {
    renderWorkflowList();
    renderTemplates();
    if (viewMode === "editor") renderEditor(options);
    renderAccess();
  }

  async function show(_path = "/tools/workflows", options = {}) {
    const currentAcct = accountId();
    const accountSwitched = Boolean(lastSeenAccountId && lastSeenAccountId !== currentAcct);
    if (accountSwitched) abortRunsOutsideAccount(currentAcct);
    lastSeenAccountId = currentAcct;
    const alreadyVisible = !byId("workflowWorkspace")?.classList.contains("hidden");
    setAccess(options);
    byId("toolsDashboard")?.classList.add("hidden");
    byId("toolWorkbench")?.classList.add("hidden");
    byId("workflowWorkspace")?.classList.remove("hidden");
    byId("workflowWorkspace")?.setAttribute("aria-hidden", "false");
    if (!alreadyVisible || accountSwitched) viewMode = "list";
    loadLocalWorkflows();
    const activeWf = selectedWorkflow();
    resetRunnerUiState(activeWf ? getSessionState(activeWf.id, activeWf) : null);
    const ui = loadCanvasUiFor(selectedWorkflowId, activeWf);
    canvasViewport = ui.viewport;
    canvasNodeOffsets = ui.nodeOffsets;
    const beforeSnapshot = JSON.stringify(workflows);
    renderAll({ fitView: false });
    await loadCloudWorkflows();
    if (JSON.stringify(workflows) !== beforeSnapshot) {
      // Preserve active editor/inspector/typing state unless cloud sync changed workflow data.
      renderAll({ fitView: false });
    }
  }

  function hide(options = {}) {
    if (options.cancel) {
      for (const run of activeRunsBySession.values()) run.controller.abort();
      activeRunsBySession.clear();
    }
    stopAllVisualAnimations();
    closeNodePicker({ restoreFocus: false });
    closeEditorMoreMenu();
    openRowMenuId = "";
    byId("workflowWorkspace")?.classList.add("hidden");
    byId("workflowWorkspace")?.setAttribute("aria-hidden", "true");
    clearPreview();
  }

  function matches(path) {
    return /^\/tools\/workflows\/?$/.test(String(path || ""));
  }

  function animateSiblingShift(node, stepId, dx, dy, dragState) {
    const target = Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 ? "none" : `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
    const prevTarget = dragState.shiftTargets.get(stepId) || "none";
    if (prevTarget === target) return;
    dragState.shiftTargets.set(stepId, target);
    const activeAnim = nodeShiftAnims.get(stepId);
    if (activeAnim) {
      try { activeAnim.cancel(); } catch (_) {}
      nodeShiftAnims.delete(stepId);
    }
    if (isReducedMotion() || typeof node.animate !== "function") {
      node.style.transform = target === "none" ? "" : target;
      return;
    }
    const computed = root.getComputedStyle?.(node)?.transform;
    const fromTransform = computed && computed !== "none" ? computed : "translate3d(0px, 0px, 0px)";
    const toTransform = target === "none" ? "translate3d(0px, 0px, 0px)" : target;
    node.classList.add("is-drag-settling");
    node.style.transform = toTransform;
    try {
      const anim = node.animate(
        [{ transform: fromTransform }, { transform: toTransform }],
        { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "none" },
      );
      nodeShiftAnims.set(stepId, anim);
      anim.onfinish = () => {
        if (nodeShiftAnims.get(stepId) === anim) {
          nodeShiftAnims.delete(stepId);
          node.classList.remove("is-drag-settling");
        }
      };
    } catch (_) {
      node.classList.remove("is-drag-settling");
    }
  }

  function cancelActivePointerDrag(animateReset = true) {
    const drag = pointerDragState;
    if (!drag) return;
    pointerDragState = null;
    drag.item.draggable = true;
    drag.item.classList.remove("is-pointer-dragging", "is-swap-invalid");
    try {
      if (drag.item.hasPointerCapture?.(drag.pointerId)) drag.item.releasePointerCapture(drag.pointerId);
    } catch (_) {}
    const viewport = byId("workflowCanvasViewport");
    if (viewport) delete viewport.dataset.swapValid;

    // Reset dragged node back to origin offset and all siblings to slot 0.
    const originOff = drag.originOff;
    const rawCurrX = Number.parseFloat(drag.item.style.getPropertyValue("--wf-off-x"));
    const rawCurrY = Number.parseFloat(drag.item.style.getPropertyValue("--wf-off-y"));
    const currX = Number.isFinite(rawCurrX) ? rawCurrX : originOff.x;
    const currY = Number.isFinite(rawCurrY) ? rawCurrY : originOff.y;
    drag.item.style.setProperty("--wf-off-x", `${originOff.x.toFixed(1)}px`);
    drag.item.style.setProperty("--wf-off-y", `${originOff.y.toFixed(1)}px`);
    if (animateReset && !isReducedMotion() && typeof drag.item.animate === "function" && (Math.abs(currX - originOff.x) > 1 || Math.abs(currY - originOff.y) > 1)) {
      try {
        drag.item.animate(
          [
            { transform: `translate3d(${(currX - originOff.x).toFixed(1)}px, ${(currY - originOff.y).toFixed(1)}px, 0)` },
            { transform: "translate3d(0px, 0px, 0)" },
          ],
          { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      } catch (_) {}
    }

    drag.nodes.forEach((n) => {
      n.classList.remove("is-drop-target", "is-swap-invalid");
      if (n !== drag.item) {
        if (animateReset) {
          animateSiblingShift(n, n.dataset.stepId, 0, 0, drag);
        } else {
          const anim = nodeShiftAnims.get(n.dataset.stepId);
          if (anim) { try { anim.cancel(); } catch (_) {} nodeShiftAnims.delete(n.dataset.stepId); }
          n.style.transform = "";
          n.classList.remove("is-drag-settling");
        }
      }
    });
    scheduleEdgeSync(animateReset ? 260 : 0);
  }

  function bindCanvasInteractions() {
    const viewport = byId("workflowCanvasViewport");
    if (!viewport) return;

    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      if (event.target.closest(".wf-node, .wf-edge-insert-btn, .wf-trailing-add-node, button, input, select")) return;
      if (isMobileCanvas()) return;
      canvasPanState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originPanX: canvasViewport.panX,
        originPanY: canvasViewport.panY,
        moved: false,
      };
      viewport.classList.add("is-panning");
    });

    viewport.addEventListener("wheel", (event) => {
      if (isMobileCanvas() || viewMode !== "editor") return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.08 : -0.08;
      setCanvasZoom(canvasViewport.zoom + delta, event.clientX, event.clientY);
    }, { passive: false });

    root.addEventListener?.("pointermove", (event) => {
      if (canvasPanState && event.pointerId === canvasPanState.pointerId) {
        const dx = event.clientX - canvasPanState.startX;
        const dy = event.clientY - canvasPanState.startY;
        if (Math.hypot(dx, dy) > 3) canvasPanState.moved = true;
        canvasViewport.panX = canvasPanState.originPanX + dx;
        canvasViewport.panY = canvasPanState.originPanY + dy;
        applyCanvasTransform({ animate: false });
        return;
      }
      if (pointerDragState && event.pointerId === pointerDragState.pointerId) {
        const drag = pointerDragState;
        drag.latestX = event.clientX;
        drag.latestY = event.clientY;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;

        if (!drag.moved) {
          drag.moved = true;
          drag.item.classList.add("is-pointer-dragging");
          try { drag.item.setPointerCapture?.(drag.pointerId); } catch (_) {}
        }

        const mobile = isMobileCanvas();
        const zoom = mobile ? 1 : (canvasViewport.zoom || 1);
        const dxWorld = dx / zoom;
        const dyWorld = dy / zoom;
        const liveOffX = drag.originOff.x + dxWorld;
        const liveOffY = drag.originOff.y + dyWorld;

        drag.item.style.setProperty("--wf-off-x", `${liveOffX.toFixed(1)}px`);
        drag.item.style.setProperty("--wf-off-y", `${liveOffY.toFixed(1)}px`);

        // Evaluate directional swap threshold + hysteresis deadband using un-animated slots.
        const startSlot = drag.slots[drag.startIdx];
        const centerX = startSlot.cx + liveOffX;
        const centerY = startSlot.cy + liveOffY;
        const axisCoord = mobile ? centerY : centerX;
        const slotCenter = (slot) => (mobile ? slot.cy : slot.cx);
        const HYST = 22;

        let nextCandidateIdx = drag.candidateIdx;
        let guard = drag.slots.length;
        while (guard-- > 0) {
          if (nextCandidateIdx < drag.slots.length - 1) {
            const midRight = (slotCenter(drag.slots[nextCandidateIdx]) + slotCenter(drag.slots[nextCandidateIdx + 1])) / 2;
            if (axisCoord > midRight + HYST) {
              nextCandidateIdx += 1;
              continue;
            }
          }
          if (nextCandidateIdx > 0) {
            const midLeft = (slotCenter(drag.slots[nextCandidateIdx - 1]) + slotCenter(drag.slots[nextCandidateIdx])) / 2;
            if (axisCoord < midLeft - HYST) {
              nextCandidateIdx -= 1;
              continue;
            }
          }
          break;
        }

        const workflow = selectedWorkflow();
        if (nextCandidateIdx !== drag.candidateIdx && workflow) {
          drag.candidateIdx = nextCandidateIdx;
          const nextOrder = drag.originalOrder.filter((id) => id !== drag.stepId);
          nextOrder.splice(drag.candidateIdx, 0, drag.stepId);
          drag.candidateOrder = nextOrder;

          // Validate live candidate sequence.
          const stepById = new Map(workflow.steps.map((s) => [s.id, s]));
          const candidateSteps = nextOrder.map((id) => stepById.get(id)).filter(Boolean);
          let candidateValid = true;
          try { validateStepSequence(candidateSteps); } catch (_) { candidateValid = false; }
          drag.lastValid = candidateValid;
          viewport.dataset.swapValid = String(candidateValid);
          drag.item.classList.toggle("is-swap-invalid", !candidateValid);

          // Interruptible sibling yield in stable world space.
          for (const node of drag.nodes) {
            const nid = node.dataset.stepId;
            if (nid === drag.stepId) continue;
            const origIdx = drag.originalOrder.indexOf(nid);
            const newIdx = nextOrder.indexOf(nid);
            const sdx = drag.slots[newIdx].cx - drag.slots[origIdx].cx;
            const sdy = drag.slots[newIdx].cy - drag.slots[origIdx].cy;
            animateSiblingShift(node, nid, sdx, sdy, drag);
          }
          scheduleEdgeSync(260);
        }

        const stepById = new Map((workflow?.steps || []).map((s) => [s.id, s]));
        const candidateSteps = drag.candidateOrder.map((id) => stepById.get(id)).filter(Boolean);
        syncCanvasEdges({ orderedStepIds: drag.candidateOrder, candidateSteps });
      }
    });

    const endPointer = (event) => {
      if (canvasPanState && event.pointerId === canvasPanState.pointerId) {
        const wasMoved = canvasPanState.moved;
        canvasPanState = null;
        viewport.classList.remove("is-panning");
        if (wasMoved) {
          persistCanvasViewport();
        } else if (!event.target.closest(".wf-node")) {
          if (selectedStepId) {
            selectedStepId = "";
            syncInspectorVisibility();
          }
        }
      }
      if (pointerDragState && event.pointerId === pointerDragState.pointerId) {
        const drag = pointerDragState;
        if (!drag.moved) {
          pointerDragState = null;
          drag.item.draggable = true;
          return;
        }
        if (event.type === "pointercancel" || event.type === "lostpointercapture") {
          cancelActivePointerDrag(true);
          return;
        }

        pointerDragState = null;
        drag.item.draggable = true;
        drag.item.classList.remove("is-pointer-dragging", "is-swap-invalid");
        try {
          if (drag.item.hasPointerCapture?.(drag.pointerId)) drag.item.releasePointerCapture(drag.pointerId);
        } catch (_) {}
        delete viewport.dataset.swapValid;

        const workflow = selectedWorkflow();
        if (!workflow) return;
        const mobile = isMobileCanvas();
        const zoom = mobile ? 1 : (canvasViewport.zoom || 1);
        const dxWorld = (drag.latestX - drag.startX) / zoom;
        const dyWorld = (drag.latestY - drag.startY) / zoom;
        const startSlot = drag.slots[drag.startIdx];
        const dragCenterX = startSlot.cx + drag.originOff.x + dxWorld;
        const dragCenterY = startSlot.cy + drag.originOff.y + dyWorld;

        if (drag.candidateIdx === drag.startIdx) {
          // Stayed within original sequential zone: preserve unrestricted desktop coordinates!
          drag.nodes.forEach((n) => {
            if (n !== drag.item) animateSiblingShift(n, n.dataset.stepId, 0, 0, drag);
          });
          if (mobile) {
            drag.item.style.setProperty("--wf-off-x", "0.0px");
            drag.item.style.setProperty("--wf-off-y", "0.0px");
            scheduleEdgeSync(220);
            return;
          }
          const settledOff = clampNodeOffset(drag.originOff.x + dxWorld, drag.originOff.y + dyWorld);
          canvasNodeOffsets[drag.stepId] = settledOff;
          drag.item.style.setProperty("--wf-off-x", `${settledOff.x.toFixed(1)}px`);
          drag.item.style.setProperty("--wf-off-y", `${settledOff.y.toFixed(1)}px`);
          persistCanvasViewport();
          scheduleEdgeSync(220);
          return;
        }

        // Crossed into another zone: validate candidate order!
        const stepById = new Map(workflow.steps.map((s) => [s.id, s]));
        const candidateSteps = drag.candidateOrder.map((id) => stepById.get(id)).filter(Boolean);
        try {
          validateStepSequence(candidateSteps);
        } catch (error) {
          showCanvasAlert(`无法调整节点顺序：${error.message}`, "error");
          // Roll back cleanly: restore dragged card + siblings + edges together.
          pointerDragState = drag;
          cancelActivePointerDrag(true);
          return;
        }

        // Commit valid reorder cleanly + retain released spatial coordinates (never force-snap to slot center).
        const beforeRects = new Map();
        drag.nodes.forEach((n) => {
          const anim = nodeShiftAnims.get(n.dataset.stepId);
          const rect = n.getBoundingClientRect();
          if (rect.width > 0) beforeRects.set(n.dataset.stepId, { element: n, rect });
          if (anim) { try { anim.cancel(); } catch (_) {} nodeShiftAnims.delete(n.dataset.stepId); }
          n.style.transform = "";
          n.classList.remove("is-drag-settling");
        });

        if (!mobile) {
          const destSlot = drag.slots[drag.candidateIdx];
          canvasNodeOffsets[drag.stepId] = clampNodeOffset(dragCenterX - destSlot.cx, dragCenterY - destSlot.cy);
        }
        workflow.steps = candidateSteps;
        lastStatuses = [];
        lastRunError = null;
        showCanvasAlert("");
        markWorkflowUpdated();
        persistCanvasViewport();
        renderEditor({ flipSnapshot: isReducedMotion() ? null : beforeRects, fitView: false });
      }
    };

    root.addEventListener?.("pointerup", endPointer);
    root.addEventListener?.("pointercancel", endPointer);
    root.addEventListener?.("lostpointercapture", endPointer);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!execVisualState?.anims?.length) return;
        for (const anim of execVisualState.anims) {
          try {
            if (document.hidden && anim.playState === "running") anim.pause();
            else if (!document.hidden && anim.playState === "paused") anim.play();
          } catch (_) {}
        }
      });
    }

    if (typeof ResizeObserver === "function") {
      canvasResizeObserver = new ResizeObserver(() => {
        if (viewMode === "editor") {
          applyCanvasTransform({ animate: false });
          scheduleEdgeSync(30);
        }
      });
      canvasResizeObserver.observe(viewport);
    }
  }

  function init(context) {
    if (initialized) { bridge = context; return; }
    initialized = true;
    bridge = context;

    byId("closeWorkflowBtn")?.addEventListener("click", () => {
      hide({ cancel: true });
      byId("toolsDashboard")?.classList.remove("hidden");
      document.querySelector("#toolsPanel .tools-header")?.classList.remove("hidden");
      if (!byId("toolCatalog")?.children.length) root.WYJTools?.prepare?.();
      bridge.navigate("/tools");
      const openBtn = byId("openWorkflowBtn");
      (openBtn && !openBtn.disabled ? openBtn : byId("toolSearchInput"))?.focus?.({ preventScroll: true });
    });

    byId("workflowBackToListBtn")?.addEventListener("click", () => {
      setViewMode("list");
    });
    byId("workflowEmptyBackBtn")?.addEventListener("click", () => setViewMode("list"));
    byId("workflowEmptyCreateBtn")?.addEventListener("click", () => createAndOpenBlankWorkflow());

    byId("workflowSearchInput")?.addEventListener("input", (event) => {
      workflowSearchQuery = event.currentTarget.value || "";
      renderWorkflowList();
    });

    byId("createWorkflowBtn")?.addEventListener("click", () => createAndOpenBlankWorkflow());

    byId("addWorkflowStepBtn")?.addEventListener("click", () => {
      const toolId = byId("workflowToolSelect")?.value;
      if (toolId) insertStepAt(toolId, -1);
    });

    byId("openNodePickerBtn")?.addEventListener("click", (e) => openNodePicker(-1, e.currentTarget));
    byId("canvasTrailingAddBtn")?.addEventListener("click", (e) => openNodePicker(-1, e.currentTarget));
    byId("canvasEmptyAddBtn")?.addEventListener("click", (e) => openNodePicker(0, e.currentTarget));
    byId("closeNodePickerBtn")?.addEventListener("click", () => closeNodePicker());
    byId("workflowNodePickerBackdrop")?.addEventListener("click", () => closeNodePicker());

    byId("workflowNodeSearch")?.addEventListener("input", (event) => {
      pickerSearchQuery = event.currentTarget.value || "";
      pickerActiveIndex = 0;
      renderNodePickerList();
    });

    byId("workflowNodePicker")?.addEventListener("keydown", (event) => {
      if (!pickerOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeNodePicker();
        return;
      }
      const items = [...(byId("workflowNodePickerList")?.querySelectorAll("[data-picker-tool]") || [])];
      if (!items.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const dir = event.key === "ArrowDown" ? 1 : -1;
        pickerActiveIndex = (pickerActiveIndex + dir + items.length) % items.length;
        items.forEach((btn, idx) => {
          btn.classList.toggle("is-active", idx === pickerActiveIndex);
          btn.setAttribute("aria-selected", String(idx === pickerActiveIndex));
        });
        items[pickerActiveIndex]?.scrollIntoView?.({ block: "nearest" });
      } else if (event.key === "Enter" && event.target === byId("workflowNodeSearch")) {
        const chosen = items[pickerActiveIndex];
        if (chosen && !chosen.disabled) {
          event.preventDefault();
          chosen.click();
        }
      }
    });

    byId("closeInspectorBtn")?.addEventListener("click", () => {
      selectedStepId = "";
      syncInspectorVisibility();
    });
    byId("workflowInspectorBackdrop")?.addEventListener("click", () => {
      selectedStepId = "";
      syncInspectorVisibility();
    });

    byId("toggleWorkflowRunnerBtn")?.addEventListener("click", () => {
      setRunnerExpanded(!runnerExpanded, { scroll: !runnerExpanded });
    });
    byId("closeRunnerPanelBtn")?.addEventListener("click", () => setRunnerExpanded(false));

    byId("canvasZoomInBtn")?.addEventListener("click", () => setCanvasZoom(canvasViewport.zoom + 0.15));
    byId("canvasZoomOutBtn")?.addEventListener("click", () => setCanvasZoom(canvasViewport.zoom - 0.15));
    byId("canvasZoomResetBtn")?.addEventListener("click", () => setCanvasZoom(1));
    byId("canvasFitViewBtn")?.addEventListener("click", () => fitCanvasToView({ animate: true }));

    byId("workflowMoreMenuBtn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = byId("workflowEditorMoreMenu");
      const btn = event.currentTarget;
      if (!menu) return;
      const nextOpen = menu.classList.contains("hidden");
      menu.classList.toggle("hidden", !nextOpen);
      btn.setAttribute("aria-expanded", String(nextOpen));
      if (nextOpen) menu.querySelector('[role="menuitem"]')?.focus?.({ preventScroll: true });
    });

    if (typeof document !== "undefined") {
      document.addEventListener("pointerdown", (event) => {
        if (openRowMenuId && !event.target.closest(".wf-row-menu-wrap")) {
          openRowMenuId = "";
          renderWorkflowList();
        }
        const moreMenu = byId("workflowEditorMoreMenu");
        if (moreMenu && !moreMenu.classList.contains("hidden") && !event.target.closest(".wf-more-wrap")) {
          closeEditorMoreMenu();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          if (pointerDragState) {
            event.preventDefault();
            cancelActivePointerDrag(true);
            return;
          }
          if (openRowMenuId) { openRowMenuId = ""; renderWorkflowList(); }
          closeEditorMoreMenu();
          if (selectedStepId && viewMode === "editor" && !pickerOpen) {
            selectedStepId = "";
            syncInspectorVisibility();
          }
        }
      });
    }

    byId("workflowNameInput")?.addEventListener("input", () => {
      const workflow = selectedWorkflow();
      if (!workflow) return;
      workflow.name = byId("workflowNameInput").value.slice(0, 80);
      markWorkflowUpdated();
      renderWorkflowList();
    });

    byId("saveWorkflowBtn")?.addEventListener("click", () => saveCurrentWorkflow().catch((error) => setSaveMessage(error.message, true)));
    byId("duplicateWorkflowBtn")?.addEventListener("click", () => { closeEditorMoreMenu(); duplicateCurrentWorkflow(); });
    byId("deleteWorkflowBtn")?.addEventListener("click", () => { closeEditorMoreMenu(); void deleteCurrentWorkflow(); });
    byId("exportWorkflowBtn")?.addEventListener("click", () => {
      closeEditorMoreMenu();
      try { exportCurrentWorkflow(); } catch (error) { setSaveMessage(error.message, true); }
    });
    byId("importWorkflowBtn")?.addEventListener("click", () => byId("workflowImportInput").click());
    byId("workflowImportInput")?.addEventListener("change", async (event) => {
      const input = event.currentTarget;
      try {
        await withFeedback(byId("importWorkflowBtn"), "workflow-import", () =>
          importWorkflowFile(input.files?.[0]));
      } catch (error) {
        setSaveMessage(`导入失败：${error.message}`, true);
        setListFeedback(`导入失败：${error.message}`, true);
      } finally { input.value = ""; }
    });

    const fileInput = byId("workflowFileInput");
    const dropLabel = byId("workflowFileInputWrap");
    byId("workflowTextInput")?.addEventListener("input", (event) => {
      const workflow = selectedWorkflow();
      if (!workflow) return;
      getSessionState(workflow.id, workflow).textInput = event.currentTarget.value || "";
    });
    byId("workflowBatchToggle")?.addEventListener("change", (event) => {
      const workflow = selectedWorkflow();
      if (!workflow) return;
      const session = getSessionState(workflow.id, workflow);
      session.batchRequested = Boolean(event.currentTarget.checked);
      session.batchTouched = true;
    });
    fileInput?.addEventListener("change", () => {
      const mode = pendingFilePickerMode;
      pendingFilePickerMode = "replace";
      const workflow = selectedWorkflow();
      const picked = [...(fileInput.files || [])];
      if (!workflow || !picked.length) {
        renderSelectedFilesManifest();
        return;
      }
      handleIncomingWorkflowFiles(workflow, picked, { mode });
      try { fileInput.value = ""; } catch (_) {}
    });
    dropLabel?.addEventListener("click", () => {
      pendingFilePickerMode = "replace";
    });
    dropLabel?.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropLabel.dataset.dropState = "active";
      dropLabel.classList.add("is-dragover");
    });
    dropLabel?.addEventListener("dragleave", () => {
      delete dropLabel.dataset.dropState;
      dropLabel.classList.remove("is-dragover");
    });
    dropLabel?.addEventListener("drop", (event) => {
      event.preventDefault();
      delete dropLabel.dataset.dropState;
      dropLabel.classList.remove("is-dragover");
      const dropped = [...(event.dataTransfer?.files || [])];
      const workflow = selectedWorkflow();
      if (!dropped.length || !workflow) return;
      const policy = getWorkflowInputPolicy(workflow);
      const session = getSessionState(workflow.id, workflow);
      const mode = policy.multiple && session.queuedFiles.length > 0 ? "append" : "replace";
      handleIncomingWorkflowFiles(workflow, dropped, { mode });
    });

    byId("runWorkflowBtn")?.addEventListener("click", () => {
      const targetWf = selectedWorkflow();
      const targetSession = targetWf ? getSessionState(targetWf.id, targetWf) : null;
      runSelectedWorkflow().catch((error) => {
        if (targetSession) {
          targetSession.runState = { status: "failed", label: "失败", progressText: targetSession.runState?.progressText || "" };
        }
        if (!targetWf || selectedWorkflowId === targetWf.id) {
          if (byId("workflowRunState")) {
            byId("workflowRunState").textContent = "失败";
            byId("workflowRunState").dataset.status = "failed";
          }
          if (byId("workflowResultText")) byId("workflowResultText").value = error.message;
        }
        displayErrorOutput(error, targetSession);
      });
    });
    byId("cancelWorkflowBtn")?.addEventListener("click", () => currentActiveRun()?.controller.abort());
    byId("downloadWorkflowResultBtn")?.addEventListener("click", () => {
      const session = getSessionState();
      const target = session.downloadBundle || session.lastOutput;
      if (!target || !target.value) return;
      if (target.value instanceof Blob) {
        session.downloadDone = true;
        downloadBlob(target.name || "workflow-result", target.value);
      }
    });
    byId("copyWorkflowResultBtn")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const session = getSessionState();
      const copied = await bridge.copyText(byId("workflowResultText")?.value || "");
      if (!button) return;
      if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
      const prevTimer = Number(button.dataset.copyTimer || 0);
      if (prevTimer) root.clearTimeout(prevTimer);
      session.copyStatus = copied ? "已复制" : "复制失败";
      button.textContent = session.copyStatus;
      button.dataset.copyTimer = String(root.setTimeout(() => {
        delete button.dataset.copyTimer;
        session.copyStatus = "";
        if (button.isConnected && button.dataset.originalLabel) button.textContent = button.dataset.originalLabel;
      }, 1200));
    });

    bindCanvasInteractions();
  }

  root.WYJWorkflows = Object.freeze({
    // Read-only projection through this owner; no additional transport or run history.
    getSummary() {
      if(!account()?.id)return {known:false,recent:[]};
      try {const cache=JSON.parse(safeLocalGet(storageKey())||'{}');const recent=(Array.isArray(cache.workflows)?cache.workflows:[]).slice(0,MAX_WORKFLOWS).flatMap(value=>{try{const item=validateWorkflow(value);return [{id:item.id,name:item.name,updated_at:item.updated_at}];}catch(_){return [];}}).sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at));return {known:true,recent:recent.slice(0,3)};}catch(_){return {known:false,recent:[]};}
    },
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
      getWorkflowInputPolicy,
      validateInputFilesForPolicy,
      resourceFromFiles,
    }),
    test: Object.freeze({
      selectedWorkflow: () => selectedWorkflow() ? cloneJson(selectedWorkflow()) : null,
      workflows: () => cloneJson(workflows),
      lastOutput: () => currentLastOutput(),
      isRunning: () => Boolean(currentActiveRun()),
      runningSessions: () => [...activeRunsBySession.keys()],
      queuedFiles: () => (selectedWorkflowId ? getSessionState().queuedFiles.map((f) => ({ name: f.name, size: f.size, type: f.type })) : []),
      rejectedFiles: () => (selectedWorkflowId ? getSessionState().rejectedFiles.map((r) => ({ name: r.file.name, size: r.file.size, kind: r.kind, reason: r.reason })) : []),
      inputPolicy: () => (selectedWorkflow() ? getWorkflowInputPolicy(selectedWorkflow()) : null),
      viewMode: () => viewMode,
      selectedStepId: () => selectedStepId,
      viewport: () => ({ ...canvasViewport }),
      nodeOffsets: () => cloneJson(canvasNodeOffsets),
      selectStep: (stepId) => { selectedStepId = stepId; renderInspector(); },
      openWorkflow: (workflowId, options) => openWorkflowInEditor(workflowId, options),
      setViewMode: (mode) => setViewMode(mode),
    }),
  });
})();
