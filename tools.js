import {
  CATEGORY_DEFINITIONS,
  CATEGORY_MAP,
  TOOL_MAP,
  TOOLS,
  iconSvg,
  searchTools,
} from "./js/tools/catalog.js?v=20260829-task18-admin-messages";
import { randomToolResult } from "./js/tools/random.js?v=20260829-task18-admin-messages";
import { buildVcardPayload, buildWifiPayload } from "./js/tools/temporary.js?v=20260829-task18-admin-messages";
import { getOpenCcSource, loadOpenCcMaps, runTextOperation } from "./js/tools/text.js?v=20260829-task18-admin-messages";
import {
  csvString,
  decodeLocalText,
  digestFile,
  joinBytes,
  parseCsv,
  validateCsvTable,
  zipBlob,
} from "./js/tools/file.js?v=20260829-task18-admin-messages";
import {
  exifSummary,
  parseColorValue,
  rgbToHex,
  rgbToHsl,
  stripJpegMetadata,
} from "./js/tools/image.js?v=20260829-task18-admin-messages";
import { runToolRenderer } from "./js/tools/runner.js?v=20260829-task18-admin-messages";
(() => {
  "use strict";

  async function fetchStaticText(url, timeoutMs = 10000) {
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
    try {
      const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
      if (!response.ok) throw new Error(`${url} ${response.status}`);
      return await response.text();
    } finally {
      if (timeout) window.clearTimeout(timeout);
    }
  }

  let bridge = null;
  let preferences = { favorites: [], recent: [], configs: [] };
  let loadedPreferencesKey = "";
  let preferencesLoadedAt = 0;
  let preferencesLoadPromise = null;
  let currentCategory = "all";
  let currentTool = null;
  let currentDownload = null;
  let activeRoomPoller = null;
  let activeUploadController = null;
  const TEMP_FILE_MAX_BYTES = 20 * 1024 * 1024;
  const TEMP_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
  const TEMP_VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm"]);
  const ROOM_POLL_BASE_MS = 4000;
  const ROOM_POLL_MAX_MS = 30000;
  const TOOL_PREFERENCES_CACHE_VERSION = 1;
  const TOOL_PREFERENCES_TTL_MS = 30_000;

  const byId = (id) => document.getElementById(id);
  const categoryFor = (tool) => CATEGORY_MAP.get(tool.category);
  const favoriteFor = (toolId) => preferences.favorites.find((item) => item.tool_id === toolId);
  const configsFor = (toolId) => preferences.configs.filter((item) => item.tool_id === toolId);

  function normalizePreferences(value) {
    const source = value && typeof value === "object" ? value : {};
    const cleanItems = (items, limit) => Array.isArray(items)
      ? items.filter((item) => item && TOOL_MAP.has(String(item.tool_id || ""))).slice(0, limit)
      : [];
    return {
      favorites: cleanItems(source.favorites, 100),
      recent: cleanItems(source.recent, 50),
      configs: Array.isArray(source.configs) ? source.configs.slice(0, 200) : [],
    };
  }

  function preferencesCacheKey() {
    return `toolPreferences:v${TOOL_PREFERENCES_CACHE_VERSION}:${bridge?.accountId?.() || "guest"}`;
  }

  function readCachedPreferences() {
    try {
      return normalizePreferences(JSON.parse(localStorage.getItem(preferencesCacheKey()) || "{}"));
    } catch (_) {
      return { favorites: [], recent: [], configs: [] };
    }
  }

  function ensureAccountPreferences() {
    const key = preferencesCacheKey();
    if (loadedPreferencesKey === key) return;
    preferences = readCachedPreferences();
    loadedPreferencesKey = key;
    preferencesLoadedAt = 0;
    preferencesLoadPromise = null;
  }

  function persistPreferences() {
    try {
      localStorage.setItem(preferencesCacheKey(), JSON.stringify(preferences));
      loadedPreferencesKey = preferencesCacheKey();
    } catch (_) {
      // Private browsing can reject writes; the current page still keeps its in-memory copy.
    }
    bridge?.onPreferencesChanged?.();
  }

  function getSummary() {
    ensureAccountPreferences();
    const mapItems = (items) => items.map((item) => {
      const tool = TOOL_MAP.get(item.tool_id);
      return { ...item, name: tool?.name || item.tool_id };
    }).filter((item) => item.tool_id);
    return {
      favorites: mapItems(preferences.favorites),
      recent: mapItems(preferences.recent),
    };
  }

  function recordRecentLocally(toolId) {
    preferences.recent = [
      { tool_id: toolId, used_at: new Date().toISOString() },
      ...preferences.recent.filter((item) => item.tool_id !== toolId),
    ].slice(0, 50);
    persistPreferences();
    renderShelves();
  }

  function setMessage(message, error = false) {
    const target = byId("toolWorkbenchMessage");
    if (!target) return;
    target.textContent = message || "";
    target.classList.toggle("success", Boolean(message) && !error);
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    }[char]));
  }

  function downloadBlob(name, blob) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadText(name, text, type = "text/plain;charset=utf-8") {
    downloadBlob(name, new Blob([text], { type }));
  }

  async function copyText(value, button) {
    const copied = await bridge.copyText(String(value));
    const original = button.textContent;
    button.textContent = copied ? "已复制" : "复制失败";
    window.setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1200);
  }

  function renderCategories() {
    const target = byId("toolCategoryList");
    if (!target) return;
    target.innerHTML = CATEGORY_DEFINITIONS.map((category) => {
      const count = TOOLS.filter((tool) => tool.category === category.id).length;
      return `<button class="tool-category-card${currentCategory === category.id ? " active" : ""}" type="button" data-tool-category="${category.id}">
        <span class="tool-category-mark" aria-hidden="true">${iconSvg(category.id)}</span>
        <span><strong>${category.name}</strong><small>${category.description}</small><em>${count} 个工具</em></span>
      </button>`;
    }).join("");
    target.querySelectorAll("[data-tool-category]").forEach((button) => button.addEventListener("click", () => {
      currentCategory = currentCategory === button.dataset.toolCategory ? "all" : button.dataset.toolCategory;
      renderCategories();
      renderCatalog();
    }));
  }

  function visibleTools() {
    const query = byId("toolSearchInput")?.value || "";
    return searchTools(query, currentCategory);
  }

  function toolCard(tool) {
    const favorite = favoriteFor(tool.id);
    const category = categoryFor(tool);
    return `<article class="tool-card" data-tool-card="${tool.id}">
      <button class="tool-open" type="button" data-open-tool="${tool.id}"><span>${iconSvg(category.id)}</span><strong>${tool.name}</strong><small>${tool.description}</small><em>${category.name}</em></button>
      <button class="tool-card-favorite${favorite ? " active" : ""}" type="button" data-toggle-favorite="${tool.id}" aria-label="${favorite ? "取消收藏" : "收藏"}">${iconSvg("bookmark", "ui-icon bookmark-icon")}</button>
    </article>`;
  }

  function bindToolButtons(root = document) {
    root.querySelectorAll("[data-open-tool]").forEach((button) => button.addEventListener("click", () => openTool(button.dataset.openTool)));
    root.querySelectorAll("[data-toggle-favorite]").forEach((button) => button.addEventListener("click", () => toggleFavorite(button.dataset.toggleFavorite)));
  }

  function renderCatalog() {
    const tools = visibleTools();
    const target = byId("toolCatalog");
    if (!target) return;
    byId("toolCatalogTitle").textContent = currentCategory === "all" ? "全部工具" : CATEGORY_MAP.get(currentCategory).name;
    byId("toolResultCount").textContent = `${tools.length} 项`;
    target.innerHTML = tools.map(toolCard).join("") || '<p class="tool-empty">没有匹配的工具</p>';
    bindToolButtons(target);
  }

  function renderShelves() {
    const favoriteTools = preferences.favorites.map((item) => TOOL_MAP.get(item.tool_id)).filter(Boolean);
    const recentTools = preferences.recent.map((item) => TOOL_MAP.get(item.tool_id)).filter(Boolean);
    const favoriteSection = byId("favoriteToolsSection");
    const recentSection = byId("recentToolsSection");
    favoriteSection?.classList.toggle("hidden", !favoriteTools.length);
    recentSection?.classList.toggle("hidden", !recentTools.length);
    if (byId("favoriteToolsList")) {
      byId("favoriteToolsList").innerHTML = favoriteTools.map((tool) => `<button type="button" data-open-tool="${tool.id}">${favoriteFor(tool.id)?.pinned ? "已固定 · " : ""}${tool.name}</button>`).join("");
      bindToolButtons(byId("favoriteToolsList"));
    }
    if (byId("recentToolsList")) {
      byId("recentToolsList").innerHTML = recentTools.map((tool) => `<button type="button" data-open-tool="${tool.id}">${tool.name}</button>`).join("");
      bindToolButtons(byId("recentToolsList"));
    }
  }

  async function loadPreferences(options = {}) {
    ensureAccountPreferences();
    const key = preferencesCacheKey();
    const fresh = preferencesLoadedAt && Date.now() - preferencesLoadedAt < TOOL_PREFERENCES_TTL_MS;
    if (!options.force && fresh) {
      renderShelves();
      renderCatalog();
      return preferences;
    }
    if (preferencesLoadPromise?.key === key) {
      if (!options.force) return preferencesLoadPromise.promise;
      try { await preferencesLoadPromise.promise; } catch (_) { /* The forced refresh below is authoritative. */ }
    }
    const promise = (async () => {
      try {
        const data = await bridge.apiGet("/api/tools/preferences");
        if (preferencesCacheKey() !== key) return preferences;
        preferences = normalizePreferences(data);
        preferencesLoadedAt = Date.now();
        persistPreferences();
      } catch (error) {
        if (error.code === "membership_required" && !options.allowCached) throw error;
        if (preferencesCacheKey() === key) preferences = readCachedPreferences();
      }
      if (preferencesCacheKey() === key) {
        renderShelves();
        renderCatalog();
        bridge?.onPreferencesChanged?.();
      }
      return preferences;
    })();
    preferencesLoadPromise = { key, promise };
    try {
      return await promise;
    } finally {
      if (preferencesLoadPromise?.promise === promise) preferencesLoadPromise = null;
    }
  }

  async function toggleFavorite(toolId, forcePinned = null) {
    const existing = favoriteFor(toolId);
    const favorite = forcePinned !== null ? true : !existing;
    const pinned = forcePinned !== null ? forcePinned : Boolean(existing?.pinned);
    try {
      await bridge.api("/api/tools/favorite", { tool_id: toolId, favorite, pinned });
      await loadPreferences({ force: true });
      updateWorkbenchActions();
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  function updateWorkbenchActions() {
    if (!currentTool) return;
    const favorite = favoriteFor(currentTool.id);
    byId("favoriteToolBtn").textContent = favorite ? "取消收藏" : "收藏";
    byId("pinToolBtn").textContent = favorite?.pinned ? "取消固定" : "固定";
  }

  function renderConfigControls(toolId) {
    const configs = configsFor(toolId);
    return `<section class="tool-config-box">
      <div><input id="toolConfigName" maxlength="80" placeholder="配置名称" /><button id="saveToolConfigBtn" type="button">保存当前参数</button></div>
      <div class="saved-config-list" id="savedToolConfigList">${configs.map((item) => `<span><button type="button" data-load-config="${item.id}">${escapeHtml(item.name)}</button><button type="button" data-delete-config="${item.id}" aria-label="删除配置">${iconSvg("delete")}</button></span>`).join("") || "<small>暂无已保存配置</small>"}</div>
    </section>`;
  }

  function collectConfig() {
    const config = {};
    byId("toolWorkbenchBody").querySelectorAll("[data-config]").forEach((field) => {
      config[field.dataset.config] = field.type === "checkbox" ? field.checked : field.value;
    });
    return config;
  }

  function applyConfig(config) {
    Object.entries(config || {}).forEach(([key, value]) => {
      const escapedKey = window.CSS?.escape
        ? window.CSS.escape(key)
        : String(key).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0).toString(16)} `);
      const field = byId("toolWorkbenchBody").querySelector(`[data-config="${escapedKey}"]`);
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value;
      if (["qrKind", "qrDynamic", "qrWifiSecurity"].includes(field.id)) field.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function bindConfigControls() {
    byId("saveToolConfigBtn")?.addEventListener("click", async () => {
      const name = byId("toolConfigName").value.trim();
      if (!name) return setMessage("请输入配置名称", true);
      try {
        await bridge.api("/api/tools/config/save", { tool_id: currentTool.id, name, config: collectConfig() });
        await loadPreferences({ force: true });
        renderCurrentTool();
        setMessage("配置已保存");
      } catch (error) { setMessage(error.message, true); }
    });
    byId("savedToolConfigList")?.querySelectorAll("[data-load-config]").forEach((button) => button.addEventListener("click", () => {
      const item = preferences.configs.find((config) => config.id === button.dataset.loadConfig);
      applyConfig(item?.config || {});
      setMessage("配置已载入");
    }));
    byId("savedToolConfigList")?.querySelectorAll("[data-delete-config]").forEach((button) => button.addEventListener("click", async () => {
      try {
        await bridge.api("/api/tools/config/delete", { id: button.dataset.deleteConfig });
        await loadPreferences({ force: true });
        renderCurrentTool();
        setMessage("配置已删除");
      } catch (error) {
        setMessage(error.message, true);
      }
    }));
  }

  function textToolFields(toolId) {
    const secondaryTools = new Set(["find-replace", "regex-replace", "text-diff"]);
    const parameterLabels = {
      "line-prefix": "前缀", "line-suffix": "后缀", "line-numbers": "编号分隔符",
      "find-replace": "查找内容", "regex-replace": "正则表达式",
    };
    const options = {
      "letter-case": [["upper", "大写"], ["lower", "小写"], ["title", "标题格式"]],
      "regex-replace": [["g", "全局"], ["gi", "全局且忽略大小写"], ["gm", "全局多行"]],
      "sort-lines": [["asc", "升序"], ["desc", "降序"]],
      base64: [["encode", "编码"], ["decode", "解码"]], "url-code": [["encode", "编码"], ["decode", "解码"]],
      "html-entities": [["encode", "编码"], ["decode", "解码"]], "unicode-code": [["encode", "转义"], ["decode", "还原"]],
      "chinese-convert": [["traditional", "简体转繁体"], ["simple", "繁体转简体"]],
    };
    const optionHtml = options[toolId] ? `<label><span>模式</span><select id="textToolOption" data-config="option">${options[toolId].map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>` : "";
    const parameterHtml = parameterLabels[toolId] ? `<label><span>${parameterLabels[toolId]}</span><input id="textToolParameter" data-config="parameter" /></label>` : '<input id="textToolParameter" type="hidden" />';
    const secondaryHtml = secondaryTools.has(toolId) ? `<label class="tool-wide"><span>${toolId === "text-diff" ? "对比文本" : "替换为"}</span><textarea id="textToolSecondary" ${toolId === "text-diff" ? "" : "data-config=\"replacement\""}></textarea></label>` : '<textarea id="textToolSecondary" class="hidden"></textarea>';
    return { optionHtml, parameterHtml, secondaryHtml };
  }

  function renderTextTool(tool) {
    const { optionHtml, parameterHtml, secondaryHtml } = textToolFields(tool.id);
    byId("toolWorkbenchBody").innerHTML = `<div class="tool-form text-tool-form">
      <label class="tool-wide"><span>输入文本</span><textarea id="textToolInput" spellcheck="false"></textarea></label>
      ${secondaryHtml}<div class="tool-options">${parameterHtml}${optionHtml}</div>
      <div class="tool-command-row"><button class="primary" id="runTextToolBtn" type="button">处理</button><button id="copyTextToolBtn" type="button">复制结果</button><button id="downloadTextToolBtn" type="button">下载 TXT</button></div>
      <label class="tool-wide"><span>结果</span><textarea id="textToolOutput" readonly></textarea></label>
      ${renderConfigControls(tool.id)}
    </div>`;
    byId("runTextToolBtn").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        if (tool.id === "chinese-convert") {
          setMessage("正在加载本地简繁词典…");
          await loadOpenCcMaps(fetchStaticText);
        }
        const output = runTextOperation(tool.id, byId("textToolInput").value, byId("textToolSecondary").value, byId("textToolParameter").value, byId("textToolOption")?.value || "");
        byId("textToolOutput").value = output;
        setMessage(tool.id === "chinese-convert" && getOpenCcSource() !== "opencc" ? "官方词典不可用，已使用内置基础词典" : "处理完成");
      } catch (error) {
        setMessage(`处理失败：${error.message}`, true);
      } finally {
        button.disabled = false;
      }
    });
    byId("copyTextToolBtn").addEventListener("click", (event) => copyText(byId("textToolOutput").value, event.currentTarget));
    byId("downloadTextToolBtn").addEventListener("click", () => downloadText(`${tool.id}-${Date.now()}.txt`, byId("textToolOutput").value));
    bindConfigControls();
  }

  function renderRandomTool(tool) {
    const needsEntries = ["random-draw", "random-groups", "random-wheel", "weighted-wheel", "random-decision"].includes(tool.id);
    const numeric = ["random-integer", "random-decimal"].includes(tool.id);
    const strings = ["random-string", "random-password"].includes(tool.id);
    byId("toolWorkbenchBody").innerHTML = `<div class="tool-form random-tool-form">
      <div class="tool-options">
        ${numeric ? '<label><span>最小值</span><input data-config="minimum" id="randomMinimum" type="number" value="0" /></label><label><span>最大值</span><input data-config="maximum" id="randomMaximum" type="number" value="100" /></label>' : ""}
        ${tool.id === "random-decimal" ? '<label><span>小数位</span><input data-config="precision" id="randomPrecision" type="number" min="0" max="12" value="2" /></label>' : ""}
        ${numeric || tool.id === "random-uuid" || tool.id === "random-palette" ? '<label><span>数量</span><input data-config="count" id="randomCount" type="number" min="1" max="1000" value="1" /></label>' : ""}
        ${strings ? `<label><span>长度</span><input data-config="length" id="randomLength" type="number" min="1" max="4096" value="${tool.id === "random-password" ? 20 : 16}" /></label>` : ""}
        ${tool.id === "random-string" ? '<label class="tool-wide"><span>字符集</span><input data-config="alphabet" id="randomAlphabet" value="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" /></label>' : ""}
        ${tool.id === "random-password" ? '<label class="admin-checkbox"><input data-config="passwordUpper" id="passwordUpper" type="checkbox" checked /> 大写字母</label><label class="admin-checkbox"><input data-config="passwordLower" id="passwordLower" type="checkbox" checked /> 小写字母</label><label class="admin-checkbox"><input data-config="passwordDigits" id="passwordDigits" type="checkbox" checked /> 数字</label><label class="admin-checkbox"><input data-config="passwordSymbols" id="passwordSymbols" type="checkbox" checked /> 符号</label>' : ""}
        ${tool.id === "random-groups" ? '<label><span>组数</span><input data-config="groups" id="randomGroups" type="number" min="1" value="2" /></label>' : ""}
        ${tool.id === "custom-dice" ? '<label><span>骰子面数</span><input data-config="sides" id="randomSides" type="number" min="2" value="6" /></label>' : ""}
        ${tool.id === "random-date" ? '<label><span>开始日期</span><input data-config="startDate" id="randomStartDate" type="date" value="2000-01-01" /></label><label><span>结束日期</span><input data-config="endDate" id="randomEndDate" type="date" /></label>' : ""}
      </div>
      ${needsEntries ? `<label class="tool-wide"><span>${tool.id === "weighted-wheel" ? "选项（每行：名称|权重）" : "选项（每行一个）"}</span><textarea data-config="entries" id="randomEntries"></textarea></label>` : ""}
      <div class="tool-command-row"><button class="primary" id="runRandomToolBtn" type="button">生成</button><button id="copyRandomResultBtn" type="button">复制结果</button></div>
      <output class="random-result" id="randomResult">等待生成</output>
      ${renderConfigControls(tool.id)}
    </div>`;
    if (byId("randomEndDate")) byId("randomEndDate").value = new Date().toISOString().slice(0, 10);
    byId("runRandomToolBtn").addEventListener("click", () => {
      try {
        const values = {
          minimum: byId("randomMinimum")?.value, maximum: byId("randomMaximum")?.value,
          precision: byId("randomPrecision")?.value, count: byId("randomCount")?.value,
          length: byId("randomLength")?.value, alphabet: byId("randomAlphabet")?.value,
          groups: byId("randomGroups")?.value, sides: byId("randomSides")?.value,
          startDate: byId("randomStartDate")?.value, endDate: byId("randomEndDate")?.value,
          entries: byId("randomEntries")?.value,
          passwordUpper: byId("passwordUpper")?.checked, passwordLower: byId("passwordLower")?.checked,
          passwordDigits: byId("passwordDigits")?.checked, passwordSymbols: byId("passwordSymbols")?.checked,
        };
        const result = randomToolResult(tool.id, values);
        byId("randomResult").textContent = result;
        setMessage(tool.id === "random-password" ? "密码只在本机生成，未上传服务器" : "生成完成");
      } catch (error) { setMessage(error.message, true); }
    });
    byId("copyRandomResultBtn").addEventListener("click", (event) => copyText(byId("randomResult").textContent, event.currentTarget));
    bindConfigControls();
  }

  function renderCurrentTool() {
    stopRoomPolling();
    cancelActiveUpload(false);
    if (!currentTool) return;
    byId("toolWorkbenchCategory").textContent = categoryFor(currentTool).name;
    byId("toolWorkbenchTitle").textContent = currentTool.name;
    byId("toolWorkbenchDescription").textContent = currentTool.description;
    setMessage("");
    runToolRenderer(currentTool, {
      text: renderTextTool,
      random: renderRandomTool,
      file: renderFileTool,
      image: renderImageTool,
      temporary: renderTemporaryTool,
    });
    updateWorkbenchActions();
  }

  async function openTool(toolId, pushRoute = true) {
    const tool = TOOL_MAP.get(toolId);
    if (!tool) return;
    window.WYJWorkflows?.hide?.({ cancel: true });
    currentTool = tool;
    byId("toolsDashboard").classList.add("hidden");
    byId("toolWorkbench").classList.remove("hidden");
    byId("toolWorkbench").setAttribute("aria-hidden", "false");
    renderCurrentTool();
    if (pushRoute) bridge.navigate(`/tools/${tool.id}`);
    recordRecentLocally(tool.id);
    bridge.api("/api/tools/recent", { tool_id: tool.id }).catch(() => {});
  }

  function closeWorkbench(pushRoute = true) {
    stopRoomPolling();
    cancelActiveUpload(false);
    currentTool = null;
    currentDownload = null;
    byId("toolWorkbench").classList.add("hidden");
    byId("toolWorkbench").setAttribute("aria-hidden", "true");
    byId("toolsDashboard").classList.remove("hidden");
    if (pushRoute) bridge.navigate("/tools");
  }

  async function show(path = "/tools", options = {}) {
    const access = options.access || (options.offline ? null : await bridge.apiGet("/api/tools/access"));
    const account = access?.account || bridge.account?.() || {};
    const summary = account.membership_summary || {};
    const membershipText = summary.permanent ? `${summary.name} · 永久有效` : `${summary.name || "工具箱会员"}${summary.expires_at ? ` · 到期 ${bridge.formatDate(summary.expires_at)}` : ""}`;
    byId("toolsMembershipStatus").textContent = options.offline ? `${membershipText} · 离线本地模式` : membershipText;
    byId("toolsPanel").classList.remove("hidden");
    byId("toolsPanel").setAttribute("aria-hidden", "false");
    window.WYJWorkflows?.setAccess?.(options);
    if (window.WYJWorkflows?.matches?.(path)) {
      byId("toolsDashboard").classList.add("hidden");
      byId("toolWorkbench").classList.add("hidden");
      byId("toolWorkbench").setAttribute("aria-hidden", "true");
      await window.WYJWorkflows.show(path, options);
      return;
    }
    window.WYJWorkflows?.hide?.({ cancel: true });
    renderCategories();
    renderCatalog();
    if (options.offline) {
      preferences = readCachedPreferences();
      renderShelves();
      renderCatalog();
      bridge?.onPreferencesChanged?.();
    } else {
      await loadPreferences({ allowCached: true });
    }
    const match = path.match(/^\/tools\/([a-z0-9_-]+)$/);
    if (match && TOOL_MAP.has(match[1])) await openTool(match[1], false);
    else closeWorkbench(false);
  }

  function hide() {
    stopRoomPolling();
    cancelActiveUpload(false);
    window.WYJWorkflows?.hide?.({ cancel: true });
    byId("toolsPanel")?.classList.add("hidden");
    byId("toolsPanel")?.setAttribute("aria-hidden", "true");
  }

  function init(context) {
    bridge = context;
    ensureAccountPreferences();
    renderCategories();
    renderCatalog();
    bridge?.onPreferencesChanged?.();
    byId("toolSearchInput")?.addEventListener("input", () => { currentCategory = "all"; renderCategories(); renderCatalog(); });
    byId("closeToolWorkbenchBtn")?.addEventListener("click", () => closeWorkbench(true));
    byId("favoriteToolBtn")?.addEventListener("click", () => currentTool && toggleFavorite(currentTool.id));
    byId("pinToolBtn")?.addEventListener("click", () => currentTool && toggleFavorite(currentTool.id, !Boolean(favoriteFor(currentTool.id)?.pinned)));
    byId("clearToolHistoryBtn")?.addEventListener("click", async () => {
      try {
        await bridge.api("/api/tools/history/clear", {});
        await loadPreferences({ force: true });
        setMessage("最近使用记录已清除");
      } catch (error) {
        setMessage(error.message, true);
      }
    });
    window.WYJWorkflows?.init?.(context);
  }

  window.WYJTools = { init, show, hide, openTool, closeWorkbench, searchTools, getSummary, tools: TOOLS, test: { buildWifiPayload, buildVcardPayload } };

  function pdfBytesFromJpegs(images) {
    const encoder = new TextEncoder();
    const objectCount = 2 + images.length * 3;
    const pageIds = images.map((_, index) => 3 + index * 3);
    const objects = new Map();
    objects.set(1, encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"));
    objects.set(2, encoder.encode(`<< /Type /Pages /Count ${images.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`));
    images.forEach((image, index) => {
      const pageId = 3 + index * 3;
      const imageId = pageId + 1;
      const contentId = pageId + 2;
      const pageWidth = 595;
      const pageHeight = 842;
      const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
      const width = Math.round(image.width * scale * 100) / 100;
      const height = Math.round(image.height * scale * 100) / 100;
      const x = Math.round((pageWidth - width) / 2 * 100) / 100;
      const y = Math.round((pageHeight - height) / 2 * 100) / 100;
      const commands = encoder.encode(`q ${width} 0 0 ${height} ${x} ${y} cm /Im${index + 1} Do Q`);
      objects.set(pageId, encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im${index + 1} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
      objects.set(imageId, joinBytes([encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`), image.bytes, encoder.encode("\nendstream")]));
      objects.set(contentId, joinBytes([encoder.encode(`<< /Length ${commands.length} >>\nstream\n`), commands, encoder.encode("\nendstream")]));
    });
    const parts = [encoder.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
    const offsets = [0];
    let offset = parts[0].length;
    for (let id = 1; id <= objectCount; id += 1) {
      offsets[id] = offset;
      const part = joinBytes([encoder.encode(`${id} 0 obj\n`), objects.get(id), encoder.encode("\nendobj\n")]);
      parts.push(part);
      offset += part.length;
    }
    const xrefOffset = offset;
    let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= objectCount; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    parts.push(encoder.encode(xref));
    return joinBytes(parts);
  }

  async function fileToJpeg(file) {
    const bitmap = await bitmapFromFile(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    releaseBitmap(bitmap);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("图片转换失败")), "image/jpeg", 0.9));
    return { width: canvas.width, height: canvas.height, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }

  async function readLocalFiles(input, maximumFiles = 50, maximumBytes = 50 * 1024 * 1024) {
    const files = [...(input.files || [])];
    if (!files.length) throw new Error("请选择文件");
    if (files.length > maximumFiles) throw new Error(`每次最多处理 ${maximumFiles} 个文件`);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > maximumBytes) throw new Error(`文件总大小不能超过 ${formatBytes(maximumBytes)}`);
    return files;
  }

  async function processFileTool(tool, files, parameter, encoding) {
    if (tool.id.startsWith("file-sha") || tool.id === "file-md5") {
      const algorithm = { "file-md5": "MD5", "file-sha1": "SHA-1", "file-sha256": "SHA-256", "file-sha512": "SHA-512" }[tool.id];
      return { text: (await Promise.all(files.map(async (file) => `${await digestFile(file, algorithm)}  ${file.name}`))).join("\n") };
    }
    if (tool.id === "file-info") return { text: files.map((file) => `${file.name}\n类型：${file.type || "未知"}\n大小：${formatBytes(file.size)}\n最后修改：${new Date(file.lastModified).toLocaleString("zh-CN")}`).join("\n\n") };
    if (tool.id === "images-pdf") {
      const images = await Promise.all(files.map(fileToJpeg));
      return { blob: new Blob([pdfBytesFromJpegs(images)], { type: "application/pdf" }), name: `images-${Date.now()}.pdf`, text: `已生成 ${images.length} 页 PDF` };
    }
    if (["files-zip", "batch-zip"].includes(tool.id)) {
      const entries = await Promise.all(files.map(async (file) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) })));
      return { blob: zipBlob(entries), name: `files-${Date.now()}.zip`, text: `已打包 ${files.length} 个文件` };
    }
    if (tool.id === "rename-preview") {
      const prefix = parameter || "file";
      return { text: files.map((file, index) => `${file.name}  →  ${prefix}-${String(index + 1).padStart(3, "0")}${file.name.includes(".") ? `.${file.name.split(".").pop()}` : ""}`).join("\n") };
    }
    if (["txt-merge", "csv-merge", "json-array-merge"].includes(tool.id)) {
      const texts = await Promise.all(files.map((file) => decodeLocalText(file, encoding)));
      if (tool.id === "txt-merge") {
        const output = texts.reduce((merged, text, index) => {
          const separator = index > 0 && merged && text && !merged.endsWith("\n") && !text.startsWith("\n") ? "\n" : "";
          return `${merged}${separator}${text}`;
        }, "");
        return { text: output, blob: new Blob([output], { type: "text/plain;charset=utf-8" }), name: `merged-${Date.now()}.txt` };
      }
      if (tool.id === "csv-merge") {
        const tables = texts.map((text, index) => validateCsvTable(parseCsv(text), files[index].name));
        const header = tables[0][0].map((cell) => String(cell).trim());
        const mismatch = tables.findIndex((table) => table[0].length !== header.length || table[0].some((cell, index) => String(cell).trim() !== header[index]));
        if (mismatch >= 0) throw new Error(`${files[mismatch].name} 的表头与第一个 CSV 文件不一致`);
        const merged = [tables[0][0], ...tables.flatMap((table) => table.slice(1))];
        const output = csvString(merged);
        return { text: output, blob: new Blob(["\ufeff", output], { type: "text/csv;charset=utf-8" }), name: `merged-${Date.now()}.csv` };
      }
      const output = JSON.stringify(texts.flatMap((text) => { const value = JSON.parse(text); if (!Array.isArray(value)) throw new Error("每个 JSON 文件根节点必须是数组"); return value; }), null, 2);
      return { text: output, blob: new Blob([output], { type: "application/json" }), name: `merged-${Date.now()}.json` };
    }
    const file = files[0];
    const text = await decodeLocalText(file, encoding);
    if (tool.id === "csv-json") {
      const rows = validateCsvTable(parseCsv(text), file.name); const headers = rows.shift() || [];
      const names = headers.map((header, index) => String(header).trim() || `column_${index + 1}`);
      if (new Set(names).size !== names.length) throw new Error("CSV 表头存在重复字段，请先重命名后再转换");
      const output = JSON.stringify(rows.map((row) => Object.fromEntries(names.map((header, index) => [header, row[index] ?? ""]))), null, 2);
      return { text: output, blob: new Blob([output], { type: "application/json" }), name: `${file.name.replace(/\.[^.]+$/, "")}.json` };
    }
    if (tool.id === "json-csv") {
      const parsed = JSON.parse(text); if (!Array.isArray(parsed)) throw new Error("JSON 根节点必须是数组");
      if (parsed.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new Error("JSON 数组中的每一项都必须是对象");
      const headers = [...new Set(parsed.flatMap((item) => Object.keys(item)))];
      if (parsed.length && !headers.length) throw new Error("JSON 对象没有可转换的字段");
      const output = csvString([headers, ...parsed.map((item) => headers.map((header) => item?.[header] ?? ""))]);
      return { text: output, blob: new Blob(["\ufeff", output], { type: "text/csv;charset=utf-8" }), name: `${file.name.replace(/\.[^.]+$/, "")}.csv` };
    }
    if (tool.id === "text-encoding") return { text, blob: new Blob([text], { type: "text/plain;charset=utf-8" }), name: `${file.name.replace(/\.[^.]+$/, "")}-utf8.txt` };
    if (["text-split", "csv-split"].includes(tool.id)) {
      const size = Math.max(1, Math.min(100000, Number(parameter || 1000)));
      const entries = [];
      if (tool.id === "csv-split") {
        const rows = validateCsvTable(parseCsv(text), file.name);
        const header = rows.shift();
        for (let index = 0; index < rows.length; index += size) {
          const output = csvString([header, ...rows.slice(index, index + size)]);
          entries.push({ name: `part-${String(entries.length + 1).padStart(3, "0")}.csv`, data: new TextEncoder().encode(`\ufeff${output}`) });
        }
      } else {
        const lines = text ? text.replace(/\r\n?/g, "\n").split("\n") : [];
        if (lines[lines.length - 1] === "") lines.pop();
        for (let index = 0; index < lines.length; index += size) {
          entries.push({ name: `part-${String(entries.length + 1).padStart(3, "0")}.txt`, data: new TextEncoder().encode(lines.slice(index, index + size).join("\n")) });
        }
      }
      if (!entries.length) throw new Error("没有可拆分的数据行");
      return { text: `已拆分为 ${entries.length} 个文件`, blob: zipBlob(entries), name: `split-${Date.now()}.zip` };
    }
    throw new Error("暂不支持该文件操作");
  }

  function renderFileTool(tool) {
    const multiple = !["csv-json", "json-csv", "text-encoding", "text-split", "csv-split"].includes(tool.id);
    const acceptsImages = tool.id === "images-pdf";
    const parameterLabel = ["text-split", "csv-split"].includes(tool.id) ? "每份数据行数" : tool.id === "rename-preview" ? "新文件名前缀" : "参数";
    byId("toolWorkbenchBody").innerHTML = `<div class="tool-form file-tool-form">
      <label class="file-drop"><span>选择${multiple ? "一个或多个" : "一个"}文件</span><input id="fileToolInput" type="file" ${multiple ? "multiple" : ""} ${acceptsImages ? 'accept="image/*"' : ""} /></label>
      <p class="local-processing-note">文件默认只在本地浏览器中处理，不会上传服务器。单次最多 50 个文件、总计 50 MB。</p>
      <div class="tool-options">
        ${["text-split", "csv-split", "rename-preview"].includes(tool.id) ? `<label><span>${parameterLabel}</span><input id="fileToolParameter" data-config="parameter" value="${tool.id === "rename-preview" ? "file" : "1000"}" /></label>` : '<input id="fileToolParameter" type="hidden" />'}
        ${["csv-json", "json-csv", "text-encoding", "text-split", "csv-split", "txt-merge", "csv-merge", "json-array-merge"].includes(tool.id) ? '<label><span>源文本编码</span><select id="fileToolEncoding" data-config="encoding"><option value="utf-8">UTF-8</option><option value="gbk">GBK</option><option value="big5">Big5</option><option value="shift_jis">Shift-JIS</option></select></label>' : '<select id="fileToolEncoding" class="hidden"><option value="utf-8"></option></select>'}
      </div>
      <div class="tool-command-row"><button class="primary" id="runFileToolBtn" type="button">开始处理</button><button id="downloadFileToolBtn" type="button" disabled>下载结果</button><button id="copyFileToolBtn" type="button">复制文本结果</button></div>
      <pre class="file-result" id="fileToolResult">等待处理</pre>
      ${renderConfigControls(tool.id)}
    </div>`;
    currentDownload = null;
    byId("runFileToolBtn").addEventListener("click", async () => {
      const button = byId("runFileToolBtn"); button.disabled = true; setMessage("正在处理…");
      try {
        const files = await readLocalFiles(byId("fileToolInput"));
        const result = await processFileTool(tool, files, byId("fileToolParameter").value, byId("fileToolEncoding").value);
        byId("fileToolResult").textContent = result.text || "处理完成";
        currentDownload = result.blob ? { blob: result.blob, name: result.name } : null;
        byId("downloadFileToolBtn").disabled = !currentDownload;
        setMessage("本地处理完成");
      } catch (error) { setMessage(error.message, true); }
      finally { button.disabled = false; }
    });
    byId("downloadFileToolBtn").addEventListener("click", () => currentDownload && downloadBlob(currentDownload.name, currentDownload.blob));
    byId("copyFileToolBtn").addEventListener("click", (event) => copyText(byId("fileToolResult").textContent, event.currentTarget));
    bindConfigControls();
  }

  function canvasBlob(canvas, type = "image/png", quality = 0.88) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("浏览器无法生成该图片格式")), type, quality));
  }

  function releaseBitmap(bitmap) {
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  }

  async function bitmapFromFile(file) {
    if (!file.type.startsWith("image/")) throw new Error(`${file.name} 不是受支持的图片`);
    if (typeof createImageBitmap === "function") {
      try { return await createImageBitmap(file); } catch (_error) { /* Use the image element fallback below. */ }
    }
    return new Promise((resolve, reject) => {
      const source = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(source); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(source); reject(new Error(`${file.name} 无法解码`)); };
      image.src = source;
    });
  }

  function roundedPath(context, x, y, width, height, radius) {
    const safe = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + safe, y);
    context.arcTo(x + width, y, x + width, y + height, safe);
    context.arcTo(x + width, y + height, x, y + height, safe);
    context.arcTo(x, y + height, x, y, safe);
    context.arcTo(x, y, x + width, y, safe);
    context.closePath();
  }

  function imageControlValues() {
    const value = (id, fallback = "") => byId(id)?.value ?? fallback;
    return {
      width: Number(value("imageWidth", 0)), height: Number(value("imageHeight", 0)), scale: Number(value("imageScale", 100)),
      quality: Number(value("imageQuality", 85)) / 100, format: value("imageFormat", "image/png"), angle: Number(value("imageAngle", 90)),
      flip: value("imageFlip", "horizontal"),
      radius: Number(value("imageRadius", 32)), text: value("imageWatermarkText", "WYJ"), color: value("imageColorText", value("imageColor", "#7ed8ff")),
      background: value("imageBackground", "#07111f"), x: Number(value("imageRegionX", 25)), y: Number(value("imageRegionY", 25)),
      regionWidth: Number(value("imageRegionWidth", 50)), regionHeight: Number(value("imageRegionHeight", 30)), blur: Number(value("imageBlur", 8)),
      gradientEnd: value("imageGradientEnd", "#246da8"), gradientAngle: Number(value("imageGradientAngle", 135)),
    };
  }

  async function imageCanvas(toolId, bitmap, values, overlayBitmap = null) {
    let sourceX = 0; let sourceY = 0; let sourceWidth = bitmap.width; let sourceHeight = bitmap.height;
    let width = bitmap.width; let height = bitmap.height;
    const ratioMap = { "crop-square": 1, "crop-four-three": 4 / 3, "crop-sixteen-nine": 16 / 9 };
    if (toolId === "image-resize") { width = Math.max(1, Math.round(values.width || bitmap.width)); height = Math.max(1, Math.round(values.height || bitmap.height)); }
    if (toolId === "image-scale") { width = Math.max(1, Math.round(bitmap.width * values.scale / 100)); height = Math.max(1, Math.round(bitmap.height * values.scale / 100)); }
    if (ratioMap[toolId]) {
      const ratio = ratioMap[toolId];
      if (bitmap.width / bitmap.height > ratio) { sourceWidth = bitmap.height * ratio; sourceX = (bitmap.width - sourceWidth) / 2; }
      else { sourceHeight = bitmap.width / ratio; sourceY = (bitmap.height - sourceHeight) / 2; }
      width = Math.round(sourceWidth); height = Math.round(sourceHeight);
    }
    if (toolId === "image-crop") {
      sourceX = bitmap.width * values.x / 100; sourceY = bitmap.height * values.y / 100;
      sourceWidth = bitmap.width * values.regionWidth / 100; sourceHeight = bitmap.height * values.regionHeight / 100;
      width = Math.max(1, Math.round(sourceWidth)); height = Math.max(1, Math.round(sourceHeight));
    }
    const rotation = toolId === "image-rotate" ? ((values.angle % 360) + 360) % 360 : 0;
    if (rotation === 90 || rotation === 270) [width, height] = [height, width];
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"); context.imageSmoothingQuality = "high";
    if (["image-format", "image-compress"].includes(toolId) && values.format === "image/jpeg") { context.fillStyle = values.background; context.fillRect(0, 0, width, height); }
    context.save();
    if (rotation) { context.translate(width / 2, height / 2); context.rotate(rotation * Math.PI / 180); context.translate(-(rotation === 90 || rotation === 270 ? height : width) / 2, -(rotation === 90 || rotation === 270 ? width : height) / 2); }
    if (toolId === "image-flip") {
      if (values.flip === "vertical") { context.translate(0, height); context.scale(1, -1); }
      else if (values.flip === "both") { context.translate(width, height); context.scale(-1, -1); }
      else { context.translate(width, 0); context.scale(-1, 1); }
    }
    if (toolId === "image-rounded") { roundedPath(context, 0, 0, width, height, values.radius); context.clip(); }
    if (toolId === "image-avatar") { context.beginPath(); context.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2); context.clip(); }
    if (toolId === "image-blur") context.filter = `blur(${Math.max(0, Math.min(40, values.blur))}px)`;
    const drawWidth = rotation === 90 || rotation === 270 ? height : width;
    const drawHeight = rotation === 90 || rotation === 270 ? width : height;
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, drawWidth, drawHeight);
    context.restore();
    if (["text-watermark", "tile-watermark"].includes(toolId)) {
      context.save(); context.fillStyle = values.color; context.globalAlpha = 0.55; context.font = `600 ${Math.max(16, Math.round(Math.min(width, height) / 18))}px sans-serif`;
      if (toolId === "tile-watermark") {
        context.rotate(-20 * Math.PI / 180);
        for (let y = -height; y < height * 2; y += 120) for (let x = -width; x < width * 2; x += 220) context.fillText(values.text, x, y);
      } else { context.textAlign = "right"; context.textBaseline = "bottom"; context.fillText(values.text, width - 24, height - 20); }
      context.restore();
    }
    if (toolId === "image-watermark" && overlayBitmap) {
      const targetWidth = width * 0.24; const targetHeight = overlayBitmap.height * targetWidth / overlayBitmap.width;
      context.save(); context.globalAlpha = 0.75; context.drawImage(overlayBitmap, width - targetWidth - 20, height - targetHeight - 20, targetWidth, targetHeight); context.restore();
    }
    if (["image-mosaic", "image-redact"].includes(toolId)) {
      const x = Math.round(width * values.x / 100); const y = Math.round(height * values.y / 100);
      const regionWidth = Math.max(1, Math.round(width * values.regionWidth / 100)); const regionHeight = Math.max(1, Math.round(height * values.regionHeight / 100));
      if (toolId === "image-redact") { context.fillStyle = "#000"; context.fillRect(x, y, regionWidth, regionHeight); }
      else {
        const small = document.createElement("canvas"); small.width = Math.max(1, Math.round(regionWidth / 14)); small.height = Math.max(1, Math.round(regionHeight / 14));
        small.getContext("2d").drawImage(canvas, x, y, regionWidth, regionHeight, 0, 0, small.width, small.height);
        context.imageSmoothingEnabled = false; context.drawImage(small, 0, 0, small.width, small.height, x, y, regionWidth, regionHeight); context.imageSmoothingEnabled = true;
      }
    }
    return canvas;
  }

  function extractColors(canvas, count = 8) {
    const context = canvas.getContext("2d");
    const sample = document.createElement("canvas"); sample.width = 80; sample.height = 80;
    sample.getContext("2d").drawImage(canvas, 0, 0, 80, 80);
    const data = sample.getContext("2d").getImageData(0, 0, 80, 80).data;
    const colors = new Map();
    for (let index = 0; index < data.length; index += 16) {
      if (data[index + 3] < 128) continue;
      const rgb = [data[index], data[index + 1], data[index + 2]].map((value) => Math.round(value / 32) * 32).map((value) => Math.min(255, value));
      const key = rgb.join(","); colors.set(key, (colors.get(key) || 0) + 1);
    }
    return [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([key]) => `#${key.split(",").map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`);
  }

  function imageFields(toolId) {
    const fields = [];
    if (toolId === "image-resize") fields.push('<label><span>宽度</span><input id="imageWidth" data-config="width" type="number" min="1" value="1200" /></label><label><span>高度</span><input id="imageHeight" data-config="height" type="number" min="1" value="800" /></label>');
    if (toolId === "image-scale") fields.push('<label><span>缩放百分比</span><input id="imageScale" data-config="scale" type="number" min="1" max="1000" value="50" /></label>');
    if (["image-compress", "image-batch-compress", "image-format"].includes(toolId)) fields.push('<label><span>格式</span><select id="imageFormat" data-config="format"><option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></label><label><span>质量</span><input id="imageQuality" data-config="quality" type="number" min="10" max="100" value="85" /></label>');
    if (toolId === "image-rotate") fields.push('<label><span>旋转角度</span><select id="imageAngle" data-config="angle"><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>');
    if (toolId === "image-flip") fields.push('<label><span>翻转方向</span><select id="imageFlip" data-config="flip"><option value="horizontal">水平翻转</option><option value="vertical">垂直翻转</option><option value="both">水平并垂直</option></select></label>');
    if (toolId === "image-rounded") fields.push('<label><span>圆角半径</span><input id="imageRadius" data-config="radius" type="number" min="0" value="32" /></label>');
    if (["text-watermark", "tile-watermark"].includes(toolId)) fields.push('<label><span>水印文字</span><input id="imageWatermarkText" data-config="text" value="WYJ" /></label><label><span>水印颜色</span><input id="imageColor" data-config="color" type="color" value="#7ed8ff" /></label>');
    if (["image-crop", "image-mosaic", "image-redact"].includes(toolId)) fields.push('<label><span>左侧 %</span><input id="imageRegionX" data-config="x" type="number" min="0" max="100" value="25" /></label><label><span>顶部 %</span><input id="imageRegionY" data-config="y" type="number" min="0" max="100" value="25" /></label><label><span>宽度 %</span><input id="imageRegionWidth" data-config="regionWidth" type="number" min="1" max="100" value="50" /></label><label><span>高度 %</span><input id="imageRegionHeight" data-config="regionHeight" type="number" min="1" max="100" value="30" /></label>');
    if (toolId === "image-blur") fields.push('<label><span>模糊半径</span><input id="imageBlur" data-config="blur" type="number" min="0" max="40" value="8" /></label>');
    if (["gradient-generator", "gradient-css"].includes(toolId)) fields.push('<label><span>起始色</span><input id="imageColor" data-config="color" type="color" value="#07111f" /></label><label><span>结束色</span><input id="imageGradientEnd" data-config="gradientEnd" type="color" value="#246da8" /></label><label><span>角度</span><input id="imageGradientAngle" data-config="gradientAngle" type="number" value="135" /></label>');
    if (toolId === "color-convert") fields.push('<label class="tool-wide"><span>HEX、RGB 或 HSL</span><input id="imageColorText" data-config="color" value="#246da8" placeholder="#246da8 / rgb(36,109,168) / hsl(204,65%,40%)" /></label>');
    if (toolId === "solid-image") fields.push('<label><span>颜色</span><input id="imageColor" data-config="color" type="color" value="#246da8" /></label>');
    if (["solid-image", "gradient-generator"].includes(toolId)) fields.push('<label><span>宽度</span><input id="imageWidth" data-config="width" type="number" min="1" value="1200" /></label><label><span>高度</span><input id="imageHeight" data-config="height" type="number" min="1" value="630" /></label>');
    return fields.join("");
  }

  async function processImageTool(tool, files, overlayFile) {
    const values = imageControlValues();
    if (tool.id === "color-convert") {
      const [red, green, blue] = parseColorValue(values.color); const [hue, saturation, light] = rgbToHsl(red, green, blue);
      const hex = rgbToHex(red, green, blue).toUpperCase();
      const canvas = document.createElement("canvas"); canvas.width = 480; canvas.height = 180;
      const context = canvas.getContext("2d"); context.fillStyle = hex; context.fillRect(0, 0, canvas.width, canvas.height);
      return { text: `${hex}\nRGB(${red}, ${green}, ${blue})\nHSL(${hue}, ${saturation}%, ${light}%)`, canvas };
    }
    if (["gradient-generator", "gradient-css", "solid-image"].includes(tool.id)) {
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.min(4096, values.width || 1200)); canvas.height = Math.max(1, Math.min(4096, values.height || 630));
      const context = canvas.getContext("2d");
      if (tool.id === "solid-image") context.fillStyle = values.color;
      else {
        const angle = values.gradientAngle * Math.PI / 180; const x = Math.cos(angle); const y = Math.sin(angle);
        const gradient = context.createLinearGradient(canvas.width * (0.5 - x / 2), canvas.height * (0.5 - y / 2), canvas.width * (0.5 + x / 2), canvas.height * (0.5 + y / 2));
        gradient.addColorStop(0, values.color); gradient.addColorStop(1, values.gradientEnd); context.fillStyle = gradient;
      }
      context.fillRect(0, 0, canvas.width, canvas.height);
      const code = tool.id === "solid-image" ? `background: ${values.color};` : `background: linear-gradient(${values.gradientAngle}deg, ${values.color}, ${values.gradientEnd});`;
      if (tool.id === "gradient-css") return { text: code, canvas };
      return { text: code, canvas, blob: await canvasBlob(canvas), name: `${tool.id}-${Date.now()}.png` };
    }
    if (!files.length) throw new Error("请选择图片");
    if (tool.id === "image-pdf") {
      const images = await Promise.all(files.map(fileToJpeg));
      return { text: `已生成 ${images.length} 页 PDF`, blob: new Blob([pdfBytesFromJpegs(images)], { type: "application/pdf" }), name: `image-${Date.now()}.pdf` };
    }
    if (["exif-view", "gps-warning"].includes(tool.id)) return { text: exifSummary(new Uint8Array(await files[0].arrayBuffer())) };
    const batch = ["image-batch-compress"].includes(tool.id);
    const sourceFiles = batch ? files : [files[0]];
    const overlay = overlayFile ? await bitmapFromFile(overlayFile) : null;
    const outputs = [];
    let previewCanvas = null;
    for (const file of sourceFiles) {
      const bitmap = await bitmapFromFile(file);
      const effectiveTool = tool.id === "image-batch-compress" ? "image-compress" : ["exif-remove", "favicon-generator", "multi-icon-zip", "color-extract"].includes(tool.id) ? "image-format" : tool.id;
      let canvas = await imageCanvas(effectiveTool, bitmap, values, overlay);
      if (tool.id === "favicon-generator") {
        const resized = document.createElement("canvas"); resized.width = 32; resized.height = 32; resized.getContext("2d").drawImage(canvas, 0, 0, 32, 32); canvas = resized;
      }
      previewCanvas = canvas;
      if (tool.id === "color-extract") { releaseBitmap(bitmap); releaseBitmap(overlay); return { text: extractColors(canvas).join("\n"), canvas }; }
      if (tool.id === "exif-remove" && file.type === "image/jpeg") {
        const cleanBytes = stripJpegMetadata(new Uint8Array(await file.arrayBuffer()));
        const blob = new Blob([cleanBytes], { type: "image/jpeg" });
        outputs.push({ name: `${file.name.replace(/\.[^.]+$/, "")}-metadata-removed.jpg`, data: cleanBytes, blob });
        releaseBitmap(bitmap);
        continue;
      }
      if (tool.id === "multi-icon-zip") {
        const entries = [];
        for (const size of [16, 32, 48, 64, 128, 192, 512]) {
          const icon = document.createElement("canvas"); icon.width = size; icon.height = size; icon.getContext("2d").drawImage(canvas, 0, 0, size, size);
          entries.push({ name: `icon-${size}.png`, data: new Uint8Array(await (await canvasBlob(icon)).arrayBuffer()) });
        }
        releaseBitmap(bitmap); releaseBitmap(overlay);
        return { text: "已生成 7 种尺寸图标", canvas, blob: zipBlob(entries), name: `icons-${Date.now()}.zip` };
      }
      const format = tool.id === "image-format" || tool.id.includes("compress")
        ? values.format
        : tool.id === "exif-remove" && file.type === "image/webp" ? "image/webp" : "image/png";
      const blob = await canvasBlob(canvas, format, values.quality);
      const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
      outputs.push({ name: `${file.name.replace(/\.[^.]+$/, "")}-${tool.id}.${extension}`, data: new Uint8Array(await blob.arrayBuffer()), blob });
      releaseBitmap(bitmap);
    }
    releaseBitmap(overlay);
    if (outputs.length > 1) return { text: `已处理 ${outputs.length} 张图片`, canvas: previewCanvas, blob: zipBlob(outputs), name: `images-${Date.now()}.zip` };
    return { text: `输出大小：${formatBytes(outputs[0].blob.size)}`, canvas: previewCanvas, blob: outputs[0].blob, name: outputs[0].name };
  }

  function renderImageTool(tool) {
    const standalone = ["color-convert", "gradient-generator", "gradient-css", "solid-image"].includes(tool.id);
    const multiple = ["image-batch-compress", "image-pdf"].includes(tool.id);
    byId("toolWorkbenchBody").innerHTML = `<div class="tool-form image-tool-form">
      ${standalone ? "" : `<label class="file-drop"><span>选择${multiple ? "一组" : "一张"}图片</span><input id="imageToolInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" ${multiple ? "multiple" : ""} /></label>`}
      ${tool.id === "image-watermark" ? '<label class="file-drop"><span>选择水印图片</span><input id="imageOverlayInput" type="file" accept="image/*" /></label>' : ""}
      <p class="local-processing-note">图片在本地浏览器中处理。批量操作最多 20 张、总计 50 MB。</p>
      <div class="tool-options">${imageFields(tool.id)}</div>
      <div class="tool-command-row"><button class="primary" id="runImageToolBtn" type="button">开始处理</button><button id="downloadImageToolBtn" type="button" disabled>下载结果</button><button id="copyImageTextBtn" type="button">复制结果信息</button></div>
      <pre class="file-result" id="imageToolResult">等待处理</pre><div class="image-preview" id="imageToolPreview"></div>
      ${renderConfigControls(tool.id)}
    </div>`;
    currentDownload = null;
    byId("runImageToolBtn").addEventListener("click", async () => {
      const button = byId("runImageToolBtn"); button.disabled = true; setMessage("正在本地处理…");
      try {
        const files = standalone ? [] : await readLocalFiles(byId("imageToolInput"), 20, 50 * 1024 * 1024);
        const result = await processImageTool(tool, files, byId("imageOverlayInput")?.files?.[0]);
        byId("imageToolResult").textContent = result.text || "处理完成";
        const preview = byId("imageToolPreview"); preview.innerHTML = "";
        if (result.canvas) { const shown = document.createElement("canvas"); const scale = Math.min(1, 720 / result.canvas.width, 460 / result.canvas.height); shown.width = Math.max(1, Math.round(result.canvas.width * scale)); shown.height = Math.max(1, Math.round(result.canvas.height * scale)); shown.getContext("2d").drawImage(result.canvas, 0, 0, shown.width, shown.height); preview.appendChild(shown); }
        currentDownload = result.blob ? { blob: result.blob, name: result.name } : null;
        byId("downloadImageToolBtn").disabled = !currentDownload;
        setMessage("本地处理完成");
      } catch (error) { setMessage(error.message, true); }
      finally { button.disabled = false; }
    });
    byId("downloadImageToolBtn").addEventListener("click", () => currentDownload && downloadBlob(currentDownload.name, currentDownload.blob));
    byId("copyImageTextBtn").addEventListener("click", (event) => copyText(byId("imageToolResult").textContent, event.currentTarget));
    bindConfigControls();
  }
  function shareUrl(type, id) {
    return `${location.origin}/share/${type}/${encodeURIComponent(id)}`;
  }

  let temporaryCapabilitiesPromise = null;
  function temporaryCapabilities(refresh = false) {
    if (refresh || !temporaryCapabilitiesPromise) {
      temporaryCapabilitiesPromise = bridge.requestJsonGet("/api/temporary/capabilities", {
        authenticated: false,
        timeoutMs: 8000,
      }).then((data) => ({ ...data, available: true })).catch((error) => ({
        available: false,
        error_code: String(error?.code || "temporary_capabilities_unavailable"),
        cloud_reads: false,
        cloud_upload: false,
        temporary_primary: false,
        limits: { file_bytes: TEMP_FILE_MAX_BYTES, video_bytes: TEMP_VIDEO_MAX_BYTES },
      }));
    }
    return temporaryCapabilitiesPromise;
  }

  function temporaryFileLimit(file, capabilities = {}) {
    const extension = String(file?.name || "").split(".").pop().toLowerCase();
    const video = TEMP_VIDEO_EXTENSIONS.has(extension);
    const limits = capabilities.limits || {};
    return {
      video,
      bytes: Number(video ? limits.video_bytes : limits.file_bytes) || (video ? TEMP_VIDEO_MAX_BYTES : TEMP_FILE_MAX_BYTES),
    };
  }

  function temporaryFileMime(file) {
    if (String(file?.type || "").trim()) return String(file.type).trim().toLowerCase();
    const extension = String(file?.name || "").toLowerCase().match(/(\.[a-z0-9]+)$/)?.[1] || "";
    return ({
      ".txt": "text/plain", ".csv": "text/csv", ".json": "application/json",
      ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
      ".zip": "application/zip", ".mp4": "video/mp4", ".m4v": "video/x-m4v",
      ".mov": "video/quicktime", ".webm": "video/webm",
    })[extension] || "application/octet-stream";
  }

  function showQrCode(target, value) {
    target.innerHTML = "";
    if (typeof window.qrcode !== "function") {
      const fallback = document.createElement("p"); fallback.textContent = "二维码组件未加载，请复制链接"; target.appendChild(fallback); return;
    }
    try {
      const utf8Encoder = window.qrcode.stringToBytesFuncs?.["UTF-8"];
      if (utf8Encoder) window.qrcode.stringToBytes = utf8Encoder;
      const qr = window.qrcode(0, "M"); qr.addData(String(value)); qr.make();
      const image = document.createElement("img"); image.src = qr.createDataURL(6, 12); image.alt = "分享二维码"; target.appendChild(image);
      const download = document.createElement("a"); download.href = image.src; download.download = `qr-${Date.now()}.gif`; download.textContent = "下载二维码"; target.appendChild(download);
    } catch (error) {
      const fallback = document.createElement("p"); fallback.textContent = `内容过长，无法生成二维码：${error.message}`; target.appendChild(fallback);
    }
  }

  function temporaryCommonFields(defaultMinutes = 60) {
    return `<div class="tool-options">
      <label><span>有效分钟</span><input id="tempMinutes" data-config="minutes" type="number" min="1" max="10080" value="${defaultMinutes}" /></label>
      <label><span>访问密码（可空）</span><input id="tempPassword" type="password" maxlength="128" autocomplete="new-password" /></label>
      <label class="admin-checkbox"><input id="tempDestroy" data-config="destroy" type="checkbox" /> 首次读取后销毁</label>
    </div>`;
  }

  function renderTemporaryResult(container, label, value, qrValue = "") {
    container.innerHTML = "";
    const title = document.createElement("strong"); title.textContent = label;
    const code = document.createElement("code"); code.textContent = value;
    const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "复制"; copy.addEventListener("click", () => copyText(value, copy));
    container.append(title, code, copy);
    if (qrValue) { const qr = document.createElement("div"); qr.className = "temporary-qr-output"; container.appendChild(qr); showQrCode(qr, qrValue); }
  }

  function renderTemporaryText(tool) {
    byId("toolWorkbenchBody").innerHTML = `<div class="tool-form temporary-tool-form">
      <label class="tool-wide"><span>临时文本</span><textarea id="tempContent" maxlength="102400"></textarea></label>
      ${temporaryCommonFields(60)}
      <label><span>最大访问次数</span><input id="tempMaxViews" data-config="maxViews" type="number" min="1" max="1000" value="10" /></label>
      <div class="tool-command-row"><button class="primary" id="createTempBtn" type="button">生成分享链接</button></div>
      <div class="temporary-result" id="temporaryResult"></div>${renderConfigControls(tool.id)}
    </div>`;
    byId("createTempBtn").addEventListener("click", async () => {
      try {
        const data = await bridge.api("/api/temporary/text", {
          content: byId("tempContent").value, password: byId("tempPassword").value,
          minutes: byId("tempMinutes").value, max_views: byId("tempMaxViews").value,
          destroy_after_read: byId("tempDestroy").checked,
        });
        const url = shareUrl("text", data.share.id); renderTemporaryResult(byId("temporaryResult"), "分享链接", url, url); setMessage(`有效至 ${bridge.formatDate(data.share.expires_at)}`);
      } catch (error) { setMessage(error.message, true); }
    });
    bindConfigControls();
  }

  function cancelActiveUpload(showMessage = true) {
    if (!activeUploadController) return;
    activeUploadController.silentCancel = !showMessage;
    activeUploadController.abort();
    activeUploadController = null;
    if (showMessage) setMessage("已取消上传");
  }

  function renderTemporaryFile(tool) {
    byId("toolWorkbenchBody").innerHTML = `<div class="tool-form temporary-tool-form">
      <label class="file-drop"><span>选择临时文件（普通文件 20 MB，视频 30 MB）</span><input id="tempFileInput" type="file" accept=".txt,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp,.gif,.zip,.mp4,.m4v,.mov,.webm" /></label>
      ${temporaryCommonFields(60)}
      <label><span>最大下载次数</span><input id="tempMaxDownloads" data-config="maxDownloads" type="number" min="1" max="100" value="5" /></label>
      <div class="tool-command-row"><button class="primary" id="createTempBtn" type="button">上传并生成链接</button><button id="cancelTempUploadBtn" class="hidden" type="button">取消上传</button></div>
      <div class="upload-progress hidden" id="tempUploadProgressWrap"><progress id="tempUploadProgress" max="100" value="0"></progress><span id="tempUploadProgressText">0%</span></div>
      <div class="temporary-result" id="temporaryResult"></div>${renderConfigControls(tool.id)}
    </div>`;
    const createButton = byId("createTempBtn");
    const cancelButton = byId("cancelTempUploadBtn");
    const progressWrap = byId("tempUploadProgressWrap");
    const progress = byId("tempUploadProgress");
    const progressText = byId("tempUploadProgressText");
    const updateProgress = (value, label) => {
      const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
      progress.value = percent;
      progressText.textContent = label || `${percent}%`;
    };
    cancelButton.addEventListener("click", () => cancelActiveUpload(true));
    createButton.addEventListener("click", async () => {
      if (activeUploadController) return;
      const controller = new AbortController();
      activeUploadController = controller;
      createButton.disabled = true;
      cancelButton.classList.remove("hidden");
      progressWrap.classList.remove("hidden");
      updateProgress(0, "准备读取…");
      let reservationId = "";
      try {
        const selected = byId("tempFileInput").files?.[0];
        if (!selected) throw new Error("请选择文件");
        const capabilities = await temporaryCapabilities(true);
        if (!capabilities.available) throw new Error("暂时无法确认临时分享服务状态，请检查网络后重试");
        if (!capabilities.cloud_upload) throw new Error("云端临时文件上传暂不可用，请稍后重试");
        const limit = temporaryFileLimit(selected, capabilities);
        if (selected.size > limit.bytes) {
          throw new Error(`临时${limit.video ? "视频" : "文件"}不能超过 ${limit.bytes / (1024 * 1024)} MB`);
        }
        updateProgress(0, "正在创建安全上传…");
        const initialized = await bridge.api("/api/temporary/file/init", {
          file_name: selected.name,
          mime_type: temporaryFileMime(selected),
          size_bytes: selected.size,
          password: byId("tempPassword").value,
          minutes: byId("tempMinutes").value,
          max_downloads: byId("tempMaxDownloads").value,
          destroy_after_download: byId("tempDestroy").checked,
        }, { timeoutMs: 30000 });
        reservationId = initialized.upload.id;
        const data = await bridge.uploadBinaryApi(initialized.upload.upload_url, selected, {
          controller,
          timeoutMs: 600000,
          contentType: temporaryFileMime(selected),
          onProgress: (ratio) => updateProgress(ratio, `上传 ${Math.round(ratio * 100)}%`),
        });
        const url = shareUrl("file", data.file.id);
        renderTemporaryResult(byId("temporaryResult"), "下载链接", url, url);
        updateProgress(1, "上传完成");
        setMessage(`已安全保存，${formatBytes(data.file.size_bytes)}，有效至 ${bridge.formatDate(data.file.expires_at)}`);
      } catch (error) {
        if (reservationId) {
          bridge.api("/api/temporary/file/cancel", { id: reservationId }, { timeoutMs: 10000 }).catch(() => undefined);
        }
        if (error.name !== "AbortError" || !controller.silentCancel) {
          setMessage(error.message, error.name !== "AbortError");
        }
      } finally {
        if (activeUploadController === controller) activeUploadController = null;
        createButton.disabled = false;
        cancelButton.classList.add("hidden");
      }
    });
    bindConfigControls();
  }

  function renderTemporaryClipboard(tool) {
    byId("toolWorkbenchBody").innerHTML = `<div class="tool-form temporary-tool-form">
      <label class="tool-wide"><span>要发送的文本</span><textarea id="tempContent" maxlength="102400"></textarea></label>
      <div class="tool-options"><label><span>有效分钟</span><input id="tempMinutes" data-config="minutes" type="number" min="1" max="10080" value="10" /></label><label class="admin-checkbox"><input id="tempDestroy" data-config="destroy" type="checkbox" checked /> 首次读取后销毁</label></div>
      <div class="tool-command-row"><button class="primary" id="createTempBtn" type="button">生成六位连接码</button></div>
      <div class="temporary-result" id="temporaryResult"></div>
      <hr /><div class="tool-options"><label><span>读取连接码</span><input id="clipboardReadCode" inputmode="numeric" maxlength="6" /></label><button id="readClipboardBtn" type="button">读取</button></div><pre class="share-output" id="clipboardReadOutput"></pre>
      ${renderConfigControls(tool.id)}
    </div>`;
    byId("createTempBtn").addEventListener("click", async () => {
      try {
        const data = await bridge.api("/api/temporary/clipboard", { content: byId("tempContent").value, minutes: byId("tempMinutes").value, destroy_after_read: byId("tempDestroy").checked });
        const url = shareUrl("clipboard", data.clipboard.code); renderTemporaryResult(byId("temporaryResult"), "六位连接码", data.clipboard.code, url); setMessage(`有效至 ${bridge.formatDate(data.clipboard.expires_at)}`);
      } catch (error) { setMessage(error.message, true); }
    });
    byId("readClipboardBtn").addEventListener("click", async () => {
      try { const data = await bridge.publicApi("/api/share/clipboard/read", { code: byId("clipboardReadCode").value }); byId("clipboardReadOutput").textContent = data.clipboard.content; setMessage(data.clipboard.destroyed ? "已读取并销毁" : "读取成功"); }
      catch (error) { setMessage(error.message, true); }
    });
    bindConfigControls();
  }

  function qrStructuredFields(kind) {
    if (kind === "url") return '<label class="tool-wide"><span>网址</span><input id="qrUrl" data-config="url" inputmode="url" placeholder="https://example.com" /></label>';
    if (kind === "wifi") return `<div class="tool-options tool-wide">
      <label><span>网络名称（SSID）</span><input id="qrWifiName" data-config="wifiName" maxlength="128" /></label>
      <label><span>安全类型</span><select id="qrWifiSecurity" data-config="wifiSecurity"><option value="WPA">WPA/WPA2/WPA3</option><option value="WEP">WEP</option><option value="nopass">无密码</option></select></label>
      <label id="qrWifiPasswordField"><span>Wi-Fi 密码</span><input id="qrWifiPassword" data-config="wifiPassword" type="password" maxlength="128" autocomplete="new-password" /></label>
      <label class="admin-checkbox"><input id="qrWifiHidden" data-config="wifiHidden" type="checkbox" /> 隐藏网络</label>
    </div>`;
    if (kind === "contact") return `<div class="tool-options tool-wide">
      <label><span>姓</span><input id="qrContactFamily" data-config="contactFamily" maxlength="80" /></label>
      <label><span>名</span><input id="qrContactGiven" data-config="contactGiven" maxlength="80" /></label>
      <label><span>显示姓名（可空）</span><input id="qrContactDisplay" data-config="contactDisplay" maxlength="160" /></label>
      <label><span>手机</span><input id="qrContactPhone" data-config="contactPhone" inputmode="tel" maxlength="50" /></label>
      <label><span>邮箱</span><input id="qrContactEmail" data-config="contactEmail" inputmode="email" maxlength="254" /></label>
      <label><span>组织</span><input id="qrContactOrg" data-config="contactOrg" maxlength="100" /></label>
      <label><span>职务</span><input id="qrContactTitle" data-config="contactTitle" maxlength="100" /></label>
      <label><span>街道地址</span><input id="qrContactStreet" data-config="contactStreet" maxlength="180" /></label>
      <label><span>城市</span><input id="qrContactCity" data-config="contactCity" maxlength="80" /></label>
      <label><span>省或州</span><input id="qrContactRegion" data-config="contactRegion" maxlength="80" /></label>
      <label><span>邮政编码</span><input id="qrContactPostal" data-config="contactPostal" maxlength="30" /></label>
      <label><span>国家或地区</span><input id="qrContactCountry" data-config="contactCountry" maxlength="80" /></label>
      <label class="tool-wide"><span>网址（可空）</span><input id="qrContactUrl" data-config="contactUrl" inputmode="url" maxlength="500" /></label>
      <label class="tool-wide"><span>备注（可空）</span><textarea id="qrContactNote" data-config="contactNote" maxlength="500"></textarea></label>
    </div>`;
    return '<label class="tool-wide"><span>文本内容</span><textarea id="qrText" data-config="text" maxlength="3000"></textarea></label>';
  }

  function temporaryQrContent(kind) {
    if (kind === "url") {
      const value = byId("qrUrl").value.trim();
      let url;
      try { url = new URL(value); } catch (_error) { throw new Error("请输入完整网址，例如 https://example.com"); }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("网址只支持 http 或 https");
      return url.href;
    }
    if (kind === "wifi") return buildWifiPayload({
      name: byId("qrWifiName").value,
      security: byId("qrWifiSecurity").value,
      password: byId("qrWifiPassword").value,
      hidden: byId("qrWifiHidden").checked,
    });
    if (kind === "contact") return buildVcardPayload({
      family: byId("qrContactFamily").value,
      given: byId("qrContactGiven").value,
      display: byId("qrContactDisplay").value,
      phone: byId("qrContactPhone").value,
      email: byId("qrContactEmail").value,
      organization: byId("qrContactOrg").value,
      title: byId("qrContactTitle").value,
      street: byId("qrContactStreet").value,
      city: byId("qrContactCity").value,
      region: byId("qrContactRegion").value,
      postal: byId("qrContactPostal").value,
      country: byId("qrContactCountry").value,
      website: byId("qrContactUrl").value,
      note: byId("qrContactNote").value,
    });
    const value = byId("qrText").value.trim();
    if (!value) throw new Error("请输入二维码文本");
    return value;
  }

  function renderTemporaryQr(tool) {
    byId("toolWorkbenchBody").innerHTML = `<div class="tool-form temporary-tool-form">
      <label><span>二维码类型</span><select id="qrKind" data-config="kind"><option value="text">文本</option><option value="url">URL</option><option value="wifi">Wi-Fi</option><option value="contact">联系信息</option></select></label>
      <div class="tool-wide" id="qrStructuredFields"></div>
      <label class="admin-checkbox"><input id="qrDynamic" data-config="dynamic" type="checkbox" /> 生成会自动失效的临时链接</label>
      <div class="tool-wide hidden" id="qrDynamicOptions">${temporaryCommonFields(60)}
        <label><span>最大访问次数</span><input id="tempMaxViews" data-config="maxViews" type="number" min="1" max="1000" value="10" /></label>
      </div>
      <div class="tool-command-row"><button class="primary" id="createTempBtn" type="button">生成二维码</button></div>
      <div class="temporary-result" id="temporaryResult"></div>${renderConfigControls(tool.id)}
    </div>`;
    const updateFields = () => {
      byId("qrStructuredFields").innerHTML = qrStructuredFields(byId("qrKind").value);
      const security = byId("qrWifiSecurity");
      if (security) {
        const updatePassword = () => {
          const open = security.value !== "nopass";
          byId("qrWifiPassword").disabled = !open;
          byId("qrWifiPasswordField").classList.toggle("field-disabled", !open);
        };
        security.addEventListener("change", updatePassword);
        updatePassword();
      }
    };
    const updateDynamic = () => byId("qrDynamicOptions").classList.toggle("hidden", !byId("qrDynamic").checked);
    byId("qrKind").addEventListener("change", updateFields);
    byId("qrDynamic").addEventListener("change", updateDynamic);
    updateFields();
    updateDynamic();
    byId("createTempBtn").addEventListener("click", async () => {
      try {
        const kind = byId("qrKind").value;
        const content = temporaryQrContent(kind);
        if (byId("qrDynamic").checked) {
          const data = await bridge.api("/api/temporary/qr", { content, kind, password: byId("tempPassword").value, minutes: byId("tempMinutes").value, max_views: byId("tempMaxViews").value, destroy_after_read: byId("tempDestroy").checked });
          const url = shareUrl("qr", data.share.id); renderTemporaryResult(byId("temporaryResult"), "动态二维码链接", url, url); setMessage(`动态内容有效至 ${bridge.formatDate(data.share.expires_at)}`);
        } else {
          renderTemporaryResult(byId("temporaryResult"), "二维码内容", content, content); setMessage("静态二维码只在本机生成");
        }
      } catch (error) { setMessage(error.message, true); }
    });
    bindConfigControls();
  }

  function stopRoomPolling() {
    const poller = activeRoomPoller;
    if (!poller) return;
    poller.active = false;
    if (poller.timer) window.clearTimeout(poller.timer);
    poller.controller?.abort();
    activeRoomPoller = null;
  }

  function startRoomPolling({ id, password = "", onRoom, onStatus }) {
    stopRoomPolling();
    const poller = { active: true, timer: null, controller: null, failures: 0 };
    activeRoomPoller = poller;
    const schedule = (delay) => {
      if (!poller.active) return;
      poller.timer = window.setTimeout(tick, delay);
    };
    const tick = async () => {
      if (!poller.active) return;
      if (document.visibilityState === "hidden") {
        schedule(ROOM_POLL_BASE_MS);
        return;
      }
      const controller = new AbortController();
      poller.controller = controller;
      try {
        const data = await bridge.publicApi("/api/share/room/read", { id, password }, { controller, timeoutMs: 12000 });
        if (!poller.active) return;
        poller.failures = 0;
        onRoom(data.room);
        onStatus?.("\u81ea\u52a8\u540c\u6b65\u4e2d", false);
      } catch (error) {
        if (!poller.active || error.name === "AbortError") return;
        if (["room_not_found", "password_invalid", "share_password_invalid"].includes(error.code)) {
          onStatus?.(error.message, true);
          stopRoomPolling();
          return;
        }
        poller.failures += 1;
        const delay = Math.min(ROOM_POLL_MAX_MS, ROOM_POLL_BASE_MS * (2 ** Math.min(3, poller.failures)));
        onStatus?.(`\u8fde\u63a5\u4e2d\u65ad\uff0c${Math.ceil(delay / 1000)} \u79d2\u540e\u91cd\u8bd5`, true);
      } finally {
        if (poller.controller === controller) poller.controller = null;
      }
      if (!poller.active) return;
      const delay = poller.failures
        ? Math.min(ROOM_POLL_MAX_MS, ROOM_POLL_BASE_MS * (2 ** Math.min(3, poller.failures)))
        : ROOM_POLL_BASE_MS;
      schedule(delay);
    };
    onStatus?.("\u81ea\u52a8\u540c\u6b65\u5df2\u5f00\u542f", false);
    schedule(ROOM_POLL_BASE_MS);
    return poller;
  }

  function uniqueRoomMessages(room) {
    const messages = Array.isArray(room?.messages) ? room.messages : [];
    const unique = new Map();
    messages.forEach((message, index) => {
      const key = String(message.id || `legacy-${message.created_at}-${index}`);
      if (!unique.has(key)) unique.set(key, { ...message, id: key, _index: index });
    });
    return [...unique.values()].sort((left, right) => {
      const timeOrder = String(left.created_at || "").localeCompare(String(right.created_at || ""));
      return timeOrder || left._index - right._index;
    });
  }

  function renderRoomMessages(room) {
    const target = byId("roomMessages");
    if (!target) return;
    const messages = uniqueRoomMessages(room);
    const signature = messages.map((message) => message.id).join("|");
    if (target.dataset.signature === signature) return;
    const followBottom = !target.childElementCount || target.scrollTop + target.clientHeight >= target.scrollHeight - 32;
    target.dataset.signature = signature;
    target.innerHTML = "";
    messages.forEach((message) => {
      const article = document.createElement("article");
      article.dataset.messageId = message.id;
      const strong = document.createElement("strong");
      strong.textContent = message.author;
      const time = document.createElement("time");
      time.textContent = bridge.formatDate(message.created_at);
      const paragraph = document.createElement("p");
      paragraph.textContent = message.message;
      article.append(strong, time, paragraph);
      target.appendChild(article);
    });
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "room-empty";
      empty.textContent = "\u623f\u95f4\u6682\u65e0\u7559\u8a00";
      target.appendChild(empty);
    }
    if (followBottom) target.scrollTop = target.scrollHeight;
  }

  function renderTemporaryRoom(tool) {
    byId("toolWorkbenchBody").innerHTML = `<div class="tool-form temporary-tool-form">
      ${temporaryCommonFields(60)}<label><span>\u6700\u5927\u6d88\u606f\u6570</span><input id="roomMaxMessages" data-config="maxMessages" type="number" min="1" max="200" value="50" /></label>
      <div class="tool-command-row"><button class="primary" id="createTempBtn" type="button">\u521b\u5efa\u79c1\u5bc6\u623f\u95f4</button></div><div class="temporary-result" id="temporaryResult"></div>
      <hr /><div class="tool-options"><label><span>\u623f\u95f4 ID</span><input id="roomId" autocomplete="off" /></label><label><span>\u623f\u95f4\u5bc6\u7801</span><input id="roomPassword" type="password" autocomplete="off" /></label><button id="openRoomBtn" type="button">\u6253\u5f00\u5e76\u81ea\u52a8\u540c\u6b65</button></div>
      <p class="room-sync-status" id="roomSyncStatus" aria-live="polite">\u5c1a\u672a\u6253\u5f00\u623f\u95f4</p>
      <div class="room-messages" id="roomMessages"></div><div class="tool-options"><label><span>\u663e\u793a\u540d\u79f0</span><input id="roomAuthor" maxlength="30" value="\u8bbf\u5ba2" /></label><label class="tool-wide"><span>\u7559\u8a00</span><textarea id="roomMessage" maxlength="4000"></textarea></label><button id="postRoomBtn" type="button">\u53d1\u9001\u7559\u8a00</button><button id="clearRoomBtn" type="button">\u6e05\u7a7a\u6211\u7684\u623f\u95f4</button></div>
      ${renderConfigControls(tool.id)}
    </div>`;
    const status = (message, error = false) => {
      const target = byId("roomSyncStatus");
      if (!target) return;
      target.textContent = message;
      target.classList.toggle("error", error);
    };
    const roomCredentials = () => ({ id: byId("roomId").value.trim(), password: byId("roomPassword").value });
    const readRoom = async () => {
      const credentials = roomCredentials();
      if (!credentials.id) throw new Error("\u8bf7\u8f93\u5165\u623f\u95f4 ID");
      return bridge.publicApi("/api/share/room/read", credentials, { timeoutMs: 12000 });
    };
    const openRoom = async () => {
      stopRoomPolling();
      status("\u6b63\u5728\u6253\u5f00\u623f\u95f4\u2026");
      const data = await readRoom();
      renderRoomMessages(data.room);
      const credentials = roomCredentials();
      startRoomPolling({ id: credentials.id, password: credentials.password, onRoom: renderRoomMessages, onStatus: status });
      setMessage("\u623f\u95f4\u5df2\u6253\u5f00\uff0c\u7559\u8a00\u4f1a\u81ea\u52a8\u540c\u6b65");
      return data;
    };
    byId("createTempBtn").addEventListener("click", async () => {
      try {
        const data = await bridge.api("/api/temporary/room", { password: byId("tempPassword").value, minutes: byId("tempMinutes").value, max_messages: byId("roomMaxMessages").value });
        byId("roomId").value = data.room.id;
        byId("roomPassword").value = byId("tempPassword").value;
        const url = shareUrl("room", data.room.id);
        renderTemporaryResult(byId("temporaryResult"), "\u623f\u95f4\u94fe\u63a5", url, url);
        await openRoom();
        setMessage(`\u623f\u95f4\u5df2\u521b\u5efa\uff0c\u6709\u6548\u81f3 ${bridge.formatDate(data.room.expires_at)}`);
      } catch (error) { status(error.message, true); setMessage(error.message, true); }
    });
    byId("openRoomBtn").addEventListener("click", () => openRoom().catch((error) => { status(error.message, true); setMessage(error.message, true); }));
    byId("postRoomBtn").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const messageField = byId("roomMessage");
      const message = messageField.value.trim();
      if (!message) { setMessage("\u8bf7\u8f93\u5165\u7559\u8a00", true); messageField.focus(); return; }
      button.disabled = true;
      try {
        const credentials = roomCredentials();
        if (!credentials.id) throw new Error("\u8bf7\u5148\u6253\u5f00\u623f\u95f4");
        const data = await bridge.publicApi("/api/share/room/post", { ...credentials, author: byId("roomAuthor").value, message });
        messageField.value = "";
        renderRoomMessages(data.room);
        status("\u81ea\u52a8\u540c\u6b65\u4e2d");
        setMessage("\u7559\u8a00\u5df2\u53d1\u9001");
      } catch (error) { status(error.message, true); setMessage(`\u53d1\u9001\u5931\u8d25\uff1a${error.message}\uff0c\u8349\u7a3f\u5df2\u4fdd\u7559`, true); }
      finally { button.disabled = false; }
    });
    byId("clearRoomBtn").addEventListener("click", async () => {
      try {
        const id = roomCredentials().id;
        if (!id) throw new Error("\u8bf7\u5148\u6253\u5f00\u623f\u95f4");
        await bridge.api("/api/temporary/room/clear", { id });
        const data = await readRoom();
        renderRoomMessages(data.room);
        setMessage("\u623f\u95f4\u5df2\u6e05\u7a7a");
      } catch (error) { setMessage(error.message, true); }
    });
    bindConfigControls();
  }

  function renderTemporaryTool(tool) {
    if (tool.id === "temporary-text") renderTemporaryText(tool);
    else if (tool.id === "temporary-file") renderTemporaryFile(tool);
    else if (tool.id === "temporary-clipboard") renderTemporaryClipboard(tool);
    else if (tool.id === "temporary-qr") renderTemporaryQr(tool);
    else renderTemporaryRoom(tool);
  }

  function renderShareRoomMessages(room) {
    const output = byId("shareViewerOutput");
    const messages = uniqueRoomMessages(room);
    const signature = messages.map((message) => message.id).join("|");
    if (output.dataset.signature === signature) return;
    output.dataset.signature = signature;
    output.textContent = messages.map((item) => `${item.author} \u00b7 ${bridge.formatDate(item.created_at)}\n${item.message}`).join("\n\n") || "\u623f\u95f4\u6682\u65e0\u7559\u8a00";
    output.classList.remove("hidden");
  }

  function showShareViewer(path) {
    stopRoomPolling();
    cancelActiveUpload(false);
    const match = path.match(/^\/share\/(text|file|clipboard|qr|room)\/([^/?#]+)/);
    if (!match) return false;
    const [, type, rawId] = match;
    const id = decodeURIComponent(rawId);
    const titleMap = { text: "\u4e34\u65f6\u6587\u672c", file: "\u4e34\u65f6\u6587\u4ef6", clipboard: "\u4e34\u65f6\u526a\u8d34\u677f", qr: "\u4e34\u65f6\u4e8c\u7ef4\u7801", room: "\u4e34\u65f6\u7559\u8a00\u623f\u95f4" };
    byId("shareViewerTitle").textContent = titleMap[type];
    byId("shareViewerMeta").textContent = type === "room" ? "\u6253\u5f00\u540e\u4f1a\u81ea\u52a8\u540c\u6b65\u65b0\u7559\u8a00\u3002" : "\u5185\u5bb9\u53ef\u80fd\u5728\u8bfb\u53d6\u540e\u7acb\u5373\u9500\u6bc1\uff0c\u8bf7\u786e\u8ba4\u540e\u518d\u6253\u5f00\u3002";
    const output = byId("shareViewerOutput");
    output.classList.add("hidden");
    output.textContent = "";
    output.dataset.signature = "";
    byId("shareViewerMessage").textContent = "";
    byId("sharePasswordField").classList.toggle("hidden", type === "clipboard");
    byId("shareViewerExtra").innerHTML = type === "room" ? '<label class="field-label"><span>\u663e\u793a\u540d\u79f0</span><input id="shareRoomAuthor" maxlength="30" value="\u8bbf\u5ba2" /></label><label class="field-label"><span>\u7559\u8a00</span><textarea id="shareRoomMessage" maxlength="4000"></textarea></label><div class="action-row compact"><button id="shareRoomSendBtn" type="button">\u53d1\u9001\u7559\u8a00</button><span class="room-sync-status" id="shareRoomSyncStatus" aria-live="polite">\u5c1a\u672a\u6253\u5f00\u623f\u95f4</span></div>' : "";
    byId("shareViewer").classList.remove("hidden");
    byId("shareViewer").setAttribute("aria-hidden", "false");
    byId("openShareBtn").textContent = type === "room" ? "\u6253\u5f00\u5e76\u81ea\u52a8\u540c\u6b65" : "\u6253\u5f00";
    const roomStatus = (message, error = false) => {
      const target = byId("shareRoomSyncStatus");
      if (!target) return;
      target.textContent = message;
      target.classList.toggle("error", error);
    };
    byId("openShareBtn").onclick = async () => {
      const message = byId("shareViewerMessage");
      message.textContent = "\u6b63\u5728\u6253\u5f00\u2026";
      try {
        if (type === "clipboard") {
          const data = await bridge.publicApi("/api/share/clipboard/read", { code: id });
          output.textContent = data.clipboard.content;
        } else if (type === "file") {
          const capabilities = await temporaryCapabilities(true);
          if (!capabilities.available) throw new Error("暂时无法确认临时分享服务状态，请检查网络后重试");
          if (!capabilities.cloud_reads) throw new Error("云端临时文件下载暂不可用，请稍后重试");
          const data = await bridge.publicApi("/api/share/file/authorize", {
            id, password: byId("sharePasswordInput").value,
          }, { timeoutMs: 30000 });
          const link = document.createElement("a");
          link.href = data.download.url;
          link.download = data.download.file.file_name;
          link.rel = "noopener";
          document.body.appendChild(link);
          link.click();
          link.remove();
          const fileName = data.download.file.file_name;
          output.textContent = `\u6587\u4ef6 ${fileName} \u5df2\u5f00\u59cb\u4e0b\u8f7d`;
        } else if (type === "room") {
          const password = byId("sharePasswordInput").value;
          const data = await bridge.publicApi("/api/share/room/read", { id, password }, { timeoutMs: 12000 });
          renderShareRoomMessages(data.room);
          startRoomPolling({ id, password, onRoom: renderShareRoomMessages, onStatus: roomStatus });
          message.textContent = "\u623f\u95f4\u5df2\u6253\u5f00\uff0c\u6b63\u5728\u81ea\u52a8\u540c\u6b65";
          return;
        } else {
          const data = await bridge.publicApi("/api/share/text/read", { id, password: byId("sharePasswordInput").value });
          output.textContent = data.share.content;
          if (type === "qr") {
            const qr = document.createElement("div");
            qr.className = "temporary-qr-output";
            byId("shareViewerExtra").innerHTML = "";
            byId("shareViewerExtra").appendChild(qr);
            showQrCode(qr, data.share.content);
          }
        }
        output.classList.remove("hidden");
        message.textContent = "\u6253\u5f00\u6210\u529f";
      } catch (error) {
        roomStatus(error.message, true);
        message.textContent = error.message;
      }
    };
    if (type === "room") {
      byId("shareRoomSendBtn").onclick = async (event) => {
        const button = event.currentTarget;
        const field = byId("shareRoomMessage");
        const message = field.value.trim();
        if (!message) { byId("shareViewerMessage").textContent = "\u8bf7\u8f93\u5165\u7559\u8a00"; field.focus(); return; }
        button.disabled = true;
        try {
          const data = await bridge.publicApi("/api/share/room/post", { id, password: byId("sharePasswordInput").value, author: byId("shareRoomAuthor").value, message });
          field.value = "";
          renderShareRoomMessages(data.room);
          byId("shareViewerMessage").textContent = "\u7559\u8a00\u5df2\u53d1\u9001";
        } catch (error) {
          byId("shareViewerMessage").textContent = `\u53d1\u9001\u5931\u8d25\uff1a${error.message}\uff0c\u8349\u7a3f\u5df2\u4fdd\u7559`;
        } finally { button.disabled = false; }
      };
    }
    return true;
  }

  window.WYJTools.showShareViewer = showShareViewer;
  window.WYJTools.primitives = Object.freeze({
    runTextOperation,
    parseCsv,
    csvString,
    validateCsvTable,
    decodeLocalText,
    zipBlob,
    bitmapFromFile,
    imageCanvas,
    canvasBlob,
    stripJpegMetadata,
    releaseBitmap,
  });
})();
