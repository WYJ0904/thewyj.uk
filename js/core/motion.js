/**
 * Aeris V6.3 I07 Shared Motion & Interaction Engine.
 * Presentation only. Business locks, routing and durable state remain in their owners.
 */
import {
  MOTION,
  pressedReleaseDelay,
  prefersReducedMotion,
  motionDuration,
  createMotionScope,
} from "./motion-tokens.js?release=20261119-aeris-i07-preview";
import {
  captureFlipSnapshot,
  playFlipSnapshot,
  flipLayout,
  createDragSortController,
} from "./motion-flip.js?release=20261119-aeris-i07-preview";
import {
  createToastManager,
  getSharedToastManager,
  showToast,
  dismissToast,
} from "./motion-toast.js?release=20261119-aeris-i07-preview";
import {
  isMobileSheetViewport,
  syncModalScrollLock,
  getScrollLockCount,
  attachSheetAdapter,
} from "./motion-sheet.js?release=20261119-aeris-i07-preview";
import {
  clamp01,
  lerp,
  computeScrollProgress,
  computeCenteredParallax,
  createScrollProgressController,
} from "./motion-scroll.js?release=20261119-aeris-i07-preview";

export {
  MOTION,
  pressedReleaseDelay,
  prefersReducedMotion,
  motionDuration,
  createMotionScope,
  captureFlipSnapshot,
  playFlipSnapshot,
  flipLayout,
  createDragSortController,
  createToastManager,
  getSharedToastManager,
  showToast,
  dismissToast,
  isMobileSheetViewport,
  syncModalScrollLock,
  getScrollLockCount,
  attachSheetAdapter,
  clamp01,
  lerp,
  computeScrollProgress,
  computeCenteredParallax,
  createScrollProgressController,
};

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  "[role='button']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='switch']",
  "input[type='checkbox']",
  "input[type='radio']",
  "input[type='submit']",
  "input[type='button']",
  "input[type='file']",
].join(",");

/**
 * Set semantic interaction state on a control without pretending success on disabled/failed states.
 */
export function setControlFeedbackState(element, state = "idle", { message = "" } = {}) {
  if (!element?.setAttribute) return false;
  const disabled = Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true";
  if (state === "success" && disabled) return false;

  if (!state || state === "idle") {
    element.removeAttribute("data-feedback-state");
    element.removeAttribute("aria-busy");
    return true;
  }
  element.setAttribute("data-feedback-state", String(state));
  if (state === "pending") {
    element.setAttribute("aria-busy", "true");
  } else {
    element.removeAttribute("aria-busy");
  }
  if (message && element.dataset) {
    element.dataset.feedbackMessage = String(message);
  }
  return true;
}

/**
 * Interruptible preview tab skeleton switcher (120-150ms) with latest-only generation guard.
 */
export function createTabSkeletonSwitcher({
  duration = MOTION.skeleton,
  view = globalThis.window,
} = {}) {
  let generation = 0;
  let timerId = 0;
  let activePanel = null;
  let pendingResolve = null;

  function clearPending() {
    if (timerId && view?.clearTimeout) {
      view.clearTimeout(timerId);
    }
    timerId = 0;
    if (pendingResolve) {
      const done = pendingResolve;
      pendingResolve = null;
      done(false);
    }
    if (activePanel) {
      activePanel.removeAttribute?.("data-skeleton-loading");
      activePanel.removeAttribute?.("aria-busy");
    }
  }

  function switchTab(panel, renderContent, { immediate = false } = {}) {
    const token = ++generation;
    clearPending();
    activePanel = panel || null;
    if (!panel || typeof renderContent !== "function") return Promise.resolve(false);

    const ms = immediate || prefersReducedMotion(view) ? 0 : Math.max(120, Math.min(150, Number(duration) || MOTION.skeleton));
    if (!ms || !view?.setTimeout) {
      renderContent(panel);
      return Promise.resolve(true);
    }

    panel.setAttribute?.("data-skeleton-loading", "true");
    panel.setAttribute?.("aria-busy", "true");

    return new Promise((resolve) => {
      pendingResolve = resolve;
      timerId = view.setTimeout(() => {
        timerId = 0;
        pendingResolve = null;
        if (token !== generation) {
          resolve(false);
          return;
        }
        panel.removeAttribute?.("data-skeleton-loading");
        panel.removeAttribute?.("aria-busy");
        renderContent(panel);
        if (!prefersReducedMotion(view) && typeof panel.animate === "function") {
          panel.animate(
            [{ opacity: 0.72, transform: "translate3d(0, 4px, 0)" }, { opacity: 1, transform: "translate3d(0, 0, 0)" }],
            { duration: 140, easing: MOTION.easing, fill: "none" },
          )?.finished?.catch?.(() => {});
        }
        resolve(true);
      }, ms);
    });
  }

  return Object.freeze({
    switchTab,
    cancel() {
      generation += 1;
      clearPending();
    },
  });
}

/**
 * Shared drag-and-drop file zone feedback helper (active, invalid, idle).
 */
export function attachFileDropFeedback(zone, {
  validate = null,
  onFiles = null,
  doc = zone?.ownerDocument || globalThis.document,
} = {}) {
  if (!zone?.addEventListener) return () => {};
  let depth = 0;
  const setState = (state) => {
    if (!state || state === "idle") zone.removeAttribute("data-drop-state");
    else zone.setAttribute("data-drop-state", state);
  };
  const onDragEnter = (event) => {
    event.preventDefault();
    depth += 1;
    setState("active");
  };
  const onDragOver = (event) => {
    event.preventDefault();
    setState("active");
  };
  const onDragLeave = () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) setState("idle");
  };
  const onDrop = (event) => {
    event.preventDefault();
    depth = 0;
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) {
      setState("idle");
      return;
    }
    if (typeof validate === "function") {
      const check = validate(files);
      if (check && check.ok === false) {
        setState("error");
        showToast({ tone: "error", message: check.message || "文件校验未通过，请重新选择。" }, {}, doc);
        return;
      }
    }
    setState("idle");
    onFiles?.(files);
  };

  zone.addEventListener("dragenter", onDragEnter);
  zone.addEventListener("dragover", onDragOver);
  zone.addEventListener("dragleave", onDragLeave);
  zone.addEventListener("drop", onDrop);
  return () => {
    setState("idle");
    zone.removeEventListener("dragenter", onDragEnter);
    zone.removeEventListener("dragover", onDragOver);
    zone.removeEventListener("dragleave", onDragLeave);
    zone.removeEventListener("drop", onDrop);
  };
}

/**
 * Publish safe core motion helpers on `window.WYJMotion` for classic scripts
 * (tools.js / workflows.js) without breaking module graph boundaries.
 */
export function installMotionGlobal(target = typeof window === "undefined" ? globalThis : window) {
  if (!target) return null;
  const api = Object.freeze({
    MOTION,
    prefersReducedMotion,
    motionDuration,
    createMotionScope,
    setControlFeedbackState,
    createTabSkeletonSwitcher,
    attachFileDropFeedback,
    captureFlipSnapshot,
    playFlipSnapshot,
    flipLayout,
    createDragSortController,
    createToastManager,
    getSharedToastManager,
    showToast,
    dismissToast,
    isMobileSheetViewport,
    syncModalScrollLock,
    attachSheetAdapter,
    createScrollProgressController,
  });
  try {
    target.WYJMotion = api;
  } catch (_) {}
  return api;
}

const installed = new WeakMap();
export function installMotionSystem(doc = globalThis.document) {
  if (!doc?.addEventListener) return () => {};
  if (installed.has(doc)) return installed.get(doc);
  const view = doc.defaultView;
  const pressed = new Map();
  const pointerTargets = new Map();
  const disposers = [];
  const disclosures = new WeakMap();
  const indicators = new Map();
  const indicatorFrames = new Map();
  const observedTablists = new Set();
  const clock = () => view.performance.now();

  const resolveInteractiveTarget = (node) => {
    if (!node?.closest) return null;
    const direct = node.closest(INTERACTIVE_SELECTOR);
    if (direct) return direct;
    const label = node.closest("label");
    if (label?.control && !label.control.disabled) return label.control;
    return null;
  };

  const usable = (node) => node && !node.disabled && node.getAttribute?.("aria-disabled") !== "true" && !node.closest?.("[inert]");

  function clear(node) {
    const item = pressed.get(node);
    if (item?.timer) view.clearTimeout(item.timer);
    pressed.delete(node);
    node?.removeAttribute?.("data-aeris-pressed");
  }

  function press(node) {
    if (!usable(node) || node.hasAttribute?.("data-widget-drag") || node.hasAttribute?.("data-drag-handle")) return;
    clear(node);
    pressed.set(node, { at: clock(), timer: null });
    node.setAttribute?.("data-aeris-pressed", "true");
  }

  function release(node, cancel = false) {
    const item = pressed.get(node);
    if (!item) return;
    const remaining = cancel || prefersReducedMotion(view) ? 0 : pressedReleaseDelay(item.at, clock());
    if (!remaining) clear(node);
    else item.timer = view.setTimeout(() => clear(node), remaining);
  }

  function reset() {
    for (const node of [...pressed.keys()]) clear(node);
    pointerTargets.clear();
  }

  function listen(type, handler, options = { capture: true }) {
    doc.addEventListener(type, handler, options);
    disposers.push(() => doc.removeEventListener(type, handler, options));
  }

  listen("pointerdown", (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const node = resolveInteractiveTarget(event.target);
    if (!usable(node)) return;
    pointerTargets.set(event.pointerId, node);
    press(node);
  }, { capture: true, passive: true });

  listen("pointerup", (event) => {
    const node = pointerTargets.get(event.pointerId);
    if (node) release(node);
    pointerTargets.delete(event.pointerId);
  }, { capture: true, passive: true });

  listen("pointercancel", (event) => {
    const node = pointerTargets.get(event.pointerId);
    if (node) release(node, true);
    pointerTargets.delete(event.pointerId);
  }, { capture: true, passive: true });

  listen("keydown", (event) => {
    if (!event.repeat && (event.key === "Enter" || event.key === " ")) {
      press(resolveInteractiveTarget(event.target));
    }
  });

  listen("keyup", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      release(resolveInteractiveTarget(event.target));
    }
  });

  // Semantic invalid/input feedback sync across native forms.
  listen("invalid", (event) => {
    const control = event.target;
    if (!control?.setAttribute) return;
    control.setAttribute("data-feedback-state", "error");
    if (!prefersReducedMotion(view) && typeof control.animate === "function") {
      control.animate(
        [
          { transform: "translate3d(-3px, 0, 0)" },
          { transform: "translate3d(3px, 0, 0)" },
          { transform: "translate3d(-2px, 0, 0)" },
          { transform: "translate3d(0, 0, 0)" },
        ],
        { duration: 180, easing: MOTION.easing },
      )?.finished?.catch?.(() => {});
    }
  }, { capture: true });

  listen("input", (event) => {
    if (event.target?.getAttribute?.("data-feedback-state") === "error") {
      event.target.removeAttribute("data-feedback-state");
    }
  }, { capture: true, passive: true });

  listen("change", (event) => {
    if (event.target?.getAttribute?.("data-feedback-state") === "error") {
      event.target.removeAttribute("data-feedback-state");
    }
  }, { capture: true, passive: true });

  listen("visibilitychange", () => { if (doc.hidden) reset(); });
  listen("thewyj:reduced-motion", reset);
  view.addEventListener("blur", reset);
  disposers.push(() => view.removeEventListener("blur", reset));

  // Native details semantics remain the authority, including programmatic opens.
  // Only a small disclosure is allowed to animate layout; large ledgers keep a
  // single layout change plus a short compositor effect.
  function setDisclosureOpen(details, state, value) {
    if (details.open !== value) { state.ownedWrites++; details.open = value; }
  }

  function animateDisclosure(details, summary) {
    let state = disclosures.get(details);
    if (!state) {
      state = {
        targetOpen: details.open,
        generation: 0,
        ownedWrites: 0,
        animation: null,
        height: details.style.height,
        overflow: details.style.overflow,
      };
      disclosures.set(details, state);
    }
    const start = details.getBoundingClientRect().height;
    state.targetOpen = !state.targetOpen;
    const generation = ++state.generation;
    state.animation?.cancel();
    details.style.height = state.height;
    details.style.overflow = state.overflow;
    if (state.targetOpen) setDisclosureOpen(details, state, true);
    summary.setAttribute("aria-expanded", String(state.targetOpen));
    const end = state.targetOpen ? details.getBoundingClientRect().height : summary.getBoundingClientRect().height;
    const finish = () => {
      if (generation !== state.generation) return;
      details.style.height = state.height;
      details.style.overflow = state.overflow;
      setDisclosureOpen(details, state, state.targetOpen);
      state.animation = null;
    };
    const duration = motionDuration("expand", view);
    if (!duration || typeof details.animate !== "function") { finish(); return; }
    if (Math.abs(start - end) <= 280) {
      details.style.overflow = "hidden";
      state.animation = details.animate([{ height: `${start}px` }, { height: `${end}px` }], { duration, easing: MOTION.easing });
    } else {
      setDisclosureOpen(details, state, state.targetOpen);
      state.animation = details.animate([{ opacity: 0.94 }, { opacity: 1 }], { duration: motionDuration("fast", view), easing: MOTION.easing });
    }
    state.animation.finished.then(finish, () => {});
  }

  listen("click", (event) => {
    const summary = event.target?.closest?.("summary");
    if (!summary || event.target?.closest?.("a,button,input") || event.defaultPrevented) return;
    const details = summary.parentElement;
    if (details?.tagName !== "DETAILS") return;
    // Anchored menus render an overlay popover outside summary flow.
    if (details.classList?.contains("account-menu") || summary.getAttribute?.("aria-haspopup") === "menu") return;
    event.preventDefault();
    animateDisclosure(details, summary);
  }, { capture: false });

  const disclosureObserver = new view.MutationObserver((records) => {
    for (const record of records) {
      const details = record.target;
      const state = disclosures.get(details);
      if (!state) continue;
      if (state.ownedWrites > 0) { state.ownedWrites--; continue; }
      // Data/viewport owners can open or close; either supersedes old completion.
      state.targetOpen = details.open;
      state.generation++;
      state.animation?.cancel();
      state.animation = null;
      details.style.height = state.height;
      details.style.overflow = state.overflow;
      details.querySelector("summary")?.setAttribute("aria-expanded", String(details.open));
    }
  });
  disclosureObserver.observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });
  disposers.push(() => disclosureObserver.disconnect());

  function updateIndicator(group) {
    if (!group?.isConnected) return;
    const selected = group.querySelector("[role='tab'][aria-selected='true']") || group.querySelector("[role='tab'].active");
    if (!selected) return;
    let indicator = indicators.get(group);
    if (!indicator) {
      indicator = doc.createElement("span");
      const segmented = group.classList?.contains?.("ds-segmented") || group.dataset?.indicatorStyle === "pill";
      indicator.className = segmented ? "ds-tab-indicator seg-indicator" : "ds-tab-indicator";
      indicator.setAttribute("aria-hidden", "true");
      group.append(indicator);
      group.classList.add("ds-motion-tabs");
      indicators.set(group, indicator);
    }
    // Layout coordinates stay stable while pressed scale changes visual bounds.
    let left = selected.offsetLeft;
    let top = selected.offsetTop || 0;
    let parent = selected.offsetParent;
    while (parent && parent !== group) {
      left += parent.offsetLeft;
      top += parent.offsetTop || 0;
      parent = parent.offsetParent;
    }
    indicator.style.width = `${selected.offsetWidth}px`;
    if (indicator.classList?.contains?.("seg-indicator")) {
      indicator.style.height = `${selected.offsetHeight}px`;
      indicator.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    } else {
      indicator.style.transform = `translateX(${left}px)`;
    }
  }

  function scheduleIndicator(group) {
    if (!group || indicatorFrames.has(group)) return;
    indicatorFrames.set(group, view.requestAnimationFrame(() => {
      indicatorFrames.delete(group);
      if (group.getBoundingClientRect().width > 0) updateIndicator(group);
    }));
  }

  const tabObserver = new view.MutationObserver((records) => {
    for (const record of records) {
      const group = record.target.closest?.("[role='tablist']");
      if (group) scheduleIndicator(group);
    }
  });

  function registerTabGroup(group) {
    if (!group || observedTablists.has(group)) return;
    observedTablists.add(group);
    tabObserver.observe(group, { subtree: true, attributes: true, attributeFilter: ["aria-selected", "class"] });
    if (group.getBoundingClientRect().width > 0) updateIndicator(group);
  }

  const initialTabGroups = [...doc.querySelectorAll("[role='tablist']")];
  for (const group of initialTabGroups) registerTabGroup(group);

  listen("click", () => {
    // Covers a tablist revealed by navigation; no observer on progress events.
    for (const group of observedTablists) scheduleIndicator(group);
  }, { capture: false });

  // Also discover dynamically mounted [role='tablist'] nodes in real DOM documents.
  if (doc.documentElement?.nodeType === 1) {
    const dynamicTabObserver = new view.MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node.nodeType !== 1) continue;
          if (node.getAttribute?.("role") === "tablist") registerTabGroup(node);
          node.querySelectorAll?.("[role='tablist']")?.forEach(registerTabGroup);
        }
      }
    });
    dynamicTabObserver.observe(doc.documentElement, { childList: true, subtree: true });
    disposers.push(() => dynamicTabObserver.disconnect());
  }

  disposers.push(() => {
    tabObserver.disconnect();
    for (const frame of indicatorFrames.values()) view.cancelAnimationFrame(frame);
    indicatorFrames.clear();
  });

  const resize = () => {
    for (const group of indicators.keys()) {
      if (group.isConnected && group.getBoundingClientRect().width > 0) updateIndicator(group);
    }
  };
  view.addEventListener("resize", resize);
  disposers.push(() => view.removeEventListener("resize", resize));

  // Scroll-progress & Bento internal parallax controller (auto-tracks [data-scroll-3d] & [data-bento-wall]).
  const scrollController = createScrollProgressController({ root: doc, doc, view });
  disposers.push(() => scrollController.dispose());

  // Install global bridge for classic scripts when running in a browser window.
  if (view && view === globalThis.window) installMotionGlobal(view);

  doc.documentElement.setAttribute?.("data-aeris-motion-ready", "true");
  const dispose = () => {
    reset();
    for (const cleanup of disposers) cleanup();
    for (const [group, indicator] of indicators) {
      indicator.remove();
      group.classList.remove("ds-motion-tabs");
    }
    observedTablists.clear();
    indicators.clear();
    doc.documentElement.removeAttribute?.("data-aeris-motion-ready");
    installed.delete(doc);
  };
  installed.set(doc, dispose);
  return dispose;
}
