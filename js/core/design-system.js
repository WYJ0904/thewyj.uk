const PUBLIC_MODE = "public";
const WORKSPACE_MODE = "workspace";
const THEME_STORAGE_KEY = "wyj_theme_preference_v1";
const THEME_ORDER = Object.freeze(["system", "light", "dark"]);

let navigationController = null;
let interfaceEnhancementsEnabled = false;
let refreshContentPolicy = () => {};
let resetFormFeedback = () => {};
let syncThemeMeta = () => {};

/** Validated Task25 UI policy (account or guest) is the only activation source. */
export function setInterfaceEnhancementsEnabled(enabled) {
  // A reviewed fallback build may restrict presentation, never grant rights.
  // Task25/account policy remains the sole source that can enable the UI.
  const legacyBuild = document.querySelector?.('meta[name="aeris-p07-presentation"]')?.content === 'legacy';
  interfaceEnhancementsEnabled = enabled === true && !legacyBuild;
  document.documentElement.dataset.p07Ui = interfaceEnhancementsEnabled ? "enabled" : "disabled";
  if (!interfaceEnhancementsEnabled) resetFormFeedback();
  refreshContentPolicy();
  syncThemeMeta();
  syncSidebarActiveIndicator(globalThis.document);
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => syncSidebarActiveIndicator(globalThis.document));
  }
  return interfaceEnhancementsEnabled;
}

export function syncSystemNoticeLayout(doc = globalThis.document) {
  if (!doc?.documentElement) return;
  const root = doc.documentElement;
  const view = doc.defaultView || globalThis.window;
  const viewport = view?.visualViewport;
  const innerH = Number(view?.innerHeight) || 0;
  const innerW = Number(view?.innerWidth) || 0;
  const vpH = Number(viewport?.height) || innerH;
  const vpTop = Number(viewport?.offsetTop) || 0;
  const kbInset = innerH > 0 ? Math.max(0, Math.round(innerH - (vpH + vpTop))) : 0;
  root.style.setProperty("--ds-hud-keyboard-inset", `${kbInset}px`);

  const saveEl = doc.getElementById("siteMessageSaveStatus");
  let saveOffset = 0;
  if (saveEl && !saveEl.classList?.contains("hidden") && !saveEl.hidden) {
    const style = view?.getComputedStyle?.(saveEl);
    if (!style || style.position === "fixed") {
      const h = Math.ceil(saveEl.getBoundingClientRect?.().height || 0);
      if (h > 0) saveOffset = h + 10;
    }
  }
  root.style.setProperty("--ds-hud-save-offset", `${saveOffset}px`);

  const verEl = doc.getElementById("versionNotice");
  let versionOffset = 0;
  if (verEl && !verEl.classList?.contains("hidden") && !verEl.hidden) {
    const style = view?.getComputedStyle?.(verEl);
    if (!style || style.position === "fixed") {
      const h = Math.ceil(verEl.getBoundingClientRect?.().height || 0);
      if (h > 0) versionOffset = h;
    }
  }
  root.style.setProperty("--ds-hud-version-offset", `${versionOffset}px`);

  const financeModal = doc.getElementById("financeTransactionModal");
  const rightDrawerOpen = Boolean(
    financeModal
    && !financeModal.classList?.contains("hidden")
    && financeModal.getAttribute?.("aria-hidden") !== "true"
    && innerW > 760,
  );
  if (rightDrawerOpen) root.dataset.rightDrawerOpen = "true";
  else delete root.dataset.rightDrawerOpen;
}

function setupOverlayViewport() {
  // Keep every modal outside page stacking contexts and the inert main shell.
  document.querySelectorAll(".modal-layer").forEach((layer) => document.body.append(layer));
  const update = () => {
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    const top = viewport?.offsetTop || 0;
    document.documentElement.style.setProperty("--ds-overlay-height", `${height}px`);
    document.documentElement.style.setProperty("--ds-overlay-top", `${top}px`);
    const navBottom = document.getElementById("accountBar")?.getBoundingClientRect().bottom || 0;
    document.documentElement.style.setProperty("--ds-menu-height", `${Math.max(44, height + top - navBottom - 16)}px`);
    // Reflow the decorative widget composition when the user enlarges text.
    // The default 16px appearance is unchanged; the user's font size is retained.
    document.documentElement.dataset.largeText = String(parseFloat(getComputedStyle(document.documentElement).fontSize) > 20);
    syncSystemNoticeLayout(document);
  };
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; update(); });
  };
  update();
  window.addEventListener("resize", schedule, { passive: true });
  window.visualViewport?.addEventListener("resize", schedule, { passive: true });
  window.visualViewport?.addEventListener("scroll", schedule, { passive: true });
  const navigation = document.getElementById("accountBar");
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  if (navigation && resizeObserver) resizeObserver.observe(navigation);
  const verEl = document.getElementById("versionNotice");
  const saveEl = document.getElementById("siteMessageSaveStatus");
  if (resizeObserver) {
    if (verEl) resizeObserver.observe(verEl);
    if (saveEl) resizeObserver.observe(saveEl);
  }
  if (typeof MutationObserver === "function") {
    const obs = new MutationObserver(schedule);
    [verEl, saveEl, document.getElementById("financeTransactionModal")].filter(Boolean).forEach((el) => {
      obs.observe(el, { attributes: true, attributeFilter: ["class", "hidden", "aria-hidden"] });
    });
  }
}

/** Use the same focusable set for dialog entry, nested dialogs and Tab wrapping. */
export function dialogFocusTargets(modal) {
  return [...modal.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex], [contenteditable="true"]')]
    .filter((element) => !element.matches(':disabled, input[type="hidden"]')
      && element.tabIndex >= 0 && !element.closest('[inert], [aria-hidden="true"]')
      && element.getClientRects().length && getComputedStyle(element).visibility === "visible");
}

export function focusDialog(modal) {
  const targets = dialogFocusTargets(modal);
  const preferred = targets.find((element) => element.hasAttribute("data-dialog-initial-focus"));
  const panel = modal.querySelector('[role="dialog"], [role="alertdialog"]') || modal;
  if (!targets.length) panel.setAttribute("tabindex", "-1");
  (preferred || targets[0] || panel).focus({ preventScroll: true });
}

function readThemePreference() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_ORDER.includes(stored) ? stored : "system";
  } catch (_) {
    return "system";
  }
}

function setupTheme() {
  const button = document.getElementById("themeToggleBtn");
  const label = document.getElementById("themeToggleLabel");
  const menuButton = document.getElementById("sidebarThemeMenuBtn");
  const menuLabel = document.getElementById("sidebarThemeMenuLabel");
  const guestButton = document.getElementById("sidebarGuestThemeBtn");
  const guestLabel = document.getElementById("sidebarGuestThemeLabel");
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  let preference = readThemePreference();

  const updateMeta = (resolved) => {
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.content = resolved === "dark" ? "#212121" : "#fafafa";
    }
  };

  const apply = () => {
    const resolved = preference === "system" ? (colorScheme?.matches ? "dark" : "light") : preference;
    const root = document.documentElement;
    root.dataset.themeSwitching = "true";
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    const visibleLabel = { system: "系统", light: "浅色", dark: "深色" }[preference];
    const description = `外观：${visibleLabel}`;
    if (label) label.textContent = visibleLabel;
    if (menuLabel) menuLabel.textContent = `外观：${visibleLabel}（点击切换）`;
    if (guestLabel) guestLabel.textContent = description;
    [button, menuButton, guestButton].forEach((node) => {
      if (!node) return;
      node.dataset.themePreference = preference;
      node.setAttribute("aria-label", `${description}，点击切换`);
      if (node === button) node.title = `${description}，点击切换`;
    });
    updateMeta(resolved);
    // Native shell follows the web preference: one theme source of truth.
    document.dispatchEvent(new CustomEvent("wyj:theme-changed", { detail: { preference, resolved } }));
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        delete root.dataset.themeSwitching;
      });
    });
  };
  syncThemeMeta = () => {
    const resolved = document.documentElement.dataset.theme || "light";
    updateMeta(resolved);
  };

  const cycleTheme = () => {
    preference = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length];
    try { window.localStorage.setItem(THEME_STORAGE_KEY, preference); } catch (_) { /* Appearance remains usable in memory. */ }
    apply();
  };

  [button, menuButton, guestButton].forEach((node) => node?.addEventListener("click", cycleTheme));
  colorScheme?.addEventListener?.("change", () => {
    if (preference === "system") apply();
  });
  apply();
}

const SIDEBAR_COLLAPSED_KEY = "wyj_sidebar_collapsed_v1";

function readSidebarCollapsedPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch (_) {
    return false;
  }
}

function setupNavigation() {
  const navigation = document.getElementById("accountBar");
  const toggle = document.getElementById("siteNavToggle");
  const sidebar = document.getElementById("v3Sidebar");
  const collapseBtn = document.getElementById("sidebarCollapseBtn");
  const backdrop = document.getElementById("v3SidebarBackdrop");
  const tooltipEl = document.getElementById("v3SidebarTooltip");
  const accountMenu = document.getElementById("accountMenu");
  if (!sidebar) return null;

  const isDesktopLayout = () => window.matchMedia?.("(min-width: 981px)")?.matches ?? window.innerWidth >= 981;
  let desktopCollapsed = readSidebarCollapsedPreference();
  let drawerOpen = false;
  let tooltipTimer = 0;

  const hideTooltip = () => {
    window.clearTimeout(tooltipTimer);
    if (!tooltipEl) return;
    tooltipEl.hidden = true;
    tooltipEl.setAttribute("aria-hidden", "true");
    tooltipEl.dataset.open = "false";
  };

  const showTooltipFor = (target) => {
    if (!tooltipEl || !isDesktopLayout() || !desktopCollapsed || !target) return;
    const text = target.getAttribute("data-v3-tooltip") || target.getAttribute("aria-label") || "";
    if (!text.trim()) return;
    window.clearTimeout(tooltipTimer);
    const rect = target.getBoundingClientRect();
    tooltipEl.textContent = text;
    tooltipEl.hidden = false;
    tooltipEl.setAttribute("aria-hidden", "false");
    const top = Math.max(8, Math.min(window.innerHeight - 40, Math.round(rect.top + rect.height / 2 - 16)));
    const left = Math.min(window.innerWidth - 180, Math.round(rect.right + 10));
    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.left = `${left}px`;
    tooltipEl.dataset.open = "true";
  };

  const positionAccountPopover = () => {
    const popover = document.getElementById("accountMenuPopover");
    const summary = accountMenu?.querySelector("summary");
    if (!popover || !summary || !accountMenu?.open) return;
    const rect = summary.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    popover.style.position = "fixed";
    popover.style.top = "auto";
    if (isDesktopLayout() && desktopCollapsed) {
      popover.dataset.placement = "right-end";
      const left = Math.min(vw - 240, Math.round(rect.right + 10));
      const bottom = Math.max(8, Math.round(vh - rect.bottom));
      popover.style.left = `${left}px`;
      popover.style.right = "auto";
      popover.style.bottom = `${bottom}px`;
      popover.style.width = "228px";
    } else {
      popover.dataset.placement = "top-start";
      const width = Math.max(224, Math.min(vw - 24, Math.round(rect.width)));
      const left = Math.max(8, Math.min(vw - width - 8, Math.round(rect.left)));
      const bottom = Math.max(8, Math.round(vh - rect.top + 8));
      popover.style.left = `${left}px`;
      popover.style.right = "auto";
      popover.style.bottom = `${bottom}px`;
      popover.style.width = `${width}px`;
    }
    const maxAvail = Math.max(180, Math.round(vh - (parseFloat(popover.style.bottom) || 64) - 12));
    popover.style.maxHeight = `${maxAvail}px`;
  };

  let popoverCloseTimer = 0;
  let popoverGeneration = 0;
  const openAccountPopover = () => {
    const popover = document.getElementById("accountMenuPopover");
    popoverGeneration += 1;
    const gen = popoverGeneration;
    window.clearTimeout(popoverCloseTimer);
    popoverCloseTimer = 0;
    if (popover) delete popover.dataset.closing;
    if (!accountMenu) return;
    accountMenu.open = true;
    positionAccountPopover();
    if (popover) {
      popover.dataset.open = "false";
      window.requestAnimationFrame(() => {
        if (gen === popoverGeneration && accountMenu.open && popover.dataset.closing !== "true") {
          popover.dataset.open = "true";
        }
      });
    }
    accountMenu.querySelector("summary")?.setAttribute("aria-expanded", "true");
  };
  const closeAccountPopover = ({ immediate = false } = {}) => {
    if (!accountMenu?.open) return;
    const popover = document.getElementById("accountMenuPopover");
    popoverGeneration += 1;
    const gen = popoverGeneration;
    window.clearTimeout(popoverCloseTimer);
    popoverCloseTimer = 0;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    if (immediate || reduced || !popover) {
      if (popover) {
        delete popover.dataset.closing;
        popover.dataset.open = "false";
      }
      accountMenu.open = false;
      accountMenu.querySelector("summary")?.setAttribute("aria-expanded", "false");
      return;
    }
    popover.dataset.open = "false";
    popover.dataset.closing = "true";
    popoverCloseTimer = window.setTimeout(() => {
      popoverCloseTimer = 0;
      if (gen !== popoverGeneration) return;
      delete popover.dataset.closing;
      accountMenu.open = false;
      accountMenu.querySelector("summary")?.setAttribute("aria-expanded", "false");
    }, 170);
  };

  const applySidebarState = () => {
    const desktop = isDesktopLayout();
    const effectiveCollapsed = desktop && desktopCollapsed;
    sidebar.dataset.collapsed = effectiveCollapsed ? "true" : "false";
    document.body.dataset.sidebarCollapsed = effectiveCollapsed ? "true" : "false";
    if (collapseBtn) {
      collapseBtn.setAttribute("aria-expanded", String(!effectiveCollapsed));
      collapseBtn.setAttribute("aria-label", effectiveCollapsed ? "展开侧边栏" : "折叠侧边栏");
      collapseBtn.title = effectiveCollapsed ? "展开侧边栏" : "折叠侧边栏";
    }
    if (desktop && drawerOpen) {
      setDrawerOpen(false);
    }
    if (!effectiveCollapsed) hideTooltip();
    window.requestAnimationFrame(() => syncSidebarActiveIndicator(document));
  };

  sidebar.addEventListener("transitionend", (event) => {
    if (event.target === sidebar && event.propertyName === "width") {
      syncSidebarActiveIndicator(document);
    }
  });

  let drawerHideTimer = 0;
  const setDrawerOpen = (open, { restoreFocus = false } = {}) => {
    const next = Boolean(open) && !isDesktopLayout();
    drawerOpen = next;
    window.clearTimeout(drawerHideTimer);
    sidebar.style.removeProperty("transform");
    sidebar.style.removeProperty("transition");
    sidebar.classList.toggle("mobile-drawer-open", next);
    document.body.classList.toggle("v3-mobile-drawer-open", next);
    if (navigation) navigation.classList.toggle("nav-open", next);
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(next));
      toggle.setAttribute("aria-label", next ? "关闭侧边栏导航" : "打开侧边栏导航");
    }
    if (backdrop) {
      const wasVisible = !backdrop.hidden || backdrop.dataset.open === "true";
      backdrop.style.removeProperty("opacity");
      backdrop.style.removeProperty("transition");
      backdrop.setAttribute("aria-hidden", String(!next));
      backdrop.dataset.open = String(next);
      if (next) {
        backdrop.hidden = false;
      } else {
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
        if (!wasVisible || reduced || isDesktopLayout()) {
          backdrop.hidden = true;
        } else {
          backdrop.hidden = false;
          drawerHideTimer = window.setTimeout(() => { if (!drawerOpen) backdrop.hidden = true; }, 270);
        }
      }
    }
    if (next && accountMenu?.open) closeAccountPopover({ immediate: true });
    if (!next && restoreFocus) toggle?.focus();
  };

  collapseBtn?.addEventListener("click", () => {
    if (!isDesktopLayout()) {
      setDrawerOpen(false, { restoreFocus: true });
      return;
    }
    desktopCollapsed = !desktopCollapsed;
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(desktopCollapsed)); } catch (_) { /* Keep in memory. */ }
    if (accountMenu?.open) closeAccountPopover({ immediate: true });
    applySidebarState();
  });

  toggle?.addEventListener("click", () => setDrawerOpen(!drawerOpen));
  backdrop?.addEventListener("click", () => setDrawerOpen(false, { restoreFocus: true }));

  sidebar.addEventListener("click", (event) => {
    if (!isDesktopLayout() && event.target.closest("[data-v3-nav], [data-site-nav], #v3CmdTrigger")) {
      setDrawerOpen(false);
    }
  });

  sidebar.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.("[data-v3-tooltip]");
    if (!target || !sidebar.contains(target)) { hideTooltip(); return; }
    showTooltipFor(target);
  });
  sidebar.addEventListener("pointerout", (event) => {
    const from = event.target.closest?.("[data-v3-tooltip]");
    const to = event.relatedTarget?.closest?.("[data-v3-tooltip]");
    if (from && from !== to) hideTooltip();
  });
  sidebar.addEventListener("focusin", (event) => {
    const target = event.target.closest?.("[data-v3-tooltip]");
    if (target && sidebar.contains(target)) showTooltipFor(target);
  });
  sidebar.addEventListener("focusout", (event) => {
    if (!event.relatedTarget || !sidebar.contains(event.relatedTarget)) hideTooltip();
  });

  document.addEventListener("pointerdown", (event) => {
    if (drawerOpen && !sidebar.contains(event.target) && !toggle?.contains(event.target)) {
      setDrawerOpen(false);
    }
    if (accountMenu?.open && !accountMenu.contains(event.target)) {
      closeAccountPopover();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideTooltip();
      if (drawerOpen) {
        event.preventDefault();
        setDrawerOpen(false, { restoreFocus: true });
      }
    }
  });

  window.addEventListener("popstate", () => {
    if (drawerOpen && !isDesktopLayout()) {
      setDrawerOpen(false);
    }
  });

  // Edge swipe gesture with continuous drag progress for mobile slide-in drawer.
  let swipeTracking = false;
  let swipeMode = "";
  let swipeDragging = false;
  let startX = 0;
  let startY = 0;
  let lastDx = 0;
  const drawerWidthPx = () => Math.max(220, Math.round(sidebar.getBoundingClientRect().width || Math.min(window.innerWidth * 0.82, 300)));
  const hasHorizontalScroller = (node) => {
    let cur = node;
    while (cur && cur !== document.body) {
      if (cur.nodeType === 1) {
        if (cur.matches?.("[data-horizontal-scroll], .ds-segmented, .tools-tabs, pre, table, input[type='range']")) return true;
        if (cur.scrollWidth > cur.clientWidth + 6 && cur !== sidebar) {
          const ov = window.getComputedStyle(cur).overflowX;
          if (ov === "auto" || ov === "scroll") return true;
        }
      }
      cur = cur.parentElement;
    }
    return false;
  };
  document.addEventListener("touchstart", (event) => {
    swipeTracking = false;
    swipeDragging = false;
    lastDx = 0;
    if (isDesktopLayout() || event.touches.length !== 1) return;
    if (document.querySelector(".modal-layer:not(.hidden)")) return;
    const touch = event.touches[0];
    if (!drawerOpen && touch.clientX <= 28 && !hasHorizontalScroller(event.target)) {
      swipeTracking = true; swipeMode = "open"; startX = touch.clientX; startY = touch.clientY;
    } else if (drawerOpen) {
      swipeTracking = true; swipeMode = "close"; startX = touch.clientX; startY = touch.clientY;
    }
  }, { passive: true });
  document.addEventListener("touchmove", (event) => {
    if (!swipeTracking || !event.touches.length || isDesktopLayout()) return;
    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (!swipeDragging) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
        swipeTracking = false;
        return;
      }
      if (Math.abs(dx) < 10) return;
      swipeDragging = true;
      sidebar.style.transition = "none";
      sidebar.style.visibility = "visible";
      if (backdrop) {
        backdrop.hidden = false;
        backdrop.style.transition = "none";
      }
    }
    lastDx = dx;
    const width = drawerWidthPx();
    const progress = swipeMode === "open"
      ? Math.max(0, Math.min(1, dx / width))
      : Math.max(0, Math.min(1, 1 + dx / width));
    sidebar.style.transform = `translate3d(${Math.round((progress - 1) * 100)}%, 0, 0)`;
    if (backdrop) backdrop.style.opacity = String(progress.toFixed(3));
  }, { passive: true });
  document.addEventListener("touchend", (event) => {
    if (!swipeTracking || !event.changedTouches.length) return;
    const wasDragging = swipeDragging;
    swipeTracking = false;
    swipeDragging = false;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    sidebar.style.removeProperty("transition");
    sidebar.style.removeProperty("transform");
    if (!wasDragging) {
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      if (swipeMode === "open" && dx > 48) setDrawerOpen(true);
      else if (swipeMode === "close" && dx < -48) setDrawerOpen(false, { restoreFocus: true });
      return;
    }
    const width = drawerWidthPx();
    const shouldOpen = swipeMode === "open" ? lastDx > Math.min(72, width * 0.28) : lastDx > -Math.min(72, width * 0.28);
    setDrawerOpen(shouldOpen, { restoreFocus: !shouldOpen });
  }, { passive: true });

  window.addEventListener("resize", () => {
    applySidebarState();
    positionAccountPopover();
  }, { passive: true });

  setDrawerOpen(false);
  applySidebarState();

  const summary = accountMenu?.querySelector("summary");
  summary?.addEventListener("click", (event) => {
    if (!interfaceEnhancementsEnabled) return;
    event.preventDefault();
    if (accountMenu.open && document.getElementById("accountMenuPopover")?.dataset?.closing !== "true") {
      closeAccountPopover();
    } else {
      openAccountPopover();
    }
  });
  accountMenu?.addEventListener("toggle", (event) => {
    if (event.target.open) {
      hideTooltip();
      positionAccountPopover();
    }
    if (!interfaceEnhancementsEnabled) return;
    summary?.setAttribute("aria-expanded", String(accountMenu.open));
  });
  accountMenu?.addEventListener("focusout", (event) => {
    if (interfaceEnhancementsEnabled && event.relatedTarget && !accountMenu.contains(event.relatedTarget)) {
      closeAccountPopover();
    }
  });
  accountMenu?.addEventListener("keydown", (event) => {
    if (!interfaceEnhancementsEnabled) return;
    if (!accountMenu.open) {
      if (event.target === summary && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        openAccountPopover();
      } else return;
    }
    const items = [...accountMenu.querySelectorAll('[role="menuitem"]')]
      .filter((item) => !item.disabled && item.getClientRects().length && !item.closest("[inert]"));
    if (event.key === "Escape") {
      event.preventDefault(); closeAccountPopover();
      summary?.focus(); return;
    }
    if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (current + 1) % items.length
      : (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length);
    items[next].focus();
  });

  return Object.freeze({
    close: () => setDrawerOpen(false),
    closeAccountMenu: (opts) => closeAccountPopover(opts),
    isCollapsed: () => desktopCollapsed,
    setCollapsed: (val) => {
      desktopCollapsed = Boolean(val);
      try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(desktopCollapsed)); } catch (_) { /* ignore */ }
      applySidebarState();
    },
  });
}

function setupContentNavigation() {
  const skip = document.getElementById("skipToContent");
  if (skip) {
    // Also precede the diagnostic banner used by an isolated Preview.
    document.body.prepend(skip);
    skip.addEventListener("click", (event) => {
      event.preventDefault();
      if (!interfaceEnhancementsEnabled) return;
      const target = [...document.querySelectorAll("#appShell > section, #v3MainCanvas > section")]
        .find((section) => section.getClientRects().length && section.getAttribute("aria-hidden") !== "true")
        || document.getElementById("pageContent");
      target?.setAttribute("tabindex", "-1");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }
  // The public product demo already owns its tab behavior. These groups call
  // their existing click handlers, so routes, validation and permissions stay
  // with their current owners rather than being duplicated here.
  const groups = [...document.querySelectorAll('.auth-tabs, .admin-tabs, .feedback-tabs, .finance-subnav, #workspace > .tabs')];
  const refreshGroups = groups.map((group) => {
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const original = new Map(tabs.map((tab) => [tab, { index: tab.getAttribute("tabindex"), selected: tab.getAttribute("aria-selected") }]));
    const available = () => tabs.filter((tab) => !tab.disabled && !tab.hidden && !tab.classList.contains("hidden"));
    const sync = () => {
      const items = available();
      const selected = items.find((tab) => tab.classList.contains("active"))
        || items.find((tab) => tab.getAttribute("aria-selected") === "true") || items[0];
      for (const tab of tabs) {
        const baseline = original.get(tab);
        if (interfaceEnhancementsEnabled) {
          const value = String(tab === selected);
          if (tab.getAttribute("aria-selected") !== value) tab.setAttribute("aria-selected", value);
          tab.tabIndex = tab === selected ? 0 : -1;
        } else {
          if (baseline.index === null) tab.removeAttribute("tabindex");
          else tab.setAttribute("tabindex", baseline.index);
          if (baseline.selected === null) tab.removeAttribute("aria-selected");
        }
      }
    };
    group.addEventListener("keydown", (event) => {
      if (!interfaceEnhancementsEnabled) return;
      const items = available().filter((tab) => tab.getClientRects().length);
      const current = items.indexOf(event.target);
      if (current < 0) return;
      const vertical = group.getAttribute("aria-orientation") === "vertical";
      const forward = vertical ? "ArrowDown" : "ArrowRight";
      const backward = vertical ? "ArrowUp" : "ArrowLeft";
      if (![forward, backward, "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const direction = !vertical && getComputedStyle(group).direction === "rtl" ? -1 : 1;
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (current + (event.key === forward ? direction : -direction) + items.length) % items.length;
      items[next].click();
      sync();
      items[next].focus({ preventScroll: true });
    });
    new MutationObserver(sync).observe(group, { attributes: true, subtree: true, attributeFilter: ["class", "aria-selected", "disabled", "hidden"] });
    return sync;
  });
  refreshContentPolicy = () => {
    refreshGroups.forEach((refresh) => refresh());
    const summary = document.querySelector("#accountMenu > summary");
    if (interfaceEnhancementsEnabled) summary?.setAttribute("aria-expanded", String(document.getElementById("accountMenu").open));
    else summary?.removeAttribute("aria-expanded");
  };
  refreshContentPolicy();
}

function setupFormFeedback() {
  const messages = new Map();
  const clear = (control) => {
    const record = messages.get(control);
    if (!record) return;
    record.message.remove();
    const descriptions = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== record.message.id);
    if (descriptions.length) control.setAttribute("aria-describedby", descriptions.join(" "));
    else control.removeAttribute("aria-describedby");
    if (record.invalid === null) control.removeAttribute("aria-invalid");
    else control.setAttribute("aria-invalid", record.invalid);
    messages.delete(control);
  };
  resetFormFeedback = () => [...messages.keys()].forEach(clear);
  document.querySelectorAll('#loginForm, #registerForm, #changeSecretForm, #deleteAccountForm, #feedbackForm').forEach((form) => {
    // Preserve native validation and submission. The additional explanation
    // remains visible after the native validation bubble has disappeared.
    form.addEventListener("invalid", (event) => {
      if (!interfaceEnhancementsEnabled) return;
      const control = event.target;
      if (!control.id || !control.validationMessage) return;
      let record = messages.get(control);
      if (!record) {
        const message = document.createElement("p");
        message.className = "field-validation";
        message.id = `p07-validation-${control.id}`;
        message.setAttribute("role", "alert");
        const anchor = control.closest(".secret-input-row, label") || control;
        anchor.after(message);
        record = { message, invalid: control.getAttribute("aria-invalid") };
        messages.set(control, record);
        control.setAttribute("aria-describedby", [...new Set((control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean).concat(message.id))].join(" "));
      }
      record.message.textContent = control.validationMessage;
      control.setAttribute("aria-invalid", "true");
    }, true);
    form.addEventListener("input", (event) => { if (messages.has(event.target)) clear(event.target); });
    form.addEventListener("reset", () => { for (const control of [...messages.keys()]) if (form.contains(control)) clear(control); });
  });
}

export function setExperienceMode(mode) {
  const next = mode === PUBLIC_MODE ? PUBLIC_MODE : WORKSPACE_MODE;
  document.body.dataset.experience = next;
  navigationController?.close();
  closeActiveSelectPopover({ restoreFocus: false, immediate: true });
}

export function closeAccountPopover(options = {}) {
  navigationController?.closeAccountMenu?.(options);
}

export function workspaceRouteMeta(pathname, { authenticated = false, toolTitle = "", adminSection = "", languageSection = "" } = {}) {
  if (!authenticated) return null;
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/select") return { id: "home", trail: ["个人工作台"] };
  if (path === "/language") return { id: "language", trail: ["语言学习", languageSection].filter(Boolean) };
  if (path === "/language/english") return { id: "language", trail: ["语言学习", "英语", languageSection].filter(Boolean) };
  if (path === "/language/japanese") return { id: "language", trail: ["语言学习", "日语", languageSection].filter(Boolean) };
  if (path === "/tools") return { id: "tools", trail: ["工具箱"] };
  if (path === "/tools/workflows") return { id: "tools", trail: ["工具箱", "工作流"] };
  if (path.startsWith("/tools/")) return { id: "tools", trail: ["工具箱", toolTitle || "工具"] };
  if (path === "/finance") return { id: "finance", trail: ["财务账本"] };
  if (path === "/transfer") return { id: "transfer", trail: ["文件传输"] };
  if (path === "/account") return { id: "account", trail: ["账户与安全"] };
  if (path === "/admin") return { id: "admin", trail: ["管理后台", adminSection].filter(Boolean) };
  if (path === "/recharge") return { id: "recharge", trail: ["会员与充值"] };
  return null;
}

export function syncSidebarActiveIndicator(doc = globalThis.document) {
  const sidebar = doc?.getElementById?.("v3Sidebar");
  const indicator = doc?.getElementById?.("v3SidebarIndicator");
  if (!sidebar || !indicator) return;
  const active = sidebar.querySelector('.v3-sidebar-nav [data-v3-nav][aria-current="page"]');
  if (!active || active.hidden) {
    indicator.style.opacity = "0";
    return;
  }
  if (!active.offsetHeight) {
    indicator.style.opacity = "0";
    if (typeof doc.defaultView?.requestAnimationFrame === "function" && !indicator.dataset.rafQueued) {
      indicator.dataset.rafQueued = "true";
      doc.defaultView.requestAnimationFrame(() => {
        delete indicator.dataset.rafQueued;
        syncSidebarActiveIndicator(doc);
      });
    }
    return;
  }
  const height = Math.max(16, active.offsetHeight - 10);
  const top = Math.max(0, active.offsetTop + Math.round((active.offsetHeight - height) / 2));
  indicator.style.height = `${height}px`;
  indicator.style.transform = `translateY(${top}px)`;
  indicator.style.opacity = "1";
}

export function syncWorkspaceShell(doc, meta) {
  if (meta) doc.body.dataset.workspaceRoute = meta.id;
  else delete doc.body.dataset.workspaceRoute;
  const nav = doc.getElementById("workspaceBreadcrumb");
  if (!nav) {
    syncSidebarActiveIndicator(doc);
    return;
  }
  nav.hidden = !meta;
  const list = nav.querySelector("ol");
  if (!list) {
    syncSidebarActiveIndicator(doc);
    return;
  }
  const items = meta ? ["Aeris", ...meta.trail] : ["Aeris"];
  items.forEach((text, i) => {
    let li = list.children[i];
    if (!li) {
      li = doc.createElement("li");
      list.append(li);
    }
    if (li.textContent !== text) li.textContent = text;
    if (i === items.length - 1 && meta) li.setAttribute("aria-current", "page");
    else li.removeAttribute("aria-current");
  });
  while (list.children.length > items.length) list.lastElementChild.remove();
  syncSidebarActiveIndicator(doc);
}

const ENHANCED_SELECTS = new WeakMap();
let activeSelectPopover = null;
let activeSelectCleanup = null;
let activeSelectGeneration = 0;

export function closeActiveSelectPopover({ restoreFocus = false, immediate = false } = {}) {
  if (typeof activeSelectCleanup === "function") {
    activeSelectCleanup(restoreFocus, immediate);
  }
}

export function enhanceSelect(selectEl) {
  if (!selectEl || selectEl.tagName !== "SELECT" || selectEl.multiple) return null;
  if (selectEl.dataset.dsSelect === "native") return null;
  const existing = ENHANCED_SELECTS.get(selectEl);
  if (existing) {
    existing.sync();
    return existing;
  }

  const doc = selectEl.ownerDocument;
  const host = doc.createElement("div");
  host.className = "ds-select-host";
  if (selectEl.className) host.dataset.sourceClass = selectEl.className;

  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.className = "ds-select-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const triggerText = doc.createElement("span");
  triggerText.className = "ds-select-value";
  const chevron = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("width", "16");
  chevron.setAttribute("height", "16");
  chevron.setAttribute("fill", "none");
  chevron.setAttribute("stroke", "currentColor");
  chevron.setAttribute("stroke-width", "1.7");
  chevron.setAttribute("stroke-linecap", "round");
  chevron.setAttribute("stroke-linejoin", "round");
  chevron.setAttribute("aria-hidden", "true");
  chevron.classList.add("ds-select-chevron");
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m6 9 6 6 6-6");
  chevron.append(path);
  trigger.append(triggerText, chevron);

  const parent = selectEl.parentNode;
  if (!parent) return null;
  parent.insertBefore(host, selectEl);
  host.append(trigger, selectEl);

  selectEl.classList.add("ds-select-native");
  selectEl.tabIndex = -1;
  selectEl.setAttribute("aria-hidden", "true");

  const getOptions = () => [...selectEl.options].filter((opt) => !opt.hidden);
  const sync = () => {
    const selected = selectEl.selectedOptions?.[0] || getOptions()[0];
    triggerText.textContent = selected ? selected.textContent.trim() : "请选择";
    trigger.disabled = Boolean(selectEl.disabled);
    const labelledBy = selectEl.getAttribute("aria-labelledby");
    const labelText = selectEl.getAttribute("aria-label") || selectEl.closest("label")?.querySelector("span")?.textContent?.trim();
    if (labelledBy) trigger.setAttribute("aria-labelledby", labelledBy);
    else if (labelText) trigger.setAttribute("aria-label", labelText);
  };

  const openPopover = () => {
    if (selectEl.disabled) return;
    if (activeSelectPopover && activeSelectPopover.select === selectEl) {
      closeActiveSelectPopover({ restoreFocus: true });
      return;
    }
    closeActiveSelectPopover({ restoreFocus: false, immediate: true });

    const generation = ++activeSelectGeneration;
    let options = getOptions();
    const searchable = options.length > 5;
    const popover = doc.createElement("div");
    popover.className = "ds-select-popover";
    popover.id = `ds-select-popover-${generation}`;
    popover.dataset.open = "true";
    trigger.setAttribute("aria-controls", popover.id);

    let searchInput = null;
    if (searchable) {
      const searchWrap = doc.createElement("div");
      searchWrap.className = "ds-select-search-wrap";
      searchInput = doc.createElement("input");
      searchInput.type = "search";
      searchInput.className = "ds-select-search";
      searchInput.placeholder = "搜索选项…";
      searchInput.setAttribute("aria-label", "搜索选项");
      searchInput.autocomplete = "off";
      searchWrap.append(searchInput);
      popover.append(searchWrap);
    }

    const listbox = doc.createElement("div");
    listbox.className = "ds-select-listbox";
    listbox.setAttribute("role", "listbox");
    popover.append(listbox);
    doc.body.append(popover);

    let filtered = options;
    let activeIndex = Math.max(0, options.findIndex((o) => o.value === selectEl.value));
    let composing = false;

    const renderList = (query = searchInput?.value || "") => {
      options = getOptions();
      const needle = query.trim().toLowerCase();
      filtered = needle
        ? options.filter((opt) => opt.textContent.toLowerCase().includes(needle) || String(opt.value).toLowerCase().includes(needle))
        : options;
      if (activeIndex >= filtered.length) activeIndex = Math.max(0, filtered.length - 1);
      listbox.replaceChildren();
      if (!filtered.length) {
        const empty = doc.createElement("div");
        empty.className = "ds-select-empty";
        empty.textContent = "无匹配选项";
        listbox.append(empty);
        return;
      }
      filtered.forEach((opt, idx) => {
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.className = "ds-select-option";
        btn.setAttribute("role", "option");
        const isSelected = opt.value === selectEl.value;
        btn.setAttribute("aria-selected", String(isSelected));
        if (opt.disabled) btn.disabled = true;
        if (idx === activeIndex) btn.classList.add("is-active");
        const labelSpan = doc.createElement("span");
        labelSpan.textContent = opt.textContent.trim();
        btn.append(labelSpan);
        if (isSelected) {
          const check = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
          check.setAttribute("viewBox", "0 0 24 24");
          check.setAttribute("width", "15");
          check.setAttribute("height", "15");
          check.setAttribute("fill", "none");
          check.setAttribute("stroke", "currentColor");
          check.setAttribute("stroke-width", "2");
          check.setAttribute("aria-hidden", "true");
          const p = doc.createElementNS("http://www.w3.org/2000/svg", "path");
          p.setAttribute("d", "m5 12 4.5 4.5L19 7");
          check.append(p);
          btn.append(check);
        }
        btn.addEventListener("pointerenter", () => {
          activeIndex = idx;
          listbox.querySelectorAll(".ds-select-option").forEach((n, i) => n.classList.toggle("is-active", i === idx));
        });
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          if (opt.disabled) return;
          selectEl.value = opt.value;
          selectEl.dispatchEvent(new Event("input", { bubbles: true }));
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
          sync();
          closeActiveSelectPopover({ restoreFocus: true });
        });
        listbox.append(btn);
      });
    };

    const positionPopover = () => {
      if (generation !== activeSelectGeneration) return;
      if (!trigger.isConnected) {
        closeActiveSelectPopover({ restoreFocus: false, immediate: true });
        return;
      }
      const rect = trigger.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        closeActiveSelectPopover({ restoreFocus: false, immediate: true });
        return;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.max(Math.round(rect.width), searchable ? 220 : 168);
      const maxWidth = Math.min(360, vw - 16);
      const finalWidth = Math.min(width, maxWidth);
      const spaceBelow = vh - rect.bottom - 10;
      const spaceAbove = rect.top - 10;
      const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(300, openAbove ? spaceAbove : spaceBelow));
      popover.style.width = `${finalWidth}px`;
      popover.style.maxHeight = `${maxHeight}px`;
      const left = Math.max(8, Math.min(vw - finalWidth - 8, Math.round(rect.left)));
      popover.style.left = `${left}px`;
      if (openAbove) {
        popover.style.top = "auto";
        popover.style.bottom = `${Math.round(vh - rect.top + 6)}px`;
        popover.dataset.placement = "top";
      } else {
        popover.style.bottom = "auto";
        popover.style.top = `${Math.round(rect.bottom + 6)}px`;
        popover.dataset.placement = "bottom";
      }
    };

    const hostLabel = selectEl.closest("label");
    const handleDocPointer = (event) => {
      if (generation !== activeSelectGeneration) return;
      const target = event.target;
      if (popover.contains(target) || trigger.contains(target) || host.contains(target)) return;
      // Clicking the wrapping <label> forwards a synthetic click to trigger; let trigger toggle cleanly without double-toggling.
      if (hostLabel && hostLabel.contains(target)) return;
      closeActiveSelectPopover({ restoreFocus: false });
    };
    const handleRouteClose = () => {
      if (generation === activeSelectGeneration) {
        closeActiveSelectPopover({ restoreFocus: false, immediate: true });
      }
    };
    const handleKeydown = (event) => {
      if (generation !== activeSelectGeneration) return;
      if (composing || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeActiveSelectPopover({ restoreFocus: true });
        return;
      }
      if (!filtered.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        activeIndex = (activeIndex + step + filtered.length) % filtered.length;
        const buttons = listbox.querySelectorAll(".ds-select-option");
        buttons.forEach((n, i) => n.classList.toggle("is-active", i === activeIndex));
        buttons[activeIndex]?.scrollIntoView?.({ block: "nearest" });
      } else if (event.key === "Home") {
        event.preventDefault(); activeIndex = 0;
        const buttons = listbox.querySelectorAll(".ds-select-option");
        buttons.forEach((n, i) => n.classList.toggle("is-active", i === activeIndex));
      } else if (event.key === "End") {
        event.preventDefault(); activeIndex = filtered.length - 1;
        const buttons = listbox.querySelectorAll(".ds-select-option");
        buttons.forEach((n, i) => n.classList.toggle("is-active", i === activeIndex));
      } else if (event.key === "Enter") {
        const chosen = filtered[activeIndex];
        if (chosen && !chosen.disabled) {
          event.preventDefault();
          selectEl.value = chosen.value;
          selectEl.dispatchEvent(new Event("input", { bubbles: true }));
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
          sync();
          closeActiveSelectPopover({ restoreFocus: true });
        }
      }
    };

    renderList();
    positionPopover();
    trigger.setAttribute("aria-expanded", "true");
    doc.addEventListener("pointerdown", handleDocPointer, true);
    doc.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("resize", positionPopover, { passive: true });
    window.addEventListener("scroll", positionPopover, { passive: true, capture: true });
    window.addEventListener("popstate", handleRouteClose);

    if (searchInput) {
      searchInput.addEventListener("compositionstart", () => { composing = true; });
      searchInput.addEventListener("compositionend", () => { composing = false; renderList(searchInput.value); });
      searchInput.addEventListener("input", () => {
        if (!composing) renderList(searchInput.value);
      });
      window.requestAnimationFrame(() => {
        if (generation === activeSelectGeneration) searchInput.focus({ preventScroll: true });
      });
    } else {
      window.requestAnimationFrame(() => {
        if (generation !== activeSelectGeneration) return;
        const selectedBtn = listbox.querySelector('[aria-selected="true"]') || listbox.querySelector(".ds-select-option");
        selectedBtn?.focus({ preventScroll: true });
      });
    }

    let cleaned = false;
    activeSelectPopover = { select: selectEl, popover, refreshOptions: () => { if (!cleaned && generation === activeSelectGeneration) { renderList(); positionPopover(); } } };
    activeSelectCleanup = (restoreFocus = false, immediate = false) => {
      if (cleaned) return;
      cleaned = true;
      doc.removeEventListener("pointerdown", handleDocPointer, true);
      doc.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
      window.removeEventListener("popstate", handleRouteClose);
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-controls");
      if (activeSelectPopover?.popover === popover) {
        activeSelectPopover = null;
        activeSelectCleanup = null;
      }
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
      if (immediate || reduced) {
        popover.remove();
      } else {
        popover.dataset.open = "false";
        popover.classList.add("is-closing");
        window.setTimeout(() => popover.remove(), 150);
      }
      if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPopover();
  });
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openPopover();
    }
  });
  selectEl.addEventListener("change", () => {
    trigger.removeAttribute("aria-invalid");
    sync();
  });
  selectEl.addEventListener("invalid", () => {
    trigger.setAttribute("aria-invalid", "true");
  });

  const observer = new MutationObserver(() => {
    sync();
    if (activeSelectPopover?.select === selectEl) {
      activeSelectPopover.refreshOptions?.();
    }
  });
  observer.observe(selectEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });

  sync();
  const api = Object.freeze({ sync, open: openPopover, close: () => closeActiveSelectPopover({ restoreFocus: false }) });
  ENHANCED_SELECTS.set(selectEl, api);
  return api;
}

export function enhanceAllSelects(root = globalThis.document) {
  root?.querySelectorAll?.("select")?.forEach((sel) => enhanceSelect(sel));
}

export function initDesignSystem() {
  setupOverlayViewport();
  setupTheme();
  navigationController = setupNavigation();
  setupContentNavigation();
  setupFormFeedback();
  enhanceAllSelects(document);
  if (typeof MutationObserver === "function") {
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName === "SELECT") enhanceSelect(node);
            else if (node.querySelectorAll) enhanceAllSelects(node);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (typeof ResizeObserver === "function") {
    const sidebarNav = document.querySelector("#v3Sidebar .v3-sidebar-nav");
    if (sidebarNav) {
      new ResizeObserver(() => syncSidebarActiveIndicator(document)).observe(sidebarNav);
    }
  }
  if (!document.body.dataset.experience) setExperienceMode(WORKSPACE_MODE);
}
