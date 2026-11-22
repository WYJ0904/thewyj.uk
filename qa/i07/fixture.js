import {
  MOTION,
  prefersReducedMotion,
  installMotionSystem,
  setControlFeedbackState,
  createTabSkeletonSwitcher,
  attachFileDropFeedback,
  flipLayout,
  createDragSortController,
  getSharedToastManager,
  showToast,
  attachSheetAdapter,
  syncModalScrollLock,
  createScrollProgressController,
} from "/js/core/motion.js";
import { reconcileKeyedRows } from "/js/core/keyed-list.js";
import { focusDialog, dialogFocusTargets } from "/js/core/design-system.js";

const $ = (id) => document.getElementById(id);
const statusLine = $("fixtureStatusLine");
const setStatus = (text) => { if (statusLine) statusLine.textContent = text; };

installMotionSystem(document);
const toastManager = getSharedToastManager(document);
let offlineMode = false;

$("telMotionReady").textContent = document.documentElement.getAttribute("data-aeris-motion-ready") || "false";

function syncToastTelemetry() {
  const snap = toastManager.snapshot();
  const next = `${snap.visible.length} / ${snap.queued.length}`;
  const el = $("telToastState");
  if (el && el.textContent !== next) el.textContent = next;
}

// Observe toast region mutations only (and guard text equality) to avoid feedback loops.
const toastObserver = new MutationObserver(() => syncToastTelemetry());
const toastHost = document.querySelector(".ds-toast-region");
if (toastHost) toastObserver.observe(toastHost, { childList: true, subtree: true });

// ---------------------------------------------------------------------------
// Environment Controls (Light/Dark, Reduced Motion, P07 ON/OFF, Offline)
// ---------------------------------------------------------------------------
$("fixtureThemeBtn").addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.themeSwitching = "true";
  root.dataset.theme = next;
  $("fixtureThemeBtn").textContent = `主题：${next === "dark" ? "深色" : "浅色"}`;
  $("fixtureThemeBtn").setAttribute("aria-pressed", String(next === "dark"));
  requestAnimationFrame(() => requestAnimationFrame(() => { delete root.dataset.themeSwitching; }));
  setStatus(`主题已切换为${next === "dark" ? "深色" : "浅色"}（2-RAF 护栏保护）`);
});

$("fixtureReducedBtn").addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.dataset.androidReducedMotion === "true" ? "false" : "true";
  root.dataset.androidReducedMotion = next;
  $("fixtureReducedBtn").textContent = `减弱动态：${next === "true" ? "ON" : "OFF"}`;
  $("fixtureReducedBtn").setAttribute("aria-pressed", String(next === "true"));
  document.dispatchEvent(new CustomEvent("thewyj:reduced-motion", { detail: { reduced: next === "true" } }));
  setStatus(`Reduced Motion 已${next === "true" ? "开启：运动降级，状态反馈保留" : "关闭"}`);
});

$("fixtureP07Btn").addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.dataset.p07Ui === "enabled" ? "disabled" : "enabled";
  root.dataset.p07Ui = next;
  $("fixtureP07Btn").textContent = `P07 UI：${next === "enabled" ? "ON" : "OFF"}`;
  $("fixtureP07Btn").setAttribute("aria-pressed", String(next === "enabled"));
  setStatus(`P07 UI 标志切换为 ${next}`);
});

$("fixtureOfflineBtn").addEventListener("click", () => {
  offlineMode = !offlineMode;
  $("fixtureOfflineBtn").textContent = `网络：${offlineMode ? "离线" : "在线"}`;
  $("fixtureOfflineBtn").setAttribute("aria-pressed", String(offlineMode));
  showToast({
    tone: offlineMode ? "warning" : "info",
    message: offlineMode ? "当前已切换至离线状态：联网提交将被拦截并如实提示。" : "网络连接已恢复。",
  }, {}, document);
  syncToastTelemetry();
});

// ---------------------------------------------------------------------------
// 1. Controls, Async Pending, Simulated Fail, Switch, Form, File Drop
// ---------------------------------------------------------------------------
$("btnPrimaryTap").addEventListener("click", () => {
  setStatus("主按钮点击触发：仅在真实完成时报告完成");
});

$("btnAsyncPending").addEventListener("click", () => {
  const btn = $("btnAsyncPending");
  if (btn.getAttribute("aria-busy") === "true") return;
  setControlFeedbackState(btn, "pending");
  btn.textContent = "处理中…";
  setTimeout(() => {
    if (offlineMode) {
      setControlFeedbackState(btn, "error");
      btn.textContent = "异步处理中 (真实状态)";
      showToast({ tone: "error", message: "网络离线：无法完成远程同步，未写入虚报状态。" }, {}, document);
    } else {
      setControlFeedbackState(btn, "success");
      btn.textContent = "异步处理中 (真实状态)";
      showToast({ tone: "success", message: "服务端回执确认：操作已完成。" }, {}, document);
    }
    syncToastTelemetry();
  }, 320);
});

$("btnAsyncFail").addEventListener("click", () => {
  const btn = $("btnAsyncFail");
  setControlFeedbackState(btn, "pending");
  setTimeout(() => {
    setControlFeedbackState(btn, "error");
    showToast({ tone: "error", message: "操作失败 (503)：已保持原状态，未播放成功动画。" }, {}, document);
    syncToastTelemetry();
  }, 220);
});

$("btnGhostTap").addEventListener("click", () => setStatus("幽灵按钮已响应"));
$("btnDangerTap").addEventListener("click", () => {
  setStatus("危险动作按钮点击：须经确认流程");
  openFixtureModal("fixtureConfirmModal");
});

// Switch with real async delay vs simulated failure rollback
function bindAsyncSwitch(inputId, textId, shouldFail) {
  const input = $(inputId);
  const labelText = $(textId);
  let busy = false;
  input.addEventListener("change", () => {
    if (busy) {
      input.checked = !input.checked;
      return;
    }
    const target = input.checked;
    busy = true;
    input.disabled = true;
    input.setAttribute("aria-busy", "true");
    labelText.textContent = `正在保存为 ${target ? "开启" : "关闭"}…`;
    setTimeout(() => {
      busy = false;
      input.disabled = false;
      input.removeAttribute("aria-busy");
      if (shouldFail || offlineMode) {
        input.checked = !target;
        input.setAttribute("aria-checked", String(input.checked));
        labelText.textContent = `保存失败，已回滚至：${input.checked ? "开启" : "关闭"}`;
        showToast({ tone: "error", message: "开关保存失败，已回滚滑块位置。" }, {}, document);
      } else {
        input.setAttribute("aria-checked", String(target));
        labelText.textContent = `当前：${target ? "开启（已保存）" : "关闭（已保存）"}`;
        showToast({ tone: "success", message: `开关已更新为${target ? "开启" : "关闭"}` }, {}, document);
      }
      syncToastTelemetry();
    }, 240);
  });
}
bindAsyncSwitch("fixtureSwitchSuccess", "fixtureSwitchSuccessText", false);
bindAsyncSwitch("fixtureSwitchFail", "fixtureSwitchFailText", true);

// Form validation & double-submit guard
const fixtureForm = $("fixtureForm");
const formSubmitBtn = $("fixtureFormSubmitBtn");
let formSubmitting = false;
fixtureForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (formSubmitting) return;
  const titleInput = $("fixtureInputTitle");
  const errEl = $("fixtureFormError");
  if (!titleInput.checkValidity()) {
    errEl.textContent = "测试标题至少需要 3 个字符。";
    titleInput.setAttribute("aria-invalid", "true");
    titleInput.dispatchEvent(new Event("invalid", { cancelable: true }));
    titleInput.focus();
    return;
  }
  errEl.textContent = "";
  titleInput.removeAttribute("aria-invalid");
  formSubmitting = true;
  setControlFeedbackState(formSubmitBtn, "pending");
  formSubmitBtn.textContent = "提交中…";
  setTimeout(() => {
    formSubmitting = false;
    formSubmitBtn.textContent = "提交校验";
    if (offlineMode) {
      setControlFeedbackState(formSubmitBtn, "error");
      errEl.textContent = "当前离线，表单未提交。";
      showToast({ tone: "error", message: "离线状态下无法提交表单。" }, {}, document);
    } else {
      setControlFeedbackState(formSubmitBtn, "success");
      showToast({ tone: "success", message: `表单已提交：${titleInput.value.trim()}` }, {}, document);
    }
    syncToastTelemetry();
  }, 260);
});

$("fixtureInputTitle").addEventListener("input", () => {
  if ($("fixtureInputTitle").checkValidity()) {
    $("fixtureInputTitle").removeAttribute("aria-invalid");
    $("fixtureFormError").textContent = "";
  }
});

$("fixtureFormResetBtn").addEventListener("click", () => {
  fixtureForm.reset();
  $("fixtureFormError").textContent = "";
  $("fixtureInputTitle").removeAttribute("aria-invalid");
  setControlFeedbackState(formSubmitBtn, "idle");
});

// File Dropzone
const fileInput = $("fixtureFileInput");
attachFileDropFeedback($("fixtureDropZone"), {
  validate: (files) => files.some((f) => f.size > 50 * 1024 * 1024)
    ? { ok: false, message: "文件超过 50MB 限制" }
    : { ok: true },
  onFiles: (files) => {
    $("fixtureFileStatus").textContent = `已接收 ${files.length} 个文件：${files.map((f) => f.name).join(", ")}`;
  },
  doc: document,
});
fileInput.addEventListener("change", () => {
  const files = [...(fileInput.files || [])];
  $("fixtureFileStatus").textContent = files.length
    ? `已选择：${files.map((f) => f.name).join(", ")}`
    : "尚未选择文件";
});

// ---------------------------------------------------------------------------
// 2. Tab Indicator & 140ms Skeleton Switcher (Interruptible)
// ---------------------------------------------------------------------------
const TAB_CONTENT = {
  learning: { title: "语言学习 · 140ms 骨架预览", desc: "单词复习与 FSRS 节奏预览（支持连续点击中断旧渲染）。" },
  tools: { title: "工具箱 · 140ms 骨架预览", desc: "文本统计、JSON 格式化与图片压缩即时响应。" },
  finance: { title: "账本统计 · 140ms 骨架预览", desc: "等宽数字 tabular-nums 与局部行复用更新。" },
  share: { title: "文件传输 · 140ms 骨架预览", desc: "拖拽上传区校验反馈与分片续传队列。" },
};
const tabSwitcher = createTabSkeletonSwitcher({ duration: MOTION.skeleton, view: window });
const tabButtons = [...document.querySelectorAll("#fixtureTabList [role='tab']")];
const tabPanel = $("fixtureTabPanel");
let staleDroppedCount = 0;

function activateTab(tab, { focus = false } = {}) {
  for (const btn of tabButtons) {
    const active = btn === tab;
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
  }
  const key = tab.dataset.tabKey;
  tabPanel.setAttribute("aria-labelledby", tab.id);
  const info = TAB_CONTENT[key] || TAB_CONTENT.learning;
  tabSwitcher.switchTab(tabPanel, () => {
    $("fixtureTabTitle").textContent = info.title;
    $("fixtureTabDesc").textContent = info.desc;
  }).then((applied) => {
    if (!applied) staleDroppedCount += 1;
    setStatus(`Tab 切换：${key}（已丢弃过期切换 ${staleDroppedCount} 次）`);
  });
  if (focus) tab.focus({ preventScroll: true });
}

tabButtons.forEach((btn, idx) => {
  btn.addEventListener("click", () => activateTab(btn));
  btn.addEventListener("keydown", (event) => {
    let next = idx;
    if (event.key === "ArrowRight") next = (idx + 1) % tabButtons.length;
    else if (event.key === "ArrowLeft") next = (idx - 1 + tabButtons.length) % tabButtons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabButtons.length - 1;
    else return;
    event.preventDefault();
    activateTab(tabButtons[next], { focus: true });
  });
});

// ---------------------------------------------------------------------------
// 3. Bidirectional FLIP, Drag Sort, Keyboard Sort & Density Toggle
// ---------------------------------------------------------------------------
const flipGrid = $("fixtureFlipGrid");
const flipEmpty = $("fixtureFlipEmpty");
const initialFlipNodes = [...flipGrid.querySelectorAll("[data-flip-key]")];
const initialFlipMap = new Map(initialFlipNodes.map((n) => [n.dataset.flipKey, n]));
let activeFlipController = null;

function verifyFlipIdentity() {
  const currentNodes = [...flipGrid.querySelectorAll("[data-flip-key]")];
  const intact = currentNodes.filter((n) => initialFlipMap.get(n.dataset.flipKey) === n).length;
  $("telFlipIdentity").textContent = `${intact} / ${initialFlipNodes.length}`;
  return intact === initialFlipNodes.length;
}
verifyFlipIdentity();

function syncFlipEmptyState() {
  const visibleCount = [...flipGrid.querySelectorAll("[data-flip-key]")].filter((n) => !n.hidden).length;
  flipEmpty.classList.toggle("hidden", visibleCount > 0);
  flipGrid.classList.toggle("hidden", visibleCount === 0);
}

function runFlipMutation(mutateFn, label = "FLIP 重排") {
  activeFlipController = flipLayout(flipGrid, mutateFn, {
    selector: "[data-flip-key]",
    duration: MOTION.container,
    scale: true,
    doubleRaf: true,
    view: window,
  });
  verifyFlipIdentity();
  setStatus(`${label} · 动画节点数 ${activeFlipController.animatedCount}`);
  return activeFlipController;
}

function moveCard(key, delta) {
  const cards = [...flipGrid.querySelectorAll("[data-flip-key]")];
  const idx = cards.findIndex((c) => c.dataset.flipKey === key);
  const nextIdx = Math.max(0, Math.min(cards.length - 1, idx + delta));
  if (idx < 0 || idx === nextIdx) return;
  const activeFocus = document.activeElement;
  runFlipMutation(() => {
    const node = cards[idx];
    if (nextIdx < idx) flipGrid.insertBefore(node, cards[nextIdx]);
    else flipGrid.insertBefore(node, cards[nextIdx].nextElementSibling);
  }, `卡片 ${key} ${delta < 0 ? "向上 ↑" : "向下 ↓"} FLIP`);
  if (activeFocus && flipGrid.contains(activeFocus)) activeFocus.focus({ preventScroll: true });
}

flipGrid.addEventListener("click", (event) => {
  const up = event.target.closest("[data-flip-up]");
  if (up) { moveCard(up.dataset.flipUp, -1); return; }
  const down = event.target.closest("[data-flip-down]");
  if (down) { moveCard(down.dataset.flipDown, 1); return; }
  const hideBtn = event.target.closest("[data-flip-hide]");
  if (hideBtn) {
    const card = flipGrid.querySelector(`[data-flip-key="${hideBtn.dataset.flipHide}"]`);
    if (card) {
      runFlipMutation(() => { card.hidden = true; }, `隐藏 ${hideBtn.dataset.flipHide}`);
      syncFlipEmptyState();
    }
  }
});

createDragSortController(flipGrid, {
  itemSelector: "[data-flip-key]",
  handleSelector: "[data-drag-handle]",
  axis: "both",
  onOrderChange: (order, meta = {}) => {
    verifyFlipIdentity();
    const label = meta.trigger === "keyboard" ? `键盘排序 (${meta.key})` : "拖拽排序完成";
    setStatus(`${label}：${order.join(" → ")}`);
  },
  onDragStateChange: ({ cancelled }) => {
    if (cancelled) setStatus("拖拽已取消，已恢复原排序。");
  },
  view: window,
});

$("btnFlipDensity").addEventListener("click", () => {
  const next = flipGrid.dataset.densityMode === "two-col" ? "single-col" : "two-col";
  runFlipMutation(() => {
    flipGrid.dataset.densityMode = next;
  }, `布局切换：${next === "two-col" ? "舒适 2 列" : "紧凑 1 列"}`);
});

$("btnFlipBurst").addEventListener("click", () => {
  const step = (n) => {
    const cards = [...flipGrid.querySelectorAll("[data-flip-key]")];
    runFlipMutation(() => {
      flipGrid.insertBefore(cards.at(-1), cards[0]);
    }, `连续三次重排 (${n}/3)`);
  };
  step(1);
  setTimeout(() => step(2), 110);
  setTimeout(() => step(3), 220);
});

$("btnFlipReverse").addEventListener("click", () => {
  const cards = [...flipGrid.querySelectorAll("[data-flip-key]")];
  runFlipMutation(() => {
    flipGrid.insertBefore(cards[0], null);
  }, "中途反向重排 · 去程");
  setTimeout(() => {
    const cur = [...flipGrid.querySelectorAll("[data-flip-key]")];
    runFlipMutation(() => {
      flipGrid.insertBefore(cur.at(-1), cur[0]);
    }, "中途反向重排 · 立即逆转");
  }, 130);
});

$("btnFlipCancel").addEventListener("click", () => {
  const cards = [...flipGrid.querySelectorAll("[data-flip-key]")];
  const ctrl = runFlipMutation(() => {
    flipGrid.insertBefore(cards.at(-1), cards[0]);
  }, "即将动画中取消");
  setTimeout(() => {
    ctrl.cancel();
    setStatus("FLIP 动画已中断取消，内联 transform 已清零。");
  }, 100);
});

$("btnFlipHideAll").addEventListener("click", () => {
  for (const node of initialFlipNodes) node.hidden = true;
  syncFlipEmptyState();
  setStatus("已隐藏全部卡片，展示居中空态与恢复按钮。");
});

function restoreAllCards() {
  for (const node of initialFlipNodes) node.hidden = false;
  syncFlipEmptyState();
  runFlipMutation(() => {
    for (const node of initialFlipNodes) flipGrid.append(node);
    flipGrid.dataset.densityMode = "two-col";
  }, "一键恢复默认布局");
}
$("btnFlipRestoreAll").addEventListener("click", restoreAllCards);
$("btnFlipEmptyRestore").addEventListener("click", restoreAllCards);

// ---------------------------------------------------------------------------
// 4. Keyed Table Inline Switch & Kill Switch (DOM Node Identity)
// ---------------------------------------------------------------------------
const tbody = $("fixtureKeyedTbody");
let killSwitchActive = false;
let rowRebuilds = 0;
let flagRows = [
  { key: "motion_engine", label: "共享动效引擎 (合成项)", enabled: true, revision: 1 },
  { key: "toast_queue", label: "双条 Toast 调度 (合成项)", enabled: true, revision: 2 },
  { key: "fail_rollback", label: "模拟失败开关 (点击测试回滚)", enabled: false, revision: 1, simulateFail: true },
];

const tbodyObserver = new MutationObserver((records) => {
  for (const record of records) {
    if (record.addedNodes.length || record.removedNodes.length) {
      rowRebuilds += 1;
    }
  }
  $("telRowRebuilds").textContent = String(rowRebuilds);
});

function renderKeyedTable({ flip = false } = {}) {
  const locked = killSwitchActive;
  reconcileKeyedRows(tbody, flagRows, {
    key: (item) => item.key,
    signature: (item) => `${item.label}|${item.enabled}|${item.revision}|${locked}`,
    render: (item) => {
      const tone = locked ? "error" : (item.enabled ? "success" : "info");
      const statusText = locked ? "已熔断锁定" : (item.enabled ? "ON" : "OFF");
      return `<tr data-flag-key="${item.key}">
        <td><strong>${item.label}</strong></td>
        <td><span class="status-badge" data-tone="${tone}">${statusText}</span></td>
        <td class="tabular-nums">v${item.revision}</td>
        <td>
          <label class="switch" for="sw-${item.key}">
            <input type="checkbox" id="sw-${item.key}" data-flag-switch="${item.key}" role="switch" aria-label="${item.label}" aria-checked="${item.enabled}" ${item.enabled ? "checked" : ""} ${locked ? "disabled" : ""} />
            <span class="slider"></span>
          </label>
        </td>
      </tr>`;
    },
    flip,
  });
}

renderKeyedTable({ flip: false });
tbodyObserver.observe(tbody, { childList: true });

// Update row cells in-place when toggling a switch to guarantee ZERO tr node rebuilds!
tbody.addEventListener("change", (event) => {
  const input = event.target.closest("[data-flag-switch]");
  if (!input) return;
  const key = input.dataset.flagSwitch;
  const rowItem = flagRows.find((r) => r.key === key);
  const tr = input.closest("tr");
  if (!rowItem || !tr || killSwitchActive) {
    input.checked = Boolean(rowItem?.enabled);
    return;
  }
  const target = input.checked;
  input.disabled = true;
  input.setAttribute("aria-busy", "true");
  const badge = tr.querySelector(".status-badge");
  if (badge) { badge.textContent = "保存中…"; badge.dataset.tone = "warning"; }

  setTimeout(() => {
    input.disabled = false;
    input.removeAttribute("aria-busy");
    if (rowItem.simulateFail || offlineMode) {
      input.checked = rowItem.enabled;
      input.setAttribute("aria-checked", String(rowItem.enabled));
      if (badge) { badge.textContent = "失败回滚"; badge.dataset.tone = "error"; }
      showToast({ tone: "error", message: `${rowItem.label} 更新失败，已原位回滚。` }, {}, document);
    } else {
      rowItem.enabled = target;
      rowItem.revision += 1;
      input.setAttribute("aria-checked", String(target));
      if (badge) { badge.textContent = target ? "ON" : "OFF"; badge.dataset.tone = target ? "success" : "info"; }
      const revCell = tr.children[2];
      if (revCell) revCell.textContent = `v${rowItem.revision}`;
      showToast({ tone: "success", message: `${rowItem.label} 已切换为 ${target ? "ON" : "OFF"}` }, {}, document);
    }
    syncToastTelemetry();
  }, 180);
});

$("btnToggleKillSwitch").addEventListener("click", () => {
  killSwitchActive = !killSwitchActive;
  const btn = $("btnToggleKillSwitch");
  btn.textContent = `模拟 Kill Switch：${killSwitchActive ? "ON" : "OFF"}`;
  btn.setAttribute("aria-pressed", String(killSwitchActive));
  $("fixtureKillBanner").classList.toggle("hidden", !killSwitchActive);
  // In-place update of existing rows without replacing <tr> nodes!
  for (const tr of tbody.querySelectorAll("tr[data-flag-key]")) {
    const key = tr.dataset.flagKey;
    const item = flagRows.find((r) => r.key === key);
    const input = tr.querySelector("input[role='switch']");
    const badge = tr.querySelector(".status-badge");
    if (input) input.disabled = killSwitchActive;
    if (badge && item) {
      badge.textContent = killSwitchActive ? "已熔断锁定" : (item.enabled ? "ON" : "OFF");
      badge.dataset.tone = killSwitchActive ? "error" : (item.enabled ? "success" : "info");
    }
  }
  setStatus(`Kill Switch 已切换为 ${killSwitchActive ? "ON（原地锁定）" : "OFF（原地恢复）"}`);
});

$("btnReverseRows").addEventListener("click", () => {
  flagRows = [...flagRows].reverse();
  renderKeyedTable({ flip: true });
  setStatus("表格行已倒序重排（复用原有 <tr> 节点）");
});

// ---------------------------------------------------------------------------
// 5. Desktop Modal & Mobile Gesture Drawer
// ---------------------------------------------------------------------------
const returnFocusMap = new Map();
const closeTimers = new Map();

function openFixtureModal(id) {
  const modal = $(id);
  if (!modal) return;
  if (closeTimers.has(id)) { clearTimeout(closeTimers.get(id)); closeTimers.delete(id); }
  if (document.activeElement instanceof HTMLElement) returnFocusMap.set(id, document.activeElement);
  modal.classList.remove("hidden", "is-closing");
  modal.setAttribute("aria-hidden", "false");
  $("fixtureScaleWrap").inert = true;
  attachSheetAdapter(modal, {
    dismissible: !modal.hasAttribute("data-confirm-only"),
    onRequestClose: () => closeFixtureModal(id, true),
  }).onOpened();
  focusDialog(modal);
}

function closeFixtureModal(id, immediate = false) {
  const modal = $(id);
  if (!modal || modal.classList.contains("hidden")) return;
  const finish = () => {
    closeTimers.delete(id);
    modal.classList.add("hidden");
    modal.classList.remove("is-closing");
    modal.setAttribute("aria-hidden", "true");
    attachSheetAdapter(modal).onClosed();
    if (!syncModalScrollLock(document)) {
      $("fixtureScaleWrap").inert = false;
    }
    const prev = returnFocusMap.get(id);
    returnFocusMap.delete(id);
    if (prev?.isConnected) prev.focus({ preventScroll: true });
  };
  if (immediate || prefersReducedMotion(window)) finish();
  else {
    modal.classList.add("is-closing");
    closeTimers.set(id, setTimeout(finish, 200));
  }
}

$("btnOpenFormSheet").addEventListener("click", () => openFixtureModal("fixtureSheetModal"));
$("btnOpenConfirmDialog").addEventListener("click", () => openFixtureModal("fixtureConfirmModal"));
$("btnConfirmDangerAction").addEventListener("click", () => {
  closeFixtureModal("fixtureConfirmModal");
  showToast({ tone: "warning", message: "危险确认动作已执行（合成演示）。" }, {}, document);
  syncToastTelemetry();
});
$("fixtureSheetForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const val = $("fixtureSheetInput").value.trim() || "（空）";
  closeFixtureModal("fixtureSheetModal");
  showToast({ tone: "success", message: `Sheet 表单已保存：${val}` }, {}, document);
  syncToastTelemetry();
});

document.querySelectorAll("[data-close-fixture-modal]").forEach((btn) => {
  btn.addEventListener("click", () => closeFixtureModal(btn.dataset.closeFixtureModal));
});
document.querySelectorAll(".modal-layer").forEach((layer) => {
  layer.addEventListener("click", (event) => {
    if (event.target === layer && !layer.hasAttribute("data-confirm-only")) {
      closeFixtureModal(layer.id);
    }
  });
});
document.addEventListener("keydown", (event) => {
  const open = [...document.querySelectorAll(".modal-layer:not(.hidden)")].at(-1);
  if (!open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeFixtureModal(open.id);
    return;
  }
  if (event.key === "Tab") {
    const targets = dialogFocusTargets(open);
    if (!targets.length) { event.preventDefault(); return; }
    const first = targets[0], last = targets.at(-1);
    if (event.shiftKey && (document.activeElement === first || !open.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Toast Queue Triggers (Max 2 visible)
// ---------------------------------------------------------------------------
let toastCounter = 0;
$("btnToastInfo").addEventListener("click", () => { showToast({ tone: "info", message: `普通提示 #${++toastCounter}` }, {}, document); syncToastTelemetry(); });
$("btnToastSuccess").addEventListener("click", () => { showToast({ tone: "success", message: `保存成功 #${++toastCounter}` }, {}, document); syncToastTelemetry(); });
$("btnToastWarning").addEventListener("click", () => { showToast({ tone: "warning", message: `请注意状态 #${++toastCounter}` }, {}, document); syncToastTelemetry(); });
$("btnToastError").addEventListener("click", () => { showToast({ tone: "error", message: `关键错误 #${++toastCounter}：不会被成功消息覆盖` }, {}, document); syncToastTelemetry(); });
$("btnToastBurst5").addEventListener("click", () => {
  showToast({ tone: "error", message: "队列 #1 (Error)：保留优先提示" }, {}, document);
  showToast({ tone: "info", message: "队列 #2 (Info)：首屏第 2 条" }, {}, document);
  showToast({ tone: "success", message: "队列 #3 (Success)：排队等待" }, {}, document);
  showToast({ tone: "warning", message: "队列 #4 (Warning)：排队等待" }, {}, document);
  showToast({ tone: "info", message: "队列 #5 (Info)：排队等待" }, {}, document);
  syncToastTelemetry();
});
$("btnToastClear").addEventListener("click", () => { toastManager.clear(); syncToastTelemetry(); });

// ---------------------------------------------------------------------------
// 7. Scroll 3D Telemetry & Bento Seam Integrity Check
// ---------------------------------------------------------------------------
const bentoWall = $("fixtureBentoWall");
let baselineWallWidth = bentoWall.getBoundingClientRect().width;
let baselineWallHeight = bentoWall.getBoundingClientRect().height;
let maxSeamDrift = 0;

createScrollProgressController({
  root: document,
  doc: document,
  view: window,
  onSample({ reduced, scroll3d }) {
    const item = scroll3d[0];
    if (reduced) {
      $("scrollTelemetryBadge").textContent = "Reduced Motion · transform locked flat";
    } else if (item) {
      $("scrollTelemetryBadge").textContent =
        `${item.stage || "level"} · p ${item.progress.toFixed(2)} · rx ${item.rx.toFixed(1)}deg · scale ${item.scale.toFixed(3)} · tz ${(item.tz || 0).toFixed(0)}px`;
    }
    const wallRect = bentoWall.getBoundingClientRect();
    // Re-baseline if viewport responsive breakpoint resized the outer wall.
    if (Math.abs(wallRect.width - baselineWallWidth) > 0.5) {
      baselineWallWidth = wallRect.width;
      baselineWallHeight = wallRect.height;
    }
    const tiles = [...bentoWall.querySelectorAll(".bento-tile")];
    const heightDrift = Math.abs(wallRect.height - baselineWallHeight);
    // Verify no outer tile moves independently via transform during scroll.
    const anyOuterTransform = tiles.some((t) => getComputedStyle(t).transform !== "none");
    maxSeamDrift = Math.max(maxSeamDrift, heightDrift, anyOuterTransform ? 99 : 0);
    $("telBentoDrift").textContent = `${maxSeamDrift.toFixed(2)}px`;
  },
});

// ---------------------------------------------------------------------------
// 8. Lightweight FPS / Frame Delta Sampler
// ---------------------------------------------------------------------------
let lastFrameTime = performance.now();
let frameCount = 0;
let worstFrameMs = 0;
let longTaskCount = 0;

if (typeof PerformanceObserver === "function") {
  try {
    const po = new PerformanceObserver((list) => { longTaskCount += list.getEntries().length; });
    po.observe({ type: "longtask", buffered: true });
  } catch (_) {}
}

function sampleFrame(now) {
  const dt = now - lastFrameTime;
  lastFrameTime = now;
  frameCount += 1;
  if (frameCount > 2) worstFrameMs = Math.max(worstFrameMs, dt);
  if (frameCount % 30 === 0) {
    const fps = dt > 0 ? Math.min(120, Math.round(1000 / dt)) : 60;
    $("telPerf").textContent = `${fps} fps · max ${worstFrameMs.toFixed(1)}ms · LT ${longTaskCount}`;
  }
  requestAnimationFrame(sampleFrame);
}
requestAnimationFrame(sampleFrame);

window.__i07FixtureTelemetry = () => ({
  motionReady: document.documentElement.getAttribute("data-aeris-motion-ready"),
  reducedMotion: prefersReducedMotion(window),
  flipIdentity: $("telFlipIdentity").textContent,
  rowRebuilds,
  toast: toastManager.snapshot(),
  staleDroppedCount,
  maxSeamDrift,
  worstFrameMs,
  longTaskCount,
  scroll3dTransform: getComputedStyle($("fixtureScroll3dCard")).transform,
});
