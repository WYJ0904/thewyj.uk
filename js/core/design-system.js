const PUBLIC_MODE = "public";
const WORKSPACE_MODE = "workspace";

let navigationController = null;

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
  return Object.freeze({ close: () => setOpen(false) });
}

function setupSplitFlap() {
  const root = document.getElementById("publicSplitFlap");
  const word = root?.querySelector("[data-split-flap-word]");
  if (!root || !word) return;

  const phrases = String(root.dataset.phrases || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  if (phrases.length < 2) return;

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let index = Math.max(0, phrases.indexOf(word.textContent.trim()));
  let intervalId = 0;
  let swapTimer = 0;

  const stop = () => {
    if (intervalId) window.clearInterval(intervalId);
    if (swapTimer) window.clearTimeout(swapTimer);
    intervalId = 0;
    swapTimer = 0;
    root.classList.remove("is-flipping");
  };

  const advance = () => {
    if (root.classList.contains("is-flipping")) return;
    root.classList.add("is-flipping");
    swapTimer = window.setTimeout(() => {
      index = (index + 1) % phrases.length;
      word.textContent = phrases[index];
      swapTimer = 0;
    }, 125);
    window.setTimeout(() => root.classList.remove("is-flipping"), 280);
  };

  const start = () => {
    stop();
    if (reducedMotion?.matches || document.visibilityState === "hidden") return;
    intervalId = window.setInterval(advance, 2600);
  };

  const observer = "IntersectionObserver" in window
    ? new IntersectionObserver(([entry]) => entry?.isIntersecting ? start() : stop(), { threshold: 0.2 })
    : null;
  observer?.observe(root);
  if (!observer) start();
  reducedMotion?.addEventListener?.("change", start);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && root.getClientRects().length) start();
    else stop();
  });
}

function setupCapabilityGallery() {
  const gallery = document.getElementById("publicCapabilityGallery");
  const panels = [...(gallery?.querySelectorAll("[data-capability-panel]") || [])];
  if (!gallery || !panels.length) return;

  const triggers = panels.map((panel) => panel.querySelector(".capability-trigger"));
  const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)");

  const activate = (targetIndex, { focus = false } = {}) => {
    const index = Math.max(0, Math.min(panels.length - 1, targetIndex));
    panels.forEach((panel, panelIndex) => {
      const active = panelIndex === index;
      const trigger = triggers[panelIndex];
      const bodyId = trigger?.getAttribute("aria-controls");
      const body = bodyId ? document.getElementById(bodyId) : null;
      panel.classList.toggle("active", active);
      trigger?.setAttribute("aria-expanded", String(active));
      if (body) body.hidden = !active;
    });
    if (focus) triggers[index]?.focus();
  };

  triggers.forEach((trigger, index) => {
    if (!trigger) return;
    trigger.addEventListener("click", () => activate(index));
    trigger.addEventListener("focus", () => activate(index));
    trigger.addEventListener("keydown", (event) => {
      const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
      if (!direction && !["Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? panels.length - 1
          : (index + direction + panels.length) % panels.length;
      activate(next, { focus: true });
    });
    panels[index].addEventListener("pointerenter", () => {
      if (finePointer?.matches) activate(index);
    });
  });

  const initial = Math.max(0, panels.findIndex((panel) => panel.classList.contains("active")));
  activate(initial);
}

export function setExperienceMode(mode) {
  const next = mode === PUBLIC_MODE ? PUBLIC_MODE : WORKSPACE_MODE;
  document.body.dataset.experience = next;
  navigationController?.close();
}

export function initDesignSystem() {
  navigationController = setupNavigation();
  setupSplitFlap();
  setupCapabilityGallery();
  if (!document.body.dataset.experience) setExperienceMode(WORKSPACE_MODE);
}
