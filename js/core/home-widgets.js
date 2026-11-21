import { getSafeStorage, safeStorageSet } from "./storage.js?release=20261121-aeris-i05-preview";
import {
  captureFlipSnapshot,
  playFlipSnapshot,
  createDragSortController,
} from "./motion.js?release=20261121-aeris-i05-preview";
import {
  HOME_WIDGET_VERSION,
  WIDGET_IDS,
  WIDGET_MODES,
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_MODULE_IDS,
  WORKSPACE_DENSITIES,
  WORKSPACE_MODULE_META,
  defaultHomeWidgets,
  sanitizeHomeWidgets,
  homeWidgetStorageKey,
  legacyHomeWidgetStorageKey,
  isHomeWidgetDesktop,
  rotatedWidgetBox,
  layoutHomeWidgets,
  layoutMobileWidgets,
  widgetGeometry,
  widgetProfile,
  defaultWorkspaceBento,
  sanitizeWorkspaceBento,
  hasFutureWorkspaceSchema,
  mergeHomeWidgetsRecord,
  visibleWorkspaceOrder,
  moveWorkspaceVisibleModule,
  applyWorkspaceVisibleOrder,
  setWorkspaceModuleHidden,
  diffWorkspaceDraftFields,
} from "./home-widget-layout.js?release=20261121-aeris-i05-preview";

export {
  HOME_WIDGET_VERSION,
  WIDGET_IDS,
  WIDGET_MODES,
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_MODULE_IDS,
  WORKSPACE_DENSITIES,
  WORKSPACE_MODULE_META,
  defaultHomeWidgets,
  sanitizeHomeWidgets,
  homeWidgetStorageKey,
  legacyHomeWidgetStorageKey,
  isHomeWidgetDesktop,
  rotatedWidgetBox,
  layoutHomeWidgets,
  layoutMobileWidgets,
  widgetGeometry,
  widgetProfile,
  defaultWorkspaceBento,
  sanitizeWorkspaceBento,
  hasFutureWorkspaceSchema,
  mergeHomeWidgetsRecord,
  visibleWorkspaceOrder,
  moveWorkspaceVisibleModule,
  applyWorkspaceVisibleOrder,
  setWorkspaceModuleHidden,
  diffWorkspaceDraftFields,
};

export const homeWidgetDragMoved = (x, y) => Math.hypot(x, y) >= 6;

const STATE_TONE = Object.freeze({
  ready: "success",
  loading: "info",
  empty: "neutral",
  restricted: "warning",
  error: "error",
});

/** Owns only authenticated workspace layout UI state, FLIP transitions, and gestures. */
export function createHomeWidgets({
  root,
  accountId,
  navigate,
  storage = getSafeStorage(),
  view = globalThis.window,
  onOpenPreview = null,
} = {}) {
  const section = root?.querySelector("#authWorkspaceSection");
  const grid = root?.querySelector("#workspaceBentoGrid");
  const cards = grid
    ? Object.fromEntries(
        WORKSPACE_MODULE_IDS.map((id) => [id, grid.querySelector(`[data-workspace-card="${id}"]`)]),
      )
    : {};
  if (!root || !section || !grid || WORKSPACE_MODULE_IDS.some((id) => !cards[id])) {
    return Object.freeze({
      render() {},
      setAccount() {},
      snapshot: () => defaultHomeWidgets(),
      getWorkspaceState: () => ({ editing: false, persistState: "idle", config: defaultWorkspaceBento() }),
      hide() {},
      dispose() {},
    });
  }

  const doc = root.ownerDocument;
  const abortController = new AbortController();
  const { signal } = abortController;

  const customizeBtn = root.querySelector("#workspaceCustomizeBtn");
  const densityBtn = root.querySelector("#workspaceDensityBtn");
  const saveBtn = root.querySelector("#workspaceSaveBtn");
  const discardBtn = root.querySelector("#workspaceDiscardBtn");
  const resetBtn = root.querySelector("#workspaceResetBtn");
  const resetEmptyBtn = root.querySelector("#resetWorkspaceEmptyBtn");
  const saveStatusEl = root.querySelector("#workspaceSaveStatus");
  const liveRegionEl = root.querySelector("#workspaceLiveRegion");
  const hiddenBarEl = root.querySelector("#hiddenWidgetsBar");
  const hiddenListEl = root.querySelector("#hiddenWidgetsList");
  const restoreAllBarBtn = root.querySelector("#restoreAllWidgetsBarBtn");
  const allHiddenEl = root.querySelector("#workspaceAllHiddenState");
  const emptyRestoreListEl = root.querySelector("#workspaceEmptyRestoreList");
  const restoreAllBtn = root.querySelector("#restoreAllWidgetsBtn");
  const undoBarEl = root.querySelector("#workspaceResetUndoBar");
  const undoResetBtn = root.querySelector("#workspaceUndoResetBtn");

  let owner = null;
  let savedRecord = defaultHomeWidgets();
  let savedConfig = defaultWorkspaceBento();
  let draftConfig = null;
  let undoResetSnapshot = null;
  let editing = false;
  let futureSchema = false;
  let persistState = "saved";
  let lastPersistMessage = "";
  let lastSnapshot = null;
  let activeFlip = null;
  let isDragging = false;
  let liveAnnouncementSeq = 0;

  const setText = (el, value) => {
    if (el && el.textContent !== String(value ?? "")) el.textContent = String(value ?? "");
  };

  function announce(message) {
    if (!liveRegionEl || !message) return;
    liveAnnouncementSeq += 1;
    // Slight suffix avoidance ensures repeated actions still announce clearly.
    liveRegionEl.textContent = "";
    const currentSeq = liveAnnouncementSeq;
    const schedule = view?.requestAnimationFrame || ((fn) => fn());
    schedule(() => {
      if (currentSeq === liveAnnouncementSeq && liveRegionEl) {
        liveRegionEl.textContent = message;
      }
    });
  }

  function activeConfig() {
    return draftConfig || savedConfig;
  }

  function cardKey(el) {
    return el?.dataset?.workspaceCard || "";
  }

  function cancelActiveFlip() {
    if (activeFlip && typeof activeFlip.cancel === "function") {
      activeFlip.cancel();
    }
    activeFlip = null;
  }

  function readAccountStorage(accountKey) {
    let parsed = null;
    if (accountKey) {
      try {
        const raw = storage?.getItem?.(homeWidgetStorageKey(accountKey)) ?? storage?.getItem?.(legacyHomeWidgetStorageKey(accountKey));
        if (raw && raw.length <= 16384) {
          parsed = JSON.parse(raw);
        }
      } catch (_) {
        parsed = null;
      }
    }
    futureSchema = hasFutureWorkspaceSchema(parsed);
    savedRecord = sanitizeHomeWidgets(parsed);
    savedConfig = sanitizeWorkspaceBento(parsed);
    if (parsed && parsed.workspace) savedRecord.workspace = savedConfig;
  }

  function tryPersist(nextWorkspace) {
    if (!owner) {
      persistState = "dirty";
      lastPersistMessage = "游客/未绑定账户状态不写入个人偏好";
      return false;
    }
    if (futureSchema) {
      persistState = "failed";
      lastPersistMessage = "检测到较新版本的布局配置，已保留原配置（未覆盖）";
      return false;
    }
    const merged = mergeHomeWidgetsRecord(savedRecord, nextWorkspace);
    let ok = false;
    try {
      const serialized = JSON.stringify(merged);
      ok = safeStorageSet(storage, homeWidgetStorageKey(owner), serialized);
    } catch (_) {
      ok = false;
    }
    if (ok) {
      savedRecord = merged;
      savedConfig = sanitizeWorkspaceBento(nextWorkspace);
      draftConfig = editing ? sanitizeWorkspaceBento(savedConfig) : null;
      persistState = "saved";
      lastPersistMessage = "已保存（按账户本地隔离）";
      return true;
    }
    persistState = "failed";
    lastPersistMessage = "保存失败：浏览器存储受限，已保留上次已保存布局";
    return false;
  }

  function syncToolbarAndStatus() {
    const current = activeConfig();
    const visible = visibleWorkspaceOrder(current);
    const hidden = current.hidden;
    const dirtyFields = draftConfig ? diffWorkspaceDraftFields(savedConfig, draftConfig) : [];
    const hasUnsaved = dirtyFields.length > 0;

    if (customizeBtn) {
      customizeBtn.setAttribute("aria-pressed", String(editing));
      setText(customizeBtn, editing ? "完成编辑" : "自定义布局");
    }
    if (densityBtn) {
      const isCompact = current.density === "compact";
      densityBtn.setAttribute("aria-pressed", String(isCompact));
      setText(densityBtn, isCompact ? "密度：紧凑单列" : "密度：舒适双列");
    }
    if (saveBtn) {
      saveBtn.hidden = !(editing || hasUnsaved || persistState === "failed");
      saveBtn.disabled = !hasUnsaved && persistState !== "failed";
      setText(saveBtn, persistState === "failed" ? "重试保存" : "保存布局");
    }
    if (discardBtn) {
      discardBtn.hidden = !(editing && hasUnsaved);
    }
    if (resetBtn) {
      resetBtn.hidden = !(editing || current.customized || hidden.length > 0);
    }
    if (undoBarEl) {
      undoBarEl.hidden = !undoResetSnapshot;
    }

    if (saveStatusEl) {
      let tone = "neutral";
      let statusText = "默认布局（本地按账户隔离）";
      if (persistState === "failed") {
        tone = "error";
        statusText = lastPersistMessage || "保存失败：已保留上次已保存布局";
      } else if (hasUnsaved) {
        tone = "warning";
        statusText = `未保存草稿：${dirtyFields.join("、")}`;
      } else if (persistState === "reset") {
        tone = "info";
        statusText = "已恢复默认布局（支持撤销）";
      } else if (savedConfig.customized) {
        tone = "success";
        statusText = "已保存 · 仅当前账户本地生效";
      }
      saveStatusEl.dataset.tone = tone;
      saveStatusEl.dataset.saveState = persistState === "failed" ? "failed" : hasUnsaved ? "dirty" : persistState;
      setText(saveStatusEl, statusText);
    }

    if (hiddenBarEl && hiddenListEl) {
      const showBar = hidden.length > 0;
      hiddenBarEl.hidden = !showBar;
      if (showBar) {
        const chips = hidden.map((id) => {
          const btn = doc.createElement("button");
          btn.type = "button";
          btn.className = "workspace-restore-chip";
          btn.dataset.workspaceRestore = id;
          btn.setAttribute("aria-label", `恢复${WORKSPACE_MODULE_META[id]?.title || id}模块`);
          btn.textContent = `+ 恢复${WORKSPACE_MODULE_META[id]?.title || id}`;
          return btn;
        });
        hiddenListEl.replaceChildren(...chips);
      } else {
        hiddenListEl.replaceChildren();
      }
      if (restoreAllBarBtn) restoreAllBarBtn.hidden = hidden.length < 2;
    }

    const allHidden = visible.length === 0;
    grid.hidden = allHidden;
    if (allHiddenEl) {
      allHiddenEl.hidden = !allHidden;
      if (allHidden && emptyRestoreListEl) {
        const emptyBtns = WORKSPACE_MODULE_IDS.filter((id) => hidden.includes(id)).map((id) => {
          const btn = doc.createElement("button");
          btn.type = "button";
          btn.className = "button-secondary workspace-restore-chip";
          btn.dataset.workspaceRestore = id;
          btn.textContent = `恢复${WORKSPACE_MODULE_META[id]?.title || id}`;
          return btn;
        });
        emptyRestoreListEl.replaceChildren(...emptyBtns);
      }
    }
  }

  function applyDomOrderAndControls(config, { flipBefore = null, duration = 300, scale = false, focusPreserve = null } = {}) {
    const visible = visibleWorkspaceOrder(config);
    const hiddenSet = new Set(config.hidden);

    grid.dataset.density = config.density;
    grid.dataset.editing = String(editing);
    section.dataset.density = config.density;
    section.dataset.editing = String(editing);

    // Move existing persistent DOM nodes without recreating or calling innerHTML.
    for (const id of config.order) {
      const card = cards[id];
      const isHidden = hiddenSet.has(id);
      card.hidden = isHidden;
      card.dataset.visibleIndex = isHidden ? "-1" : String(visible.indexOf(id));
      grid.appendChild(card);

      const controls = card.querySelector("[data-workspace-controls]");
      if (controls) controls.hidden = !editing;

      const visibleIdx = visible.indexOf(id);
      const upBtn = card.querySelector('[data-workspace-action="up"]');
      const downBtn = card.querySelector('[data-workspace-action="down"]');
      const hideBtn = card.querySelector('[data-workspace-action="hide"]');
      if (upBtn) {
        upBtn.disabled = visibleIdx <= 0;
        upBtn.setAttribute("aria-disabled", String(upBtn.disabled));
      }
      if (downBtn) {
        downBtn.disabled = visibleIdx < 0 || visibleIdx >= visible.length - 1;
        downBtn.setAttribute("aria-disabled", String(downBtn.disabled));
      }
      if (hideBtn) {
        hideBtn.disabled = false;
      }
    }

    if (focusPreserve && doc) {
      const { cardId, preferAction } = focusPreserve;
      const targetCard = cards[cardId];
      if (targetCard && !targetCard.hidden) {
        const candidate = preferAction === "drag-handle"
          ? targetCard.querySelector("[data-workspace-drag-handle]")
          : preferAction
            ? targetCard.querySelector(`[data-workspace-action="${preferAction}"]`)
            : null;
        const fallback = targetCard.querySelector('[data-workspace-action="down"]:not(:disabled), [data-workspace-action="up"]:not(:disabled), [data-workspace-drag-handle]');
        const nextFocus = candidate && !candidate.disabled ? candidate : fallback;
        if (nextFocus && doc.activeElement !== nextFocus) {
          nextFocus.focus({ preventScroll: true });
        }
      }
    }

    syncToolbarAndStatus();

    if (flipBefore) {
      cancelActiveFlip();
      activeFlip = playFlipSnapshot(grid, flipBefore, {
        selector: ".workspace-bento-card:not([hidden])",
        getKey: cardKey,
        duration,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        scale,
        animateEnter: false,
        view,
      });
    }
  }

  function mutateWorkspace(updater, { flip = true, flipDuration = 300, flipScale = false, autoPersist = !editing, focusPreserve = null, announceText = "" } = {}) {
    if (editing && !draftConfig) {
      draftConfig = sanitizeWorkspaceBento(savedConfig);
    }
    const base = sanitizeWorkspaceBento(activeConfig());
    const next = sanitizeWorkspaceBento(updater(base));
    undoResetSnapshot = null;

    const before = flip
      ? captureFlipSnapshot(grid, { selector: ".workspace-bento-card:not([hidden])", getKey: cardKey })
      : null;

    if (editing) {
      draftConfig = next;
      const dirtyFields = diffWorkspaceDraftFields(savedConfig, draftConfig);
      if (autoPersist) {
        tryPersist(draftConfig);
      } else {
        persistState = dirtyFields.length ? "dirty" : "saved";
      }
    } else if (autoPersist) {
      const ok = tryPersist(next);
      if (!ok) {
        draftConfig = next;
      }
    } else {
      draftConfig = next;
      persistState = "dirty";
    }

    applyDomOrderAndControls(activeConfig(), {
      flipBefore: before,
      duration: flipDuration,
      scale: flipScale,
      focusPreserve,
    });
    if (announceText) announce(announceText);
  }

  function paintCardTone(id, tone, statusText) {
    const card = cards[id];
    const badge = card?.querySelector(`[data-ws-status="${id}"]`);
    if (card) card.dataset.stateTone = tone || "neutral";
    if (badge) {
      badge.dataset.tone = STATE_TONE[tone] || "neutral";
      setText(badge, statusText || "");
    }
  }

  function paint(snapshot) {
    if (!snapshot) return;
    const docData = snapshot;

    // 1. Learning
    const lLatest = docData.learning?.modes?.latest || {};
    const lStreak = docData.learning?.modes?.streak || {};
    const lWrong = docData.learning?.modes?.wrong || {};
    paintCardTone("learning", lLatest.state || "empty", lLatest.status || "学习记录");
    setText(cards.learning.querySelector("[data-ws-value]"), lLatest.value || "暂无记录");
    setText(cards.learning.querySelector("[data-ws-detail]"), lLatest.detail || "完成测试后显示进度");
    setText(
      cards.learning.querySelector("[data-ws-extra]"),
      `${lStreak.value || "0 天"} 连续 · 错题 ${lWrong.value || "0 个"}${docData.learning?.extra ? ` · ${docData.learning.extra}` : ""}`,
    );

    // 2. Finance
    const fBal = docData.finance?.modes?.balance || {};
    paintCardTone("finance", fBal.state || "loading", fBal.status || "账户账本");
    setText(cards.finance.querySelector("[data-ws-value]"), fBal.value || "尚未读取");
    setText(cards.finance.querySelector("[data-ws-detail]"), fBal.detail || "本月收支余额");
    setText(cards.finance.querySelector("[data-ws-extra]"), docData.finance?.extra || "打开账本查看真实收支。");

    // 3. Tools
    const tRecent = docData.tools?.modes?.recent || {};
    paintCardTone("tools", tRecent.state || "empty", tRecent.status || "工具箱");
    setText(cards.tools.querySelector("[data-ws-value]"), tRecent.value || "暂无最近工具");
    setText(cards.tools.querySelector("[data-ws-detail]"), tRecent.detail || "本机实用工具即开即用");
    setText(cards.tools.querySelector("[data-ws-extra]"), docData.tools?.extra || "0 项收藏 · 0 项最近使用");
    const continueBtn = cards.tools.querySelector("[data-workspace-tool-continue]");
    if (continueBtn) {
      continueBtn.hidden = !docData.tools?.continuePath;
      continueBtn.dataset.workspaceRoute = docData.tools?.continuePath || "/tools";
    }

    // 4. Transfer
    const tr = docData.transfer || {};
    paintCardTone("transfer", tr.state || "loading", tr.status || "文件传输");
    setText(cards.transfer.querySelector("[data-ws-value]"), tr.value || "尚未读取");
    setText(cards.transfer.querySelector("[data-ws-detail]"), tr.detail || "仅展示当前账户传输与分享");
    setText(cards.transfer.querySelector("[data-ws-extra]"), tr.state === "restricted" ? "受权限约束 · 升级后可用" : "传输文件须经本人显式确认后上传");

    // 5. Activity
    const actList = cards.activity.querySelector("#workspaceActivityList");
    const items = Array.isArray(docData.activity) ? docData.activity : [];
    const pendingNotes = docData.account?.pendingNotifications;
    paintCardTone(
      "activity",
      items.length ? "ready" : "empty",
      pendingNotes !== null && pendingNotes !== undefined ? `待核实通知 ${pendingNotes}` : "动态与通知",
    );
    setText(
      cards.activity.querySelector("[data-ws-value]"),
      items.length ? `${items.length} 条近期记录` : "暂无近期活动",
    );
    setText(
      cards.activity.querySelector("[data-ws-detail]"),
      items.length ? items[0].label : "完成学习或使用工具后自动汇总",
    );
    if (actList) {
      const rendered = (items.length ? items.slice(0, 3) : [{ label: "暂无近期学习或工具动态。" }]).map((entry) => {
        const li = doc.createElement("li");
        li.textContent = entry.label;
        return li;
      });
      actList.replaceChildren(...rendered);
    }

    // 6. Account & Services
    const acc = docData.account || {};
    paintCardTone("account", acc.state || "ready", acc.status || "在线");
    setText(cards.account.querySelector("[data-ws-value]"), acc.memberName || "基础账户");
    setText(cards.account.querySelector("[data-ws-detail]"), acc.memberExpiry || "账户会员与权益状态");
    setText(cards.account.querySelector("[data-ws-extra]"), acc.entitlementsSummary || "查看账户安全、备份与隐私控制");
  }

  function setAccount() {
    const next = String(accountId?.() || "");
    if (next === owner) return;
    dragSort.cancel();
    cancelActiveFlip();
    editing = false;
    draftConfig = null;
    undoResetSnapshot = null;
    owner = next;
    persistState = "saved";
    lastPersistMessage = "";
    readAccountStorage(owner);
    applyDomOrderAndControls(savedConfig);
  }

  function render(snapshot) {
    setAccount();
    lastSnapshot = snapshot || lastSnapshot;
    if (lastSnapshot) paint(lastSnapshot);
  }

  function toggleEditMode(forceState = null) {
    if (editing && forceState !== true) {
      // Finishing edit mode commits draft cleanly; stay open if save fails!
      const dirty = draftConfig ? diffWorkspaceDraftFields(savedConfig, draftConfig) : [];
      if (dirty.length > 0 || persistState === "failed") {
        const ok = tryPersist(draftConfig || savedConfig);
        if (!ok) {
          applyDomOrderAndControls(activeConfig());
          announce("保存失败，仍处于编辑模式。");
          return;
        }
      }
      editing = false;
      draftConfig = null;
      applyDomOrderAndControls(savedConfig);
      announce("已退出自定义布局模式。");
      return;
    }
    editing = true;
    draftConfig = sanitizeWorkspaceBento(activeConfig());
    applyDomOrderAndControls(draftConfig);
    announce("已进入自定义布局模式，可拖动、使用箭头按钮、键盘方向键排序或隐藏模块。");
  }

  function handleReset() {
    const beforeSnapshot = sanitizeWorkspaceBento(activeConfig());
    const defaults = defaultWorkspaceBento();
    const flipBefore = captureFlipSnapshot(grid, { selector: ".workspace-bento-card:not([hidden])", getKey: cardKey });
    const didPersist = tryPersist(defaults);
    if (didPersist) {
      persistState = "reset";
      undoResetSnapshot = beforeSnapshot.customized ? beforeSnapshot : null;
      draftConfig = editing ? sanitizeWorkspaceBento(defaults) : null;
    } else {
      undoResetSnapshot = beforeSnapshot;
      draftConfig = defaults;
    }
    applyDomOrderAndControls(activeConfig(), { flipBefore, duration: 320, scale: false });
    announce("工作台已恢复默认布局，可随时撤销。");
  }

  function handleUndoReset() {
    if (!undoResetSnapshot) return;
    const restored = sanitizeWorkspaceBento(undoResetSnapshot);
    undoResetSnapshot = null;
    const flipBefore = captureFlipSnapshot(grid, { selector: ".workspace-bento-card:not([hidden])", getKey: cardKey });
    const didPersist = tryPersist(restored);
    if (!didPersist) draftConfig = restored;
    applyDomOrderAndControls(activeConfig(), { flipBefore, duration: 300 });
    announce("已撤销重置，恢复自定义布局。");
  }

  const dragSort = createDragSortController(grid, {
    itemSelector: ".workspace-bento-card:not([hidden])",
    handleSelector: "[data-workspace-drag-handle]",
    getKey: cardKey,
    axis: "auto",
    threshold: 6,
    view,
    onDragStateChange: ({ dragging, cancelled, committed, key }) => {
      isDragging = dragging;
      if (cancelled) {
        const cardTitle = WORKSPACE_MODULE_META[key]?.title || key;
        announce(`已取消拖动${cardTitle}，恢复原位置。`);
      } else if (dragging) {
        const cardTitle = WORKSPACE_MODULE_META[key]?.title || key;
        announce(`正在移动${cardTitle}。`);
      } else if (!committed && !dragging) {
        grid.removeAttribute("data-drag-active");
      }
    },
    onOrderChange: (visibleKeys, info = {}) => {
      if (!editing) return;
      const activeCardId = info.movedKey || info.key || "";
      const movedTitle = WORKSPACE_MODULE_META[activeCardId]?.title || "模块";
      mutateWorkspace(
        (cfg) => applyWorkspaceVisibleOrder(cfg, visibleKeys),
        {
          flip: false,
          autoPersist: false,
          focusPreserve: info.trigger === "keyboard" && activeCardId ? { cardId: activeCardId, preferAction: "drag-handle" } : null,
          announceText: info.trigger === "keyboard" ? `${movedTitle}已移动到第 ${(info.index ?? 0) + 1} 位` : `${movedTitle}位置已更新`,
        },
      );
    },
  });

  // Cancel any pointer drag safely if window loses focus.
  view?.addEventListener?.("blur", () => {
    if (isDragging) dragSort.cancel();
  }, { signal });

  root.addEventListener("click", (event) => {
    const target = event.target;

    if (target.closest("#workspaceCustomizeBtn")) {
      toggleEditMode();
      return;
    }

    if (target.closest("#workspaceSaveBtn")) {
      const ok = tryPersist(activeConfig());
      applyDomOrderAndControls(activeConfig());
      announce(ok ? "工作台布局已保存。" : "工作台布局保存失败，已保留原配置。");
      return;
    }

    if (target.closest("#workspaceDiscardBtn")) {
      const before = captureFlipSnapshot(grid, { selector: ".workspace-bento-card:not([hidden])", getKey: cardKey });
      draftConfig = sanitizeWorkspaceBento(savedConfig);
      persistState = "saved";
      undoResetSnapshot = null;
      applyDomOrderAndControls(savedConfig, { flipBefore: before, duration: 280 });
      announce("已放弃未保存的布局草稿。");
      return;
    }

    if (target.closest("#workspaceDensityBtn")) {
      const nextDensity = activeConfig().density === "compact" ? "comfortable" : "compact";
      mutateWorkspace(
        (cfg) => ({ ...cfg, density: nextDensity, customized: true }),
        {
          flip: true,
          flipDuration: 340,
          flipScale: true,
          autoPersist: !editing,
          announceText: nextDensity === "compact" ? "已切换为紧凑单列视图" : "已切换为舒适双列视图",
        },
      );
      return;
    }

    if (target.closest("#workspaceResetBtn") || target.closest("#resetWorkspaceEmptyBtn")) {
      handleReset();
      return;
    }

    if (target.closest("#workspaceUndoResetBtn")) {
      handleUndoReset();
      return;
    }

    const restoreAllTrigger = target.closest("#restoreAllWidgetsBtn, #restoreAllWidgetsBarBtn");
    if (restoreAllTrigger) {
      mutateWorkspace(
        (cfg) => ({ ...cfg, hidden: [], customized: true }),
        {
          flip: true,
          flipDuration: 300,
          autoPersist: !editing,
          announceText: "已恢复全部工作台模块",
        },
      );
      return;
    }

    const restoreChip = target.closest("[data-workspace-restore]");
    if (restoreChip) {
      const id = restoreChip.dataset.workspaceRestore;
      mutateWorkspace(
        (cfg) => setWorkspaceModuleHidden(cfg, id, false),
        {
          flip: true,
          flipDuration: 300,
          autoPersist: !editing,
          announceText: `已恢复${WORKSPACE_MODULE_META[id]?.title || id}模块`,
        },
      );
      return;
    }

    const actionBtn = target.closest("[data-workspace-action]");
    if (actionBtn) {
      const card = actionBtn.closest("[data-workspace-card]");
      const id = card?.dataset?.workspaceCard;
      const action = actionBtn.dataset.workspaceAction;
      if (!id || !editing) return;
      if (action === "up" || action === "down") {
        const delta = action === "up" ? -1 : 1;
        mutateWorkspace(
          (cfg) => moveWorkspaceVisibleModule(cfg, id, delta),
          {
            flip: true,
            flipDuration: 300,
            autoPersist: false,
            focusPreserve: { cardId: id, preferAction: action },
            announceText: `${WORKSPACE_MODULE_META[id]?.title || id}${action === "up" ? "上移" : "下移"}`,
          },
        );
      } else if (action === "hide") {
        mutateWorkspace(
          (cfg) => setWorkspaceModuleHidden(cfg, id, true),
          {
            flip: true,
            flipDuration: 280,
            autoPersist: false,
            announceText: `已隐藏${WORKSPACE_MODULE_META[id]?.title || id}，可在上方栏恢复`,
          },
        );
      }
      return;
    }

    const previewBtn = target.closest("[data-workspace-preview]");
    if (previewBtn) {
      const id = previewBtn.dataset.workspacePreview;
      onOpenPreview?.(id, previewBtn);
      return;
    }

    const routeBtn = target.closest("[data-workspace-route]");
    if (routeBtn) {
      if (routeBtn.tagName === "A") event.preventDefault();
      navigate?.(routeBtn.dataset.workspaceRoute || routeBtn.getAttribute("href"));
    }
  }, { signal });

  setAccount();

  return Object.freeze({
    render,
    setAccount,
    snapshot: () => sanitizeHomeWidgets(savedRecord),
    getWorkspaceState: () => ({
      owner,
      editing,
      persistState,
      saved: sanitizeWorkspaceBento(savedConfig),
      draft: draftConfig ? sanitizeWorkspaceBento(draftConfig) : null,
      visibleOrder: visibleWorkspaceOrder(activeConfig()),
    }),
    hide: () => {
      dragSort.cancel();
      cancelActiveFlip();
    },
    dispose: () => {
      dragSort.dispose();
      cancelActiveFlip();
      abortController.abort();
    },
  });
}
