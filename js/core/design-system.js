const PUBLIC_MODE = "public";
const WORKSPACE_MODE = "workspace";
const THEME_STORAGE_KEY = "wyj_theme_preference_v1";
const THEME_ORDER = Object.freeze(["system", "light", "dark"]);

let navigationController = null;
let interfaceEnhancementsEnabled = false;
let refreshContentPolicy = () => {};
let resetFormFeedback = () => {};

/** Validated Task25 UI policy (account or guest) is the only activation source. */
export function setInterfaceEnhancementsEnabled(enabled) {
  interfaceEnhancementsEnabled = enabled === true;
  document.documentElement.dataset.p07Ui = interfaceEnhancementsEnabled ? "enabled" : "disabled";
  if (!interfaceEnhancementsEnabled) resetFormFeedback();
  refreshContentPolicy();
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
  if (navigation && typeof ResizeObserver === "function") new ResizeObserver(schedule).observe(navigation);
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
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    const visibleLabel = { system: "系统", light: "浅色", dark: "深色" }[preference];
    const description = `外观：${visibleLabel}`;
    if (label) label.textContent = visibleLabel;
    if (button) {
      button.dataset.themePreference = preference;
      button.setAttribute("aria-label", `${description}，点击切换`);
      button.title = `${description}，点击切换`;
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = resolved === "dark" ? "#111318" : "#f3f2ef";
    // Native shell follows the web preference: one theme source of truth.
    document.dispatchEvent(new CustomEvent("wyj:theme-changed", { detail: { preference, resolved } }));
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
      const target = [...document.querySelectorAll("#appShell > section")]
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
          // Learning views use their existing active class as the source of
          // truth. Restore their pre-enhancement semantics on a kill decision.
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
    // Observe application-driven view changes as well as keyboard activation.
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

export function initDesignSystem() {
  setupOverlayViewport();
  setupTheme();
  navigationController = setupNavigation();
  setupContentNavigation();
  setupFormFeedback();
  if (!document.body.dataset.experience) setExperienceMode(WORKSPACE_MODE);
}
