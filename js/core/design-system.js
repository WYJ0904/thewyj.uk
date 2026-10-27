const PUBLIC_MODE = "public";
const WORKSPACE_MODE = "workspace";
const THEME_STORAGE_KEY = "wyj_theme_preference_v1";
const THEME_ORDER = Object.freeze(["system", "light", "dark"]);

let navigationController = null;
let interfaceEnhancementsEnabled = false;
let refreshContentPolicy = () => {};

/** Existing Task25 account/channel/TTL decisions are the only activation source. */
export function setInterfaceEnhancementsEnabled(enabled) {
  interfaceEnhancementsEnabled = enabled === true;
  document.documentElement.dataset.p07Ui = interfaceEnhancementsEnabled ? "enabled" : "disabled";
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
  };
  update();
  window.addEventListener("resize", update, { passive: true });
  window.visualViewport?.addEventListener("resize", update, { passive: true });
  window.visualViewport?.addEventListener("scroll", update, { passive: true });
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
  document.getElementById("accountMenu")?.addEventListener("toggle", (event) => {
    if (event.target.open) setOpen(false);
  });
  const accountMenu = document.getElementById("accountMenu");
  accountMenu?.addEventListener("keydown", (event) => {
    if (!interfaceEnhancementsEnabled) return;
    if (!accountMenu.open) return;
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
  const tabs = [...document.querySelectorAll('.auth-tabs [role="tab"]')];
  const activate = (tab) => tabs.forEach((item) => { item.tabIndex = !interfaceEnhancementsEnabled || item === tab ? 0 : -1; });
  refreshContentPolicy = () => activate(tabs.find((tab) => tab.getAttribute("aria-selected") === "true"));
  tabs.forEach((tab) => {
    if (tab.getAttribute("aria-selected") === "true") activate(tab);
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      if (!interfaceEnhancementsEnabled) return;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
  });
  const tabList = document.querySelector(".auth-tabs");
  if (tabList && tabs.length) new MutationObserver(() => {
    const selected = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    if (selected) activate(selected);
  }).observe(tabList, { attributes: true, subtree: true, attributeFilter: ["aria-selected"] });
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
  if (!document.body.dataset.experience) setExperienceMode(WORKSPACE_MODE);
}
