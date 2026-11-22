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
      if (h > 0) versionOffset = h + 10;
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
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  let preference = readThemePreference();

  const apply = () => {
    const resolved = preference === "system" ? (colorScheme?.matches ? "dark" : "light") : preference;
    const root = document.documentElement;
    root.dataset.themeSwitching = "true";
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    const visibleLabel = { system: "系统", light: "浅色", dark: "深色" }[preference];
    const description = `外观：${visibleLabel}`;
    if (label) label.textContent = visibleLabel;
    if (button) {
      button.dataset.themePreference = preference;
      button.setAttribute("aria-label", `${description}，点击切换`);
      button.title = `${description}，点击切换`;
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.content = resolved === "dark"
        ? (interfaceEnhancementsEnabled ? "#0b0e14" : "#111318")
        : (interfaceEnhancementsEnabled ? "#f6f7f9" : "#f3f2ef");
    }
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
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.content = resolved === "dark"
        ? (interfaceEnhancementsEnabled ? "#0b0e14" : "#111318")
        : (interfaceEnhancementsEnabled ? "#f6f7f9" : "#f3f2ef");
    }
  };

  button?.addEventListener("click", () => {
    preference = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length];
    try { window.localStorage.setItem(THEME_STORAGE_KEY, preference); } catch (_) { /* Appearance remains usable in memory. */ }
    apply();
  });
  colorScheme?.addEventListener?.("change", () => {
    if (preference === "system") apply();
  });
  apply();
}

function setupNavigation() {
  const navigation = document.getElementById("accountBar");
  const toggle = document.getElementById("siteNavToggle");
  const panel = document.getElementById("siteNavPanel");
  if (!navigation || !toggle || !panel) return null;

  const setOpen = (open, { restoreFocus = false } = {}) => {
    const next = Boolean(open);
    navigation.classList.toggle("nav-open", next);
    toggle.setAttribute("aria-expanded", String(next));
    toggle.setAttribute("aria-label", next ? "关闭主导航" : "打开主导航");
    panel.setAttribute("aria-hidden", String(!next));
    panel.inert = !next;
    if (next) document.getElementById("accountMenu")?.removeAttribute("open");
    if (!next && restoreFocus) toggle.focus();
  };

  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  panel.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) setOpen(false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!navigation.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && navigation.classList.contains("nav-open")) {
      event.preventDefault();
      setOpen(false, { restoreFocus: true });
    }
  });

  setOpen(false);
  const accountMenu = document.getElementById("accountMenu");
  accountMenu?.addEventListener("toggle", (event) => {
    if (event.target.open) setOpen(false);
    if (!interfaceEnhancementsEnabled) return;
    accountMenu.querySelector("summary")?.setAttribute("aria-expanded", String(accountMenu.open));
  });
  accountMenu?.addEventListener("focusout", (event) => {
    if (interfaceEnhancementsEnabled && event.relatedTarget && !accountMenu.contains(event.relatedTarget)) accountMenu.open = false;
  });
  accountMenu?.addEventListener("keydown", (event) => {
    if (!interfaceEnhancementsEnabled) return;
    if (!accountMenu.open) {
      if (event.target === accountMenu.querySelector("summary") && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        accountMenu.open = true;
      } else return;
    }
    const items = [...accountMenu.querySelectorAll('[role="menuitem"]')]
      .filter((item) => !item.disabled && item.getClientRects().length && !item.closest("[inert]"));
    if (event.key === "Escape") {
      event.preventDefault(); accountMenu.open = false;
      accountMenu.querySelector("summary")?.focus(); return;
    }
    if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (current + 1) % items.length
      : (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length);
    items[next].focus();
  });
  return Object.freeze({ close: () => setOpen(false) });
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
  const groups = [...document.querySelectorAll('.auth-tabs, .admin-tabs, .feedback-tabs, #workspace > .tabs')];
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
  if (!active || active.hidden || !active.offsetHeight) {
    indicator.style.opacity = "0";
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

export function initDesignSystem() {
  setupOverlayViewport();
  setupTheme();
  navigationController = setupNavigation();
  setupContentNavigation();
  setupFormFeedback();
  if (!document.body.dataset.experience) setExperienceMode(WORKSPACE_MODE);
}
