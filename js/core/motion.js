/**
 * Aeris V6.3 I07 Shared Motion & Interaction Engine.
 * Presentation only. Business locks, routing and durable state remain in their owners.
 * Consolidated inside CORE_SHELL (/js/core/motion.js) to preserve RC5/P5 89-asset offline publication integrity.
 */

// ============================================================================
// 1. Motion Tokens, Reduced-Motion Guard & Lifecycle Scope
// ============================================================================
export const MOTION = Object.freeze({
  pressed: 80,
  fast: 140,
  skeleton: 140,
  expand: 200,
  page: 220,
  sheet: 280,
  container: 420,
  toastIn: 220,
  toastOut: 180,
  pressedScale: 0.985,
  pressedOpacity: 0.92,
  distance: 8,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  easingEmphasized: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  spring: "cubic-bezier(0.22, 1, 0.36, 1)",
  decelerate: "cubic-bezier(0.16, 1, 0.3, 1)",
});

export function pressedReleaseDelay(started, now, minimum = MOTION.pressed) {
  return Math.max(0, minimum - Math.max(0, now - started));
}

export function prefersReducedMotion(view = globalThis.window) {
  return view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    || view?.document?.documentElement?.dataset?.androidReducedMotion === "true";
}

export function motionDuration(kind, view = globalThis.window) {
  return prefersReducedMotion(view) ? 0 : (MOTION[kind] ?? MOTION.fast);
}

/**
 * Tracks animations, timers, observers, and event listeners for deterministic teardown.
 */
export function createMotionScope(view = globalThis.window) {
  const disposers = [];
  const animations = new Set();
  const timers = new Set();
  let disposed = false;

  return Object.freeze({
    get disposed() { return disposed; },
    add(cleanup) {
      if (typeof cleanup !== "function") return cleanup;
      if (disposed) { try { cleanup(); } catch (_) {} return cleanup; }
      disposers.push(cleanup);
      return cleanup;
    },
    listen(target, type, handler, options) {
      if (!target?.addEventListener) return () => {};
      target.addEventListener(type, handler, options);
      const off = () => target.removeEventListener?.(type, handler, options);
      return this.add(off);
    },
    timeout(fn, ms) {
      if (disposed || !view?.setTimeout) return 0;
      const id = view.setTimeout(() => {
        timers.delete(id);
        if (!disposed) fn();
      }, ms);
      timers.add(id);
      return id;
    },
    clearTimeout(id) {
      if (!id) return;
      timers.delete(id);
      view?.clearTimeout?.(id);
    },
    trackAnimation(animation) {
      if (!animation) return animation;
      if (disposed) { try { animation.cancel?.(); } catch (_) {} return animation; }
      animations.add(animation);
      animation.finished?.then?.(
        () => animations.delete(animation),
        () => animations.delete(animation),
      );
      return animation;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of timers) view?.clearTimeout?.(id);
      timers.clear();
      for (const anim of animations) {
        try { anim.cancel?.(); } catch (_) {}
      }
      animations.clear();
      while (disposers.length) {
        const fn = disposers.pop();
        try { fn(); } catch (_) {}
      }
    },
  });
}

// ============================================================================
// 2. Bidirectional FLIP & Pointer/Keyboard Drag Sort
// ============================================================================
const activeFlips = new WeakMap();
const DEFAULT_DURATION = 420;
const DEFAULT_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

function resolveView(container, explicitView) {
  return explicitView || container?.ownerDocument?.defaultView || globalThis.window;
}

function defaultKey(element, index) {
  return element?.dataset?.flipKey || element?.dataset?.workspaceKey || element?.id || `__idx_${index}`;
}

function isVisibleRect(rect) {
  return Boolean(rect && (rect.width > 0 || rect.height > 0));
}

function cancelActiveFlip(element) {
  const current = activeFlips.get(element);
  if (!current) return null;
  // Measure live mid-flight visual rect BEFORE cancelling so reversal starts from where the eye sees it.
  let liveRect = null;
  try {
    liveRect = element.getBoundingClientRect();
  } catch (_) {
    liveRect = null;
  }
  current.generation += 1;
  try { current.animation?.cancel(); } catch (_) {}
  if (element.style) {
    if (current.prevTransform !== undefined) element.style.transform = current.prevTransform;
    if (current.prevOrigin !== undefined) element.style.transformOrigin = current.prevOrigin;
  }
  element.removeAttribute?.("data-flip-moving");
  activeFlips.delete(element);
  return liveRect;
}

/**
 * Measure current bounding rects of candidate items before a DOM/layout mutation.
 * Interrupts any active FLIP animation smoothly and captures live mid-flight visual rects.
 */
export function captureFlipSnapshot(container, {
  selector = ":scope > *",
  getKey = defaultKey,
} = {}) {
  const snapshot = new Map();
  if (!container?.querySelectorAll) return snapshot;
  const elements = [...container.querySelectorAll(selector)];
  elements.forEach((element, index) => {
    if (!element || element.hidden || element.classList?.contains?.("hidden")) return;
    const liveRect = cancelActiveFlip(element);
    const rect = liveRect || element.getBoundingClientRect?.();
    if (!isVisibleRect(rect)) return;
    snapshot.set(getKey(element, index), {
      element,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  });
  return snapshot;
}

/**
 * Play bidirectional FLIP transitions between a pre-mutation snapshot and current DOM positions.
 */
export function playFlipSnapshot(container, beforeSnapshot, {
  selector = ":scope > *",
  getKey = defaultKey,
  duration = DEFAULT_DURATION,
  easing = DEFAULT_EASING,
  scale = true,
  animateEnter = true,
  doubleRaf = false,
  view = null,
} = {}) {
  const hostView = resolveView(container, view);
  const reduced = prefersReducedMotion(hostView);
  const elements = container?.querySelectorAll ? [...container.querySelectorAll(selector)] : [];
  if (!elements.length) {
    return { animatedCount: 0, cancel() {}, finished: Promise.resolve() };
  }

  // Batch read all Last rects before any style writes (avoid layout thrashing).
  const measurements = [];
  elements.forEach((element, index) => {
    if (!element || element.hidden || element.classList?.contains?.("hidden")) return;
    const key = getKey(element, index);
    const first = beforeSnapshot?.get(key)?.rect || null;
    const last = element.getBoundingClientRect?.();
    if (!isVisibleRect(last)) return;
    measurements.push({ element, key, first, last });
  });

  if (reduced || typeof elements[0]?.animate !== "function") {
    for (const { element } of measurements) cancelActiveFlip(element);
    return { animatedCount: 0, cancel() {}, finished: Promise.resolve() };
  }

  const pendingAnimations = [];
  const rafIds = [];
  let cancelled = false;

  const startElementAnimation = (element, keyframes, animDuration, animEasing, savedTransform = "", savedOrigin = "") => {
    const state = {
      generation: 1,
      animation: null,
      prevTransform: savedTransform,
      prevOrigin: savedOrigin,
    };
    const prevState = activeFlips.get(element);
    if (prevState) state.generation = prevState.generation + 1;
    activeFlips.set(element, state);
    element.setAttribute?.("data-flip-moving", "true");
    if (element.style) {
      element.style.transform = "";
      element.style.transformOrigin = scale ? "0 0" : "50% 50%";
    }
    const animation = element.animate(keyframes, {
      duration: animDuration,
      easing: animEasing,
      fill: "none",
    });
    state.animation = animation;
    const cleanup = () => {
      const current = activeFlips.get(element);
      if (current !== state) return;
      activeFlips.delete(element);
      element.removeAttribute?.("data-flip-moving");
      if (element.style) {
        element.style.transform = savedTransform;
        element.style.transformOrigin = savedOrigin;
      }
    };
    animation.finished.then(cleanup, cleanup);
    pendingAnimations.push(animation);
  };

  const toPlay = [];
  for (const { element, first, last } of measurements) {
    const savedTransform = element.style?.transform ?? "";
    const savedOrigin = element.style?.transformOrigin ?? "";
    if (!first) {
      if (animateEnter) {
        toPlay.push({
          element,
          keyframes: [
            { opacity: 0, transform: "translate3d(0, 8px, 0) scale(0.97)" },
            { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
          ],
          duration: Math.min(duration, 240),
          easing,
          invertTransform: null,
          savedTransform,
          savedOrigin,
        });
      }
      continue;
    }
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = scale && last.width > 0 ? first.width / last.width : 1;
    const sy = scale && last.height > 0 ? first.height / last.height : 1;
    const moved = Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5;
    const resized = scale && (Math.abs(sx - 1) >= 0.01 || Math.abs(sy - 1) >= 0.01);
    if (!moved && !resized) continue;
    const invertTransform = resized
      ? `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
      : `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
    const targetTransform = resized ? "translate3d(0, 0, 0) scale(1, 1)" : "translate3d(0, 0, 0)";
    toPlay.push({
      element,
      keyframes: [{ transform: invertTransform }, { transform: targetTransform }],
      duration,
      easing,
      invertTransform,
      savedTransform,
      savedOrigin,
    });
  }

  let resolveFinished;
  const finished = new Promise((resolve) => { resolveFinished = resolve; });

  const launchAll = () => {
    if (cancelled) {
      for (const item of toPlay) {
        item.element.removeAttribute?.("data-flip-moving");
        if (item.element.style) {
          item.element.style.transform = item.savedTransform;
          item.element.style.transformOrigin = item.savedOrigin;
        }
      }
      resolveFinished();
      return;
    }
    for (const item of toPlay) {
      startElementAnimation(item.element, item.keyframes, item.duration, item.easing, item.savedTransform, item.savedOrigin);
    }
    Promise.allSettled(pendingAnimations.map((a) => a.finished)).then(() => resolveFinished());
  };

  if (doubleRaf && toPlay.length && typeof hostView?.requestAnimationFrame === "function") {
    for (const item of toPlay) {
      item.element.setAttribute?.("data-flip-moving", "true");
      if (item.invertTransform && item.element.style) {
        item.element.style.transformOrigin = scale ? "0 0" : "50% 50%";
        item.element.style.transform = item.invertTransform;
      }
    }
    const f1 = hostView.requestAnimationFrame(() => {
      const f2 = hostView.requestAnimationFrame(launchAll);
      rafIds.push(f2);
    });
    rafIds.push(f1);
  } else {
    launchAll();
  }

  return {
    animatedCount: toPlay.length,
    finished,
    cancel() {
      cancelled = true;
      for (const id of rafIds) hostView?.cancelAnimationFrame?.(id);
      rafIds.length = 0;
      for (const item of toPlay) {
        item.element.removeAttribute?.("data-flip-moving");
        if (item.element.style) {
          item.element.style.transform = "";
          item.element.style.transformOrigin = "";
        }
        cancelActiveFlip(item.element);
      }
      resolveFinished();
    },
  };
}

/**
 * Convenience wrapper: First -> mutateFn() -> Last -> Invert -> Play.
 */
export function flipLayout(container, mutateFn, options = {}) {
  const before = captureFlipSnapshot(container, options);
  mutateFn?.();
  return playFlipSnapshot(container, before, options);
}

/**
 * Pointer-based drag-and-drop sorting controller with live FLIP sibling displacement,
 * pointercancel/Escape revert, and zero layout-thrashing during move.
 */
export function createDragSortController(container, {
  itemSelector = "[data-flip-key]",
  handleSelector = "[data-drag-handle]",
  getKey = defaultKey,
  onOrderChange = null,
  onDragStateChange = null,
  axis = "auto",
  threshold = 6,
  view = null,
} = {}) {
  if (!container?.addEventListener) return { dispose() {}, cancel() {} };
  const hostView = resolveView(container, view);
  const doc = container.ownerDocument || globalThis.document;
  let drag = null;
  let rafId = 0;

  const getItems = () => [...container.querySelectorAll(itemSelector)];
  const isEditable = (target) => Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));

  function clearDragVisuals(item) {
    if (!item) return;
    item.removeAttribute("data-dragging");
    if (item.style) {
      item.style.transform = "";
      item.style.zIndex = "";
      item.style.pointerEvents = "";
    }
  }

  function cancelDrag(revert = true) {
    if (rafId) hostView?.cancelAnimationFrame?.(rafId);
    rafId = 0;
    if (!drag) return;
    const current = drag;
    drag = null;
    clearDragVisuals(current.item);
    container.removeAttribute("data-drag-active");
    if (revert && current.moved) {
      flipLayout(container, () => {
        for (const node of current.initialOrder) {
          if (node.parentNode === container) container.append(node);
        }
      }, { selector: itemSelector, getKey, duration: 280, scale: false, animateEnter: false, view: hostView });
    }
    onDragStateChange?.({ dragging: false, cancelled: true, key: current.key });
  }

  function updateDragFrame() {
    rafId = 0;
    if (!drag) return;
    const dx = drag.latestX - drag.startX;
    const dy = drag.latestY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < threshold) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.item.setAttribute("data-dragging", "true");
      container.setAttribute("data-drag-active", "true");
      if (drag.item.style) {
        drag.item.style.zIndex = "12";
      }
      onDragStateChange?.({ dragging: true, key: drag.key });
    }

    const reduced = prefersReducedMotion(hostView);
    if (drag.item.style) {
      drag.item.style.transform = reduced
        ? `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`
        : `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(1.02)`;
    }

    // Check midpoint overlap with siblings using cached rects where possible.
    const items = getItems().filter((node) => node !== drag.item && !node.hidden);
    const pointerX = drag.latestX;
    const pointerY = drag.latestY;
    let targetSibling = null;
    let insertBefore = true;

    for (const sibling of items) {
      if (sibling.hasAttribute?.("data-flip-moving")) continue;
      const rect = sibling.getBoundingClientRect();
      if (
        pointerX >= rect.left && pointerX <= rect.right &&
        pointerY >= rect.top && pointerY <= rect.bottom
      ) {
        const siblingsAll = getItems();
        const myIndex = siblingsAll.indexOf(drag.item);
        const targetIndex = siblingsAll.indexOf(sibling);
        targetSibling = sibling;
        insertBefore = targetIndex < myIndex;
        break;
      }
    }

    if (targetSibling) {
      const before = captureFlipSnapshot(container, { selector: itemSelector, getKey });
      // Keep the dragged item out of FLIP snapshot override so pointer follow stays 1:1.
      before.delete(drag.key);
      if (drag.item.style) drag.item.style.transform = "";
      const prevSlot = drag.item.getBoundingClientRect();
      if (insertBefore) container.insertBefore(drag.item, targetSibling);
      else container.insertBefore(drag.item, targetSibling.nextElementSibling);
      const nextSlot = drag.item.getBoundingClientRect();
      drag.startX += nextSlot.left - prevSlot.left;
      drag.startY += nextSlot.top - prevSlot.top;
      const nextDx = drag.latestX - drag.startX;
      const nextDy = drag.latestY - drag.startY;
      if (drag.item.style) {
        drag.item.style.transform = reduced
          ? `translate3d(${nextDx.toFixed(1)}px, ${nextDy.toFixed(1)}px, 0)`
          : `translate3d(${nextDx.toFixed(1)}px, ${nextDy.toFixed(1)}px, 0) scale(1.02)`;
      }
      playFlipSnapshot(container, before, {
        selector: itemSelector,
        getKey,
        duration: 280,
        scale: false,
        animateEnter: false,
        view: hostView,
      });
    }
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    const handle = handleSelector ? event.target?.closest?.(handleSelector) : event.target?.closest?.(itemSelector);
    if (!handle || !container.contains(handle)) return;
    const item = handle.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    // Allow dedicated drag handle buttons, but skip unrelated interactive controls inside items.
    if (!handleSelector && event.target?.closest?.("button, a, input, select, textarea")) return;
    event.preventDefault();
    const initialOrder = getItems();
    const rect = item.getBoundingClientRect();
    drag = {
      item,
      handle,
      key: getKey(item, initialOrder.indexOf(item)),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      lastVisualLeft: rect.left,
      lastVisualTop: rect.top,
      moved: false,
      initialOrder,
    };
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.latestX = event.clientX;
    drag.latestY = event.clientY;
    if (!rafId && hostView?.requestAnimationFrame) {
      rafId = hostView.requestAnimationFrame(updateDragFrame);
    } else if (!hostView?.requestAnimationFrame) {
      updateDragFrame();
    }
  }

  function onPointerEnd(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.type === "pointercancel") {
      cancelDrag(true);
      return;
    }
    if (rafId) {
      hostView?.cancelAnimationFrame?.(rafId);
      rafId = 0;
      updateDragFrame();
    }
    const current = drag;
    drag = null;
    const moved = current.moved;
    const beforeDrop = moved ? captureFlipSnapshot(container, { selector: itemSelector, getKey }) : null;
    clearDragVisuals(current.item);
    container.removeAttribute("data-drag-active");
    if (moved && beforeDrop) {
      playFlipSnapshot(container, beforeDrop, {
        selector: itemSelector,
        getKey,
        duration: 240,
        scale: false,
        animateEnter: false,
        view: hostView,
      });
      const orderKeys = getItems().map((node, index) => getKey(node, index));
      onOrderChange?.(orderKeys, { trigger: "pointer", key: current.key });
    }
    onDragStateChange?.({ dragging: false, cancelled: false, committed: moved, key: current.key });
  }

  function resolveKeyboardDelta(key, items) {
    const normalizedAxis = String(axis || container.dataset?.sortAxis || "auto").toLowerCase();
    const hasHorizontalLayout = () => {
      if (normalizedAxis === "x" || normalizedAxis === "both") return true;
      if (normalizedAxis === "y" || items.length < 2) return false;
      const firstRect = items[0]?.getBoundingClientRect?.();
      if (!firstRect || (!firstRect.width && !firstRect.height)) return false;
      const rowTol = Math.max(8, (firstRect.height || 16) * 0.5);
      return items.slice(1).some((sibling) => {
        const rect = sibling.getBoundingClientRect?.();
        return rect && Math.abs(rect.top - firstRect.top) < rowTol && Math.abs(rect.left - firstRect.left) > 4;
      });
    };

    if (key === "ArrowUp") return normalizedAxis === "x" ? 0 : -1;
    if (key === "ArrowDown") return normalizedAxis === "x" ? 0 : 1;
    if (key === "ArrowLeft") return hasHorizontalLayout() ? -1 : 0;
    if (key === "ArrowRight") return hasHorizontalLayout() ? 1 : 0;
    return 0;
  }

  function onContainerKeyDown(event) {
    if (drag || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (isEditable(event.target)) return;
    const handle = handleSelector
      ? event.target?.closest?.(handleSelector)
      : event.target?.closest?.(itemSelector);
    if (!handle || !container.contains(handle)) return;
    const item = handle.closest?.(itemSelector);
    if (!item || !container.contains(item) || item.parentNode !== container) return;
    if (!handleSelector && event.target !== item && event.target?.closest?.("button, a")) return;

    const items = getItems();
    const delta = resolveKeyboardDelta(event.key, items);
    if (!delta) return;

    const currentIndex = items.indexOf(item);
    const nextIndex = currentIndex + delta;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= items.length) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const focusTarget = handle.matches?.("button, [tabindex], a") || event.target === handle ? event.target : item;
    flipLayout(container, () => {
      const targetSibling = items[nextIndex];
      if (!targetSibling || targetSibling === item) return;
      container.insertBefore(item, delta < 0 ? targetSibling : targetSibling.nextElementSibling);
    }, {
      selector: itemSelector,
      getKey,
      duration: 240,
      scale: false,
      animateEnter: false,
      view: hostView,
    });
    if (doc?.activeElement !== focusTarget) {
      focusTarget?.focus?.({ preventScroll: true });
    }
    const orderedKeys = getItems().map((node, index) => getKey(node, index));
    const movedKey = getKey(item, nextIndex);
    onOrderChange?.(orderedKeys, { trigger: "keyboard", key: event.key, movedKey, index: nextIndex });
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && drag) {
      event.preventDefault();
      cancelDrag(true);
    }
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("keydown", onContainerKeyDown);
  doc?.addEventListener?.("pointermove", onPointerMove);
  doc?.addEventListener?.("pointerup", onPointerEnd);
  doc?.addEventListener?.("pointercancel", onPointerEnd);
  doc?.addEventListener?.("keydown", onKeyDown);

  return {
    cancel: () => cancelDrag(true),
    dispose() {
      cancelDrag(false);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("keydown", onContainerKeyDown);
      doc?.removeEventListener?.("pointermove", onPointerMove);
      doc?.removeEventListener?.("pointerup", onPointerEnd);
      doc?.removeEventListener?.("pointercancel", onPointerEnd);
      doc?.removeEventListener?.("keydown", onKeyDown);
    },
  };
}

// ============================================================================
// 3. Bounded Toast Queue Manager
// ============================================================================
const DEFAULT_DURATIONS = Object.freeze({
  info: 3200,
  success: 3200,
  warning: 4800,
  error: 6500,
});

const TONE_LABELS = Object.freeze({
  info: "提示",
  success: "完成",
  warning: "注意",
  error: "错误",
});

const VALID_TONES = new Set(["info", "success", "warning", "error"]);
const sharedManagers = new WeakMap();

export function createToastManager({
  doc = globalThis.document,
  view = doc?.defaultView || globalThis.window,
  containerParent = null,
  maxVisible = 2,
  maxQueue = 12,
  durations = DEFAULT_DURATIONS,
} = {}) {
  if (!doc?.createElement) {
    return {
      show: () => null,
      dismiss: () => {},
      dismissByKey: () => {},
      clear: () => {},
      invalidateContext: () => 0,
      getContextToken: () => 0,
      setContextToken: () => 0,
      dispose: () => {},
      snapshot: () => ({ visible: [], queued: [], contextToken: 0 }),
    };
  }

  let seq = 0;
  let contextToken = 0;
  let disposed = false;
  const visible = [];
  const queue = [];
  const timers = new Map();
  let region = null;
  let listNode = null;
  let politeLive = null;
  let assertiveLive = null;

  function ensureRegion() {
    if (region && region.isConnected) return region;
    const parent = containerParent || doc.body || doc.documentElement;
    if (!parent) return null;
    region = doc.createElement("aside");
    region.className = "ds-toast-region";
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", "系统状态通知");

    listNode = doc.createElement("div");
    listNode.className = "ds-toast-stack";

    politeLive = doc.createElement("div");
    politeLive.className = "ds-sr-only";
    politeLive.setAttribute("role", "status");
    politeLive.setAttribute("aria-live", "polite");
    politeLive.setAttribute("aria-atomic", "true");

    assertiveLive = doc.createElement("div");
    assertiveLive.className = "ds-sr-only";
    assertiveLive.setAttribute("role", "alert");
    assertiveLive.setAttribute("aria-live", "assertive");
    assertiveLive.setAttribute("aria-atomic", "true");

    region.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const focusedToast = event.target?.closest?.("[data-toast-id]");
      const id = focusedToast?.dataset?.toastId;
      if (!id) return;
      event.preventDefault();
      event.stopPropagation?.();
      dismiss(id, { restoreSiblingFocus: true });
    });

    region.append(listNode, politeLive, assertiveLive);
    parent.append(region);
    return region;
  }

  function announce(tone, message) {
    const target = tone === "error" ? assertiveLive : politeLive;
    if (!target) return;
    target.textContent = "";
    const text = `${TONE_LABELS[tone] || "提示"}：${message}`;
    if (typeof view?.queueMicrotask === "function") {
      view.queueMicrotask(() => { if (!disposed && target) target.textContent = text; });
    } else {
      target.textContent = text;
    }
  }

  function clearTimer(id) {
    const entry = timers.get(id);
    if (!entry) return;
    if (entry.timerId) view?.clearTimeout?.(entry.timerId);
    timers.delete(id);
  }

  function startTimer(entry) {
    clearTimer(entry.id);
    if (entry.sticky || !Number.isFinite(entry.remainingMs) || entry.remainingMs <= 0) return;
    const startedAt = view?.performance?.now ? view.performance.now() : Date.now();
    const timerId = view?.setTimeout?.(() => {
      timers.delete(entry.id);
      dismiss(entry.id);
    }, entry.remainingMs);
    timers.set(entry.id, { timerId, startedAt });
  }

  function pauseTimer(entry) {
    const active = timers.get(entry.id);
    if (!active) return;
    const now = view?.performance?.now ? view.performance.now() : Date.now();
    const elapsed = Math.max(0, now - active.startedAt);
    entry.remainingMs = Math.max(400, entry.remainingMs - elapsed);
    clearTimer(entry.id);
  }

  function renderToastNode(entry) {
    const item = doc.createElement("article");
    item.className = "ds-toast";
    item.dataset.toastId = entry.id;
    item.dataset.tone = entry.tone;
    item.setAttribute("role", "group");
    item.setAttribute("aria-label", TONE_LABELS[entry.tone] || "提示");

    const badge = doc.createElement("span");
    badge.className = "ds-toast-tone";
    badge.textContent = TONE_LABELS[entry.tone] || "提示";

    const body = doc.createElement("div");
    body.className = "ds-toast-body";
    const text = doc.createElement("p");
    text.className = "ds-toast-message";
    text.textContent = entry.message;
    body.append(text);

    const countBadge = doc.createElement("span");
    countBadge.className = "ds-toast-repeat";
    countBadge.hidden = entry.count <= 1;
    countBadge.textContent = `×${entry.count}`;
    body.append(countBadge);

    if (entry.actionLabel && typeof entry.onAction === "function") {
      const actionBtn = doc.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "ds-toast-action button-ghost";
      actionBtn.textContent = entry.actionLabel;
      actionBtn.addEventListener("click", () => {
        try { entry.onAction(); } finally { dismiss(entry.id, { restoreSiblingFocus: true }); }
      });
      body.append(actionBtn);
    }

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ds-toast-close";
    closeBtn.setAttribute("aria-label", `关闭${TONE_LABELS[entry.tone] || ""}通知：${entry.message}`.slice(0, 80));
    closeBtn.textContent = "关闭";
    closeBtn.addEventListener("click", () => dismiss(entry.id, { restoreSiblingFocus: true }));

    item.addEventListener("pointerenter", () => pauseTimer(entry));
    item.addEventListener("pointerleave", () => {
      if (visible.includes(entry) && !entry.leaving) startTimer(entry);
    });
    item.addEventListener("focusin", () => pauseTimer(entry));
    item.addEventListener("focusout", (event) => {
      if (!item.contains(event.relatedTarget) && visible.includes(entry) && !entry.leaving) {
        startTimer(entry);
      }
    });

    item.append(badge, body, closeBtn);
    entry.node = item;
    entry.textNode = text;
    entry.countNode = countBadge;
    return item;
  }

  function mountEntry(entry) {
    ensureRegion();
    if (!listNode) return;
    const node = renderToastNode(entry);
    visible.push(entry);
    listNode.append(node);
    announce(entry.tone, entry.message);
    if (!prefersReducedMotion(view) && typeof node.animate === "function") {
      entry.enterAnim = node.animate(
        [
          { opacity: 0, transform: "translate3d(0, 10px, 0)" },
          { opacity: 1, transform: "translate3d(0, 0, 0)" },
        ],
        { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "none" },
      );
      entry.enterAnim?.finished?.catch?.(() => {});
    }
    startTimer(entry);
  }

  function flushQueue() {
    while (!disposed && visible.length < maxVisible && queue.length > 0) {
      const errIdx = queue.findIndex((item) => item.tone === "error");
      const next = queue.splice(errIdx >= 0 ? errIdx : 0, 1)[0];
      mountEntry(next);
    }
  }

  function insertQueued(entry, front = false) {
    if (front) queue.unshift(entry);
    else queue.push(entry);
    return entry.id;
  }

  function enqueueItem(entry, { front = false } = {}) {
    if (maxQueue <= 0) return null;
    if (queue.length >= maxQueue) {
      // Never drop queued errors if low-priority non-errors can be evicted.
      const dropIndex = queue.findIndex((item) => item.tone !== "error");
      if (dropIndex >= 0) {
        queue.splice(dropIndex, 1);
        return insertQueued(entry, front);
      }
      if (entry.tone !== "error") return null;

      // Queue is saturated with error toasts: coalesce overflow errors cleanly so none are silently discarded.
      const overflowKey = "__error_overflow__";
      const existingOverflow = queue.find((item) => item.dedupeKey === overflowKey);
      if (existingOverflow) {
        existingOverflow.count += 1;
        existingOverflow.sticky = true;
        existingOverflow.remainingMs = Infinity;
        existingOverflow.message = `另有 ${existingOverflow.count} 条错误待处理（最新：${entry.message}）`;
        return existingOverflow.id;
      }
      const displaced = queue.pop();
      const summaryCount = 1 + (displaced?.count || 0);
      const summaryEntry = {
        id: displaced?.id || entry.id,
        tone: "error",
        message: `另有 ${summaryCount} 条错误待处理（最新：${entry.message}）`,
        dedupeKey: overflowKey,
        sticky: true,
        remainingMs: Infinity,
        count: summaryCount,
        actionLabel: entry.actionLabel || displaced?.actionLabel || "",
        onAction: entry.onAction || displaced?.onAction || null,
        leaving: false,
        node: null,
        countNode: null,
        enterAnim: null,
        exitAnim: null,
      };
      queue.push(summaryEntry);
      return summaryEntry.id;
    }
    return insertQueued(entry, front);
  }

  function show(input, maybeOptions = {}) {
    if (disposed) return null;
    const opts = typeof input === "string" ? { message: input, ...maybeOptions } : { ...(input || {}), ...(maybeOptions || {}) };
    const message = String(opts.message || "").trim();
    if (!message) return null;
    const tone = VALID_TONES.has(opts.tone) ? opts.tone : "info";
    if (opts.contextToken !== undefined && opts.contextToken !== contextToken && tone !== "error") {
      return null;
    }
    const dedupeKey = String(opts.dedupeKey || `${tone}:${message}`);
    const sticky = opts.sticky === true || opts.duration === Infinity;
    const duration = sticky
      ? Infinity
      : Math.max(800, Number(opts.duration) || durations[tone] || DEFAULT_DURATIONS.info);

    // Deduplicate identical active or queued toast.
    const existing = visible.find((item) => !item.leaving && item.dedupeKey === dedupeKey)
      || queue.find((item) => item.dedupeKey === dedupeKey);
    if (existing) {
      existing.count += 1;
      existing.remainingMs = duration;
      existing.sticky = sticky;
      if (opts.message && existing.message !== message) {
        existing.message = message;
        if (existing.textNode) existing.textNode.textContent = message;
      }
      if (opts.actionLabel && typeof opts.onAction === "function") {
        existing.actionLabel = String(opts.actionLabel);
        existing.onAction = opts.onAction;
      }
      if (existing.countNode) {
        existing.countNode.textContent = `×${existing.count}`;
        existing.countNode.hidden = false;
      }
      if (visible.includes(existing)) startTimer(existing);
      return existing.id;
    }

    const entry = {
      id: `toast-${++seq}`,
      tone,
      message,
      dedupeKey,
      sticky,
      scoped: Boolean(opts.scoped || opts.contextToken !== undefined),
      contextToken: opts.contextToken ?? contextToken,
      remainingMs: duration,
      count: 1,
      actionLabel: opts.actionLabel ? String(opts.actionLabel) : "",
      onAction: typeof opts.onAction === "function" ? opts.onAction : null,
      leaving: false,
      node: null,
      textNode: null,
      countNode: null,
      enterAnim: null,
      exitAnim: null,
    };

    if (visible.length < maxVisible) {
      mountEntry(entry);
      return entry.id;
    }

    // Critical errors preempt non-error visible toasts so urgent failures never starve behind info/success.
    // Never displace a toast currently focused by keyboard or prefer evicting non-actionable toasts first.
    if (entry.tone === "error") {
      const activeEl = doc.activeElement;
      const isFocused = (item) => Boolean(activeEl && item.node?.contains?.(activeEl));
      let victimIndex = visible.findIndex((item) => !item.leaving && item.tone !== "error" && !isFocused(item) && !item.onAction);
      if (victimIndex < 0) {
        victimIndex = visible.findIndex((item) => !item.leaving && item.tone !== "error" && !isFocused(item));
      }
      if (victimIndex < 0) {
        victimIndex = visible.findIndex((item) => !item.leaving && item.tone !== "error");
      }
      if (victimIndex >= 0) {
        const [victim] = visible.splice(victimIndex, 1);
        pauseTimer(victim);
        try { victim.enterAnim?.cancel(); } catch (_) {}
        try { victim.exitAnim?.cancel(); } catch (_) {}
        victim.node?.remove?.();
        victim.node = null;
        victim.textNode = null;
        victim.countNode = null;
        enqueueItem(victim, { front: true });
        mountEntry(entry);
        return entry.id;
      }
    }

    // Never allow a quick non-error toast to overwrite or evict an active error toast.
    enqueueItem(entry);
    return entry.id;
  }

  function finalizeRemoval(entry, { restoreSiblingFocus = false } = {}) {
    clearTimer(entry.id);
    const activeEl = doc.activeElement;
    const hadFocus = Boolean(restoreSiblingFocus && activeEl && entry.node?.contains?.(activeEl));
    const idx = visible.indexOf(entry);
    if (idx >= 0) visible.splice(idx, 1);
    try { entry.enterAnim?.cancel(); } catch (_) {}
    try { entry.exitAnim?.cancel(); } catch (_) {}
    entry.node?.remove?.();
    entry.node = null;
    entry.textNode = null;
    flushQueue();
    if (hadFocus && visible.length > 0) {
      const targetBtn = visible[0]?.node?.querySelector?.(".ds-toast-action, .ds-toast-close");
      targetBtn?.focus?.({ preventScroll: true });
    }
  }

  function dismiss(id, options = {}) {
    const qIdx = queue.findIndex((item) => item.id === id);
    if (qIdx >= 0) {
      queue.splice(qIdx, 1);
      return;
    }
    const entry = visible.find((item) => item.id === id);
    if (!entry || entry.leaving) return;
    entry.leaving = true;
    clearTimer(entry.id);
    entry.node?.setAttribute("data-leaving", "true");
    if (prefersReducedMotion(view) || typeof entry.node?.animate !== "function") {
      finalizeRemoval(entry, options);
      return;
    }
    entry.exitAnim = entry.node.animate(
      [
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
        { opacity: 0, transform: "translate3d(0, 8px, 0) scale(0.97)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
    );
    entry.exitAnim.finished.then(() => finalizeRemoval(entry, options), () => finalizeRemoval(entry, options));
  }

  function dismissByKey(dedupeKey) {
    if (!dedupeKey) return;
    const key = String(dedupeKey);
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].dedupeKey === key) queue.splice(i, 1);
    }
    for (const entry of [...visible]) {
      if (entry.dedupeKey === key) dismiss(entry.id);
    }
  }

  function clear({ includeErrors = true } = {}) {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (includeErrors || queue[i].tone !== "error") queue.splice(i, 1);
    }
    for (const entry of [...visible]) {
      if (includeErrors || entry.tone !== "error") finalizeRemoval(entry);
    }
  }

  function invalidateContext({ includeErrors = false } = {}) {
    contextToken += 1;
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      const item = queue[i];
      if (item.scoped && (includeErrors || (item.tone !== "error" && !item.sticky))) {
        queue.splice(i, 1);
      }
    }
    for (const entry of [...visible]) {
      if (entry.scoped && (includeErrors || (entry.tone !== "error" && !entry.sticky))) {
        finalizeRemoval(entry);
      }
    }
    return contextToken;
  }

  function onUnload(event) {
    if (event?.type === "pagehide" && event?.persisted) {
      for (const id of [...timers.keys()]) clearTimer(id);
      return;
    }
    dispose();
  }

  view?.addEventListener?.("beforeunload", onUnload);
  view?.addEventListener?.("pagehide", onUnload);

  function dispose() {
    if (disposed) return;
    disposed = true;
    view?.removeEventListener?.("beforeunload", onUnload);
    view?.removeEventListener?.("pagehide", onUnload);
    for (const id of [...timers.keys()]) clearTimer(id);
    for (const entry of [...visible]) {
      try { entry.enterAnim?.cancel(); } catch (_) {}
      try { entry.exitAnim?.cancel(); } catch (_) {}
      entry.node?.remove?.();
    }
    visible.length = 0;
    queue.length = 0;
    region?.remove?.();
    region = null;
    listNode = null;
    politeLive = null;
    assertiveLive = null;
    if (doc && sharedManagers.get(doc) === api) {
      sharedManagers.delete(doc);
    }
  }

  function snapshot() {
    return {
      visible: visible.map((item) => ({ id: item.id, tone: item.tone, message: item.message, count: item.count })),
      queued: queue.map((item) => ({ id: item.id, tone: item.tone, message: item.message, count: item.count })),
      maxVisible,
      contextToken,
      disposed,
    };
  }

  const api = Object.freeze({
    get disposed() {
      return disposed;
    },
    show,
    info: (message, opts) => show({ ...opts, message, tone: "info" }),
    success: (message, opts) => show({ ...opts, message, tone: "success" }),
    warning: (message, opts) => show({ ...opts, message, tone: "warning" }),
    error: (message, opts) => show({ ...opts, message, tone: "error" }),
    dismiss,
    dismissByKey,
    clear,
    invalidateContext,
    getContextToken: () => contextToken,
    setContextToken: (next) => { contextToken = Number(next) || 0; return contextToken; },
    dispose,
    snapshot,
  });
  return api;
}

export function getSharedToastManager(doc = globalThis.document) {
  if (!doc) return createToastManager({ doc: null });
  let manager = sharedManagers.get(doc);
  if (!manager || manager.disposed) {
    manager = createToastManager({ doc });
    sharedManagers.set(doc, manager);
  }
  return manager;
}

export function showToast(input, options = {}, doc = globalThis.document) {
  return getSharedToastManager(doc).show(input, options);
}

export function dismissToast(id, doc = globalThis.document) {
  getSharedToastManager(doc).dismiss(id);
}

export function dismissToastByKey(dedupeKey, doc = globalThis.document) {
  getSharedToastManager(doc).dismissByKey(dedupeKey);
}

export function invalidateToastContext(options = {}, doc = globalThis.document) {
  return getSharedToastManager(doc).invalidateContext(options);
}

// ============================================================================
// 4. Platform-Adaptive Modal & Mobile Gesture Drawer Adapter
// ============================================================================
const MOBILE_BREAKPOINT = 760;
const adapters = new WeakMap();
const scrollLocks = new WeakMap();

export function isMobileSheetViewport(view = globalThis.window) {
  if (!view) return false;
  return (Number(view.innerWidth) || 0) <= MOBILE_BREAKPOINT;
}

export function syncModalScrollLock(doc = globalThis.document) {
  if (!doc?.body) return false;
  const openLayers = [...(doc.querySelectorAll?.(".modal-layer:not(.hidden)") || [])]
    .filter((layer) => layer.dataset?.sheetWorkspace !== "true" && layer.getAttribute?.("aria-hidden") !== "true");
  const active = openLayers.length > 0;
  doc.body.classList?.toggle("modal-open", active);
  scrollLocks.set(doc, openLayers.length);
  return active;
}

export function getScrollLockCount(doc = globalThis.document) {
  return scrollLocks.get(doc) || 0;
}

function setBackgroundScale(doc, scaleTarget) {
  // Never transform:scale #v3AppFrame or WebView root containers (breaks layout geometry & Task 27 width invariants).
  if (scaleTarget?.style) scaleTarget.style.removeProperty("--ds-bg-scale");
  doc?.body?.classList?.remove("ds-sheet-scaling");
}

function rubberBand(offset) {
  // Subtle upward resistance when user pulls above resting position.
  return -Math.min(28, Math.pow(Math.abs(offset), 0.72));
}

export function attachSheetAdapter(modalLayer, {
  panel = null,
  onRequestClose = null,
  scaleTarget = null,
  dismissible = true,
  mobileDrawer = true,
  doc = modalLayer?.ownerDocument || globalThis.document,
  view = doc?.defaultView || globalThis.window,
} = {}) {
  if (!modalLayer) return { dispose() {}, syncMode() {}, reset() {} };
  if (adapters.has(modalLayer)) return adapters.get(modalLayer);

  const panelEl = panel || modalLayer.querySelector?.(".modal-panel") || modalLayer.firstElementChild;
  if (!panelEl) return { dispose() {}, syncMode() {}, reset() {} };

  const canSwipeDismiss = dismissible
    && !modalLayer.hasAttribute?.("data-confirm-only")
    && modalLayer.getAttribute?.("role") !== "alertdialog"
    && panelEl.getAttribute?.("role") !== "alertdialog";

  let handleEl = panelEl.querySelector?.(".ds-sheet-handle") || null;
  let createdHandle = false;
  if (canSwipeDismiss && mobileDrawer && !handleEl && doc?.createElement) {
    handleEl = doc.createElement("div");
    handleEl.className = "ds-sheet-handle";
    handleEl.setAttribute("aria-hidden", "true");
    const pill = doc.createElement("span");
    pill.className = "ds-sheet-handle-pill";
    handleEl.append(pill);
    panelEl.prepend(handleEl);
    createdHandle = true;
  }

  let drag = null;
  let snapAnim = null;
  let rafId = 0;

  function resolveScaleTarget() {
    if (scaleTarget) return scaleTarget;
    return doc?.querySelector?.(".app-scale-wrap") || doc?.getElementById?.("v3AppFrame") || null;
  }

  function syncMode() {
    const mobile = isMobileSheetViewport(view);
    const useDrawer = Boolean(mobile && mobileDrawer && canSwipeDismiss);
    modalLayer.dataset.sheetMode = useDrawer ? "drawer" : "modal";
    panelEl.classList?.toggle("gesture-sheet", useDrawer);
    if (handleEl) handleEl.hidden = !useDrawer;
    return useDrawer;
  }

  function resetVisuals() {
    if (rafId) view?.cancelAnimationFrame?.(rafId);
    rafId = 0;
    try { snapAnim?.cancel(); } catch (_) {}
    snapAnim = null;
    drag = null;
    panelEl.removeAttribute?.("data-sheet-dragging");
    if (panelEl.style) {
      panelEl.style.transform = "";
      panelEl.style.transition = "";
    }
    if (modalLayer.style) {
      modalLayer.style.removeProperty("--ds-backdrop-alpha");
    }
    const openOther = [...(doc?.querySelectorAll?.(".modal-layer:not(.hidden)") || [])]
      .some((el) => el !== modalLayer && el.dataset?.sheetWorkspace !== "true");
    if (!openOther) setBackgroundScale(doc, resolveScaleTarget(), 0, true);
  }

  function applyDragFrame() {
    rafId = 0;
    if (!drag) return;
    const rawDy = drag.latestY - drag.startY;
    const dy = rawDy < 0 ? rubberBand(rawDy) : rawDy;
    drag.currentDy = dy;
    const panelHeight = Math.max(160, drag.panelHeight || 360);
    const progress = Math.max(0, Math.min(1, dy / panelHeight));
    if (panelEl.style) {
      panelEl.style.transform = `translate3d(0, ${dy.toFixed(1)}px, 0)`;
    }
    if (modalLayer.style) {
      modalLayer.style.setProperty("--ds-backdrop-alpha", String(Math.max(0.15, 1 - progress * 0.85).toFixed(3)));
    }
    setBackgroundScale(doc, resolveScaleTarget(), 1 - progress, prefersReducedMotion(view));
  }

  function snapBack() {
    const startDy = drag?.currentDy || 0;
    drag = null;
    panelEl.removeAttribute?.("data-sheet-dragging");
    if (modalLayer.style) modalLayer.style.removeProperty("--ds-backdrop-alpha");
    const reduced = prefersReducedMotion(view);
    setBackgroundScale(doc, resolveScaleTarget(), 1, reduced);
    if (reduced || typeof panelEl.animate !== "function" || Math.abs(startDy) < 1) {
      if (panelEl.style) panelEl.style.transform = "";
      return;
    }
    if (panelEl.style) panelEl.style.transform = "";
    snapAnim = panelEl.animate(
      [
        { transform: `translate3d(0, ${startDy.toFixed(1)}px, 0)` },
        { transform: "translate3d(0, 0, 0)" },
      ],
      { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "none" },
    );
    snapAnim.finished.then(() => { snapAnim = null; }, () => { snapAnim = null; });
  }

  function onPointerDown(event) {
    if (!canSwipeDismiss || modalLayer.classList?.contains?.("hidden")) return;
    if (!syncMode()) return;
    if (event.button !== 0 || event.isPrimary === false) return;
    const onHandle = handleEl && (event.target === handleEl || handleEl.contains?.(event.target));
    const interactive = event.target?.closest?.("button, a, input, select, textarea, label, [role='tab']");
    if (interactive && !onHandle) return;
    // Allow internal vertical scroll when content is scrolled down unless grabbing the top handle.
    if (!onHandle && (panelEl.scrollTop || 0) > 2) return;

    try { snapAnim?.cancel(); } catch (_) {}
    snapAnim = null;
    const now = view?.performance?.now ? view.performance.now() : Date.now();
    drag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      latestY: event.clientY,
      prevY: event.clientY,
      prevAt: now,
      velocityY: 0,
      currentDy: 0,
      moved: false,
      panelHeight: panelEl.getBoundingClientRect?.().height || 360,
    };
    if (onHandle) event.preventDefault();
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rawDy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(rawDy) < 6) return;
      // If user scrolls upward inside body content, yield to native scroll unless on handle.
      const onHandle = handleEl && (event.target === handleEl || handleEl.contains?.(event.target));
      if (!onHandle && rawDy < 0 && (panelEl.scrollHeight > panelEl.clientHeight + 2)) {
        drag = null;
        return;
      }
      drag.moved = true;
      panelEl.setAttribute?.("data-sheet-dragging", "true");
    }
    const now = view?.performance?.now ? view.performance.now() : Date.now();
    const dt = Math.max(1, now - drag.prevAt);
    drag.velocityY = (event.clientY - drag.prevY) / dt;
    drag.prevY = event.clientY;
    drag.prevAt = now;
    drag.latestY = event.clientY;
    if (drag.moved && event.cancelable) event.preventDefault();
    if (!rafId && view?.requestAnimationFrame) {
      rafId = view.requestAnimationFrame(applyDragFrame);
    } else {
      applyDragFrame();
    }
  }

  function onPointerEnd(event) {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    if (rafId) {
      view?.cancelAnimationFrame?.(rafId);
      rafId = 0;
      applyDragFrame();
    }
    if (event.type === "pointercancel" || !drag.moved) {
      snapBack();
      return;
    }
    const dy = drag.currentDy;
    const vy = drag.velocityY;
    const threshold = Math.min(130, Math.max(72, drag.panelHeight * 0.28));
    if (dy > threshold || (dy > 56 && vy > 0.65)) {
      drag = null;
      panelEl.removeAttribute?.("data-sheet-dragging");
      const finishClose = () => {
        if (typeof onRequestClose === "function") {
          onRequestClose("swipe", { currentDy: dy });
        } else {
          resetVisuals();
        }
      };
      if (prefersReducedMotion(view) || typeof panelEl.animate !== "function") {
        finishClose();
        return;
      }
      if (panelEl.style) panelEl.style.transform = "";
      snapAnim = panelEl.animate(
        [
          { transform: `translate3d(0, ${dy.toFixed(1)}px, 0)` },
          { transform: "translate3d(0, 100%, 0)" },
        ],
        { duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
      );
      snapAnim.finished.then(() => {
        snapAnim = null;
        finishClose();
      }, () => {
        snapAnim = null;
        finishClose();
      });
      return;
    }
    snapBack();
  }

  function onOpened() {
    resetVisuals();
    const isDrawer = syncMode();
    if (!isDrawer && !prefersReducedMotion(view)) {
      setBackgroundScale(doc, resolveScaleTarget(), 1, false);
    } else if (isDrawer && !prefersReducedMotion(view)) {
      setBackgroundScale(doc, resolveScaleTarget(), 1, false);
    }
    syncModalScrollLock(doc);
  }

  function onClosed() {
    resetVisuals();
    syncModalScrollLock(doc);
  }

  const onResize = () => {
    if (!modalLayer.classList?.contains?.("hidden")) syncMode();
  };

  const moveTarget = doc?.addEventListener ? doc : panelEl;
  const onBlur = () => { if (drag) snapBack(); };
  panelEl.addEventListener?.("pointerdown", onPointerDown);
  moveTarget.addEventListener?.("pointermove", onPointerMove);
  moveTarget.addEventListener?.("pointerup", onPointerEnd);
  moveTarget.addEventListener?.("pointercancel", onPointerEnd);
  view?.addEventListener?.("blur", onBlur);
  view?.addEventListener?.("resize", onResize, { passive: true });

  syncMode();
  const controller = Object.freeze({
    syncMode,
    onOpened,
    onClosed,
    reset: resetVisuals,
    snapBack,
    dispose() {
      resetVisuals();
      panelEl.removeEventListener?.("pointerdown", onPointerDown);
      moveTarget.removeEventListener?.("pointermove", onPointerMove);
      moveTarget.removeEventListener?.("pointerup", onPointerEnd);
      moveTarget.removeEventListener?.("pointercancel", onPointerEnd);
      view?.removeEventListener?.("blur", onBlur);
      view?.removeEventListener?.("resize", onResize);
      if (createdHandle) handleEl?.remove?.();
      adapters.delete(modalLayer);
    },
  });
  adapters.set(modalLayer, controller);
  return controller;
}

// ============================================================================
// 5. Scroll-Driven 3D Progress & Locked-Frame Bento Parallax
// ============================================================================
export function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function lerp(start, end, progress) {
  const t = clamp01(progress);
  return start + (end - start) * t;
}

/**
 * Compute normalized [0, 1] scroll progress as an element enters from startEdge to endEdge
 * of the viewport height. Reversible when scrolling up or down.
 */
export function computeScrollProgress(rect, viewportHeight, { startEdge = 0.95, endEdge = 0.32 } = {}) {
  if (!rect || !viewportHeight) return 1;
  const startY = viewportHeight * startEdge;
  const endY = viewportHeight * endEdge;
  const span = Math.max(1, startY - endY);
  return clamp01((startY - rect.top) / span);
}

/**
 * Compute continuous multi-stage 3D scroll choreography:
 * Stage 1 (enter): tilted approach flattens to crisp level focal pose.
 * Stage 2 (level): brief sweet-spot plateau so content stays 100% readable & interactive.
 * Stage 3 (exit): continued scroll pitches into gentle receding depth until settled.
 * Fully reversible on upward scroll and configurable via dataset/options.
 */
export function computeMultiStageScroll3d(rect, viewportHeight, {
  startEdge = 0.96,
  midEdge = 0.36,
  exitStartEdge = Math.max(-0.2, midEdge - 0.14),
  exitEndEdge = -0.52,
  maxRx = 12,
  midRx = 0,
  exitRx = -10,
  entryRy = 0,
  midRy = 0,
  exitRy = 0,
  minScale = 0.94,
  midScale = 1,
  exitScale = 0.95,
  maxTy = 24,
  midTy = 0,
  exitTy = -18,
  entryTz = 0,
  midTz = 0,
  exitTz = -24,
  exitEnabled = true,
} = {}) {
  if (!rect || !viewportHeight) {
    return {
      stage: "level",
      enterProgress: 1,
      exitProgress: 0,
      overallProgress: 1,
      rx: midRx,
      ry: midRy,
      scale: midScale,
      ty: midTy,
      tz: midTz,
    };
  }

  const startY = viewportHeight * startEdge;
  const midY = viewportHeight * midEdge;
  const exitStartY = viewportHeight * exitStartEdge;
  const exitEndY = Math.min(viewportHeight * exitEndEdge, -Math.max(180, (rect.height || 280) * 0.48));
  const enterSpan = Math.max(1, startY - midY);
  const enterProgress = clamp01((startY - rect.top) / enterSpan);
  const smooth = (t) => t * t * (3 - 2 * t);

  if (rect.top > midY) {
    const e = smooth(enterProgress);
    return {
      stage: enterProgress <= 0 ? "before" : "enter",
      enterProgress,
      exitProgress: 0,
      overallProgress: exitEnabled ? enterProgress * 0.5 : enterProgress,
      rx: lerp(maxRx, midRx, e),
      ry: lerp(entryRy, midRy, e),
      scale: lerp(minScale, midScale, e),
      ty: lerp(maxTy, midTy, e),
      tz: lerp(entryTz, midTz, e),
    };
  }

  if (!exitEnabled || rect.top >= exitStartY) {
    return {
      stage: "level",
      enterProgress: 1,
      exitProgress: 0,
      overallProgress: exitEnabled ? 0.5 : 1,
      rx: midRx,
      ry: midRy,
      scale: midScale,
      ty: midTy,
      tz: midTz,
    };
  }

  const exitSpan = Math.max(1, exitStartY - exitEndY);
  const exitProgress = clamp01((exitStartY - rect.top) / exitSpan);
  const e = smooth(exitProgress);
  return {
    stage: exitProgress >= 1 ? "settled" : "exit",
    enterProgress: 1,
    exitProgress,
    overallProgress: 0.5 + exitProgress * 0.5,
    rx: lerp(midRx, exitRx, e),
    ry: lerp(midRy, exitRy, e),
    scale: lerp(midScale, exitScale, e),
    ty: lerp(midTy, exitTy, e),
    tz: lerp(midTz, exitTz, e),
  };
}

/**
 * Compute centered [-1, 1] travel factor for subtle internal Bento parallax.
 */
export function computeCenteredParallax(rect, viewportHeight) {
  if (!rect || !viewportHeight) return 0;
  const total = Math.max(1, viewportHeight + (rect.height || 0));
  const raw = (viewportHeight - rect.top) / total;
  return Math.max(-1, Math.min(1, raw * 2 - 1));
}

export function createScrollProgressController({
  root = globalThis.document,
  doc = root?.ownerDocument || globalThis.document,
  view = doc?.defaultView || globalThis.window,
  onSample = null,
} = {}) {
  if (!root || !view) {
    return { refresh() {}, updateNow() {}, dispose() {} };
  }

  let disposed = false;
  let rafId = 0;
  const visibleElements = new Set();
  const observedElements = new Set();

  const readTargets = () => {
    const raw3d = [...(root.querySelectorAll?.("[data-scroll-3d], .scroll-preview-wrap") || [])];
    const rawBento = [...(root.querySelectorAll?.("[data-bento-wall], .apple-bento-wall") || [])];
    const scroll3d = raw3d.filter((el) => !el.matches || el.matches("[data-scroll-3d], .scroll-preview-wrap"));
    const bentoWalls = rawBento.filter((el) => !el.matches || el.matches("[data-bento-wall], .apple-bento-wall"));
    return { scroll3d, bentoWalls };
  };

  function resetNode(el, isBento = false) {
    if (!el?.style?.setProperty) return;
    if (isBento) {
      el.querySelectorAll?.(".tile-inner")?.forEach?.((inner) => {
        inner.style?.setProperty?.("--ds-parallax-y", "0px");
      });
      return;
    }
    el.style.setProperty("--ds-scroll-progress", "1");
    el.style.setProperty("--ds-scroll-rx", "0deg");
    el.style.setProperty("--ds-scroll-ry", "0deg");
    el.style.setProperty("--ds-scroll-scale", "1");
    el.style.setProperty("--ds-scroll-ty", "0px");
    el.style.setProperty("--ds-scroll-tz", "0px");
    if (el.dataset) el.dataset.scrollStage = "reduced";
  }

  function applyScroll3dSample(el, rect, vh) {
    if (!el?.style?.setProperty) return null;
    const startEdge = Number(el.dataset?.scrollStart ?? 0.96);
    const midEdge = Number(el.dataset?.scrollEnd ?? 0.34);
    const exitStartEdge = el.dataset?.scrollExitStart != null
      ? Number(el.dataset.scrollExitStart)
      : Math.max(-0.18, midEdge - 0.14);
    const exitEndEdge = Number(el.dataset?.scrollExitEnd ?? -0.52);
    const maxRx = Number(el.dataset?.scrollMaxRx ?? 12);
    const exitRx = Number(el.dataset?.scrollExitRx ?? -10);
    const entryRy = Number(el.dataset?.scrollEntryRy ?? 0);
    const exitRy = Number(el.dataset?.scrollExitRy ?? 0);
    const minScale = Number(el.dataset?.scrollMinScale ?? 0.94);
    const exitScale = Number(el.dataset?.scrollExitScale ?? 0.95);
    const maxTy = Number(el.dataset?.scrollMaxTy ?? 24);
    const exitTy = Number(el.dataset?.scrollExitTy ?? -18);
    const entryTz = Number(el.dataset?.scrollEntryTz ?? 0);
    const exitTz = Number(el.dataset?.scrollExitTz ?? -24);
    const exitEnabled = el.dataset?.scrollExit !== "false";

    const sample = computeMultiStageScroll3d(rect, vh, {
      startEdge,
      midEdge,
      exitStartEdge,
      exitEndEdge,
      maxRx,
      exitRx,
      entryRy,
      exitRy,
      minScale,
      exitScale,
      maxTy,
      exitTy,
      entryTz,
      exitTz,
      exitEnabled,
    });

    el.style.setProperty("--ds-scroll-progress", sample.overallProgress.toFixed(4));
    el.style.setProperty("--ds-scroll-rx", `${sample.rx.toFixed(2)}deg`);
    el.style.setProperty("--ds-scroll-ry", `${sample.ry.toFixed(2)}deg`);
    el.style.setProperty("--ds-scroll-scale", sample.scale.toFixed(4));
    el.style.setProperty("--ds-scroll-ty", `${sample.ty.toFixed(2)}px`);
    el.style.setProperty("--ds-scroll-tz", `${sample.tz.toFixed(2)}px`);
    if (el.dataset) el.dataset.scrollStage = sample.stage;
    return { el, progress: sample.overallProgress, ...sample };
  }

  function updateNow() {
    rafId = 0;
    if (disposed) return;
    const reduced = prefersReducedMotion(view);
    const { scroll3d, bentoWalls } = readTargets();
    const vh = view.innerHeight || doc?.documentElement?.clientHeight || 900;

    if (reduced) {
      for (const el of scroll3d) resetNode(el, false);
      for (const wall of bentoWalls) resetNode(wall, true);
      onSample?.({ reduced: true, scroll3d: [], bento: [] });
      return;
    }

    // Batch-read all active rects first (avoid read-write interleaving).
    const active3d = scroll3d
      .filter((el) => !observedElements.size || visibleElements.has(el))
      .map((el) => ({ el, rect: el.getBoundingClientRect() }));
    const activeWalls = bentoWalls
      .filter((wall) => !observedElements.size || visibleElements.has(wall))
      .map((wall) => ({
        wall,
        rect: wall.getBoundingClientRect(),
        inners: [...(wall.querySelectorAll?.(".tile-inner") || [])],
      }));

    // Batch-write GPU CSS custom properties.
    const sampled3d = [];
    for (const { el, rect } of active3d) {
      const entry = applyScroll3dSample(el, rect, vh);
      if (entry) sampled3d.push(entry);
    }

    const sampledBento = [];
    for (const { wall, rect, inners } of activeWalls) {
      const centered = computeCenteredParallax(rect, vh);
      const maxShift = Number(wall.dataset?.parallaxMax ?? 14);
      for (const inner of inners) {
        const speed = Number(inner.dataset?.parallaxSpeed ?? 0.55);
        const shift = Math.max(-maxShift, Math.min(maxShift, centered * speed * maxShift));
        inner.style.setProperty("--ds-parallax-y", `${shift.toFixed(2)}px`);
        sampledBento.push({ inner, shift });
      }
    }

    onSample?.({ reduced: false, scroll3d: sampled3d, bento: sampledBento });
  }

  function schedule() {
    if (disposed || rafId) return;
    if (typeof view.requestAnimationFrame === "function") {
      rafId = view.requestAnimationFrame(updateNow);
    } else {
      updateNow();
    }
  }

  const intersectionObserver = typeof view.IntersectionObserver === "function"
    ? new view.IntersectionObserver((entries) => {
      const reduced = prefersReducedMotion(view);
      const vh = view.innerHeight || doc?.documentElement?.clientHeight || 900;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visibleElements.add(entry.target);
        } else {
          visibleElements.delete(entry.target);
          // Compute one final boundary sample when leaving margin so fast scrolls never freeze mid-stage.
          if (!reduced && (entry.target.matches?.("[data-scroll-3d], .scroll-preview-wrap"))) {
            applyScroll3dSample(entry.target, entry.boundingClientRect || entry.target.getBoundingClientRect(), vh);
          }
        }
      }
      schedule();
    }, { rootMargin: "360px 0px" })
    : null;

  function refresh() {
    if (disposed) return;
    const { scroll3d, bentoWalls } = readTargets();
    const allTargets = new Set([...scroll3d, ...bentoWalls]);
    for (const el of [...observedElements]) {
      if (!allTargets.has(el)) {
        intersectionObserver?.unobserve(el);
        observedElements.delete(el);
        visibleElements.delete(el);
      }
    }
    for (const el of allTargets) {
      if (!observedElements.has(el)) {
        observedElements.add(el);
        visibleElements.add(el);
        intersectionObserver?.observe(el);
      }
    }
    updateNow();
  }

  const onReducedChange = () => schedule();
  const media = view.matchMedia?.("(prefers-reduced-motion: reduce)");

  view.addEventListener?.("scroll", schedule, { passive: true });
  view.addEventListener?.("resize", schedule, { passive: true });
  doc?.addEventListener?.("thewyj:reduced-motion", onReducedChange);
  media?.addEventListener?.("change", onReducedChange);

  refresh();

  return Object.freeze({
    refresh,
    updateNow,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId) view.cancelAnimationFrame?.(rafId);
      rafId = 0;
      intersectionObserver?.disconnect();
      const { scroll3d, bentoWalls } = readTargets();
      for (const el of scroll3d) resetNode(el, false);
      for (const wall of bentoWalls) resetNode(wall, true);
      visibleElements.clear();
      observedElements.clear();
      view.removeEventListener?.("scroll", schedule);
      view.removeEventListener?.("resize", schedule);
      doc?.removeEventListener?.("thewyj:reduced-motion", onReducedChange);
      media?.removeEventListener?.("change", onReducedChange);
    },
  });
}

// ============================================================================
// 6. Delegated Controls, Tab Indicator & Skeleton Switcher Orchestrator
// ============================================================================
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
  let activeAbort = null;
  let pendingResolve = null;
  let lockedMinHeight = "";

  function restorePanelHeight(panel = activePanel) {
    if (panel?.style && lockedMinHeight !== "") {
      panel.style.minHeight = lockedMinHeight;
      lockedMinHeight = "";
    }
  }

  function clearPending() {
    if (timerId && view?.clearTimeout) {
      view.clearTimeout(timerId);
    }
    timerId = 0;
    if (activeAbort) {
      try { activeAbort.abort(); } catch (_) {}
      activeAbort = null;
    }
    if (pendingResolve) {
      const done = pendingResolve;
      pendingResolve = null;
      done(false);
    }
    restorePanelHeight();
    if (activePanel) {
      activePanel.removeAttribute?.("data-skeleton-loading");
      activePanel.removeAttribute?.("aria-busy");
    }
  }

  function animateEntrance(panel) {
    const doc = panel?.ownerDocument || view?.document;
    const focused = doc?.activeElement;
    const preserveInputFocus = Boolean(
      focused && panel?.contains?.(focused) && focused.matches?.("input, textarea, select, [contenteditable]"),
    );
    if (!preserveInputFocus && !prefersReducedMotion(view) && typeof panel?.animate === "function") {
      panel.animate(
        [{ opacity: 0.72, transform: "translate3d(0, 4px, 0)" }, { opacity: 1, transform: "translate3d(0, 0, 0)" }],
        { duration: 140, easing: MOTION.easing, fill: "none" },
      )?.finished?.catch?.(() => {});
    }
  }

  async function finalizeRender(panel, renderContent, token, abortCtrl) {
    try {
      await renderContent(panel, { signal: abortCtrl?.signal, generation: token });
    } catch (error) {
      if (token !== generation || abortCtrl?.signal?.aborted) {
        return false;
      }
      panel.removeAttribute?.("data-skeleton-loading");
      panel.removeAttribute?.("aria-busy");
      throw error;
    }
    if (token !== generation || abortCtrl?.signal?.aborted) {
      restorePanelHeight(panel);
      return false;
    }
    panel.removeAttribute?.("data-skeleton-loading");
    panel.removeAttribute?.("aria-busy");
    restorePanelHeight(panel);
    animateEntrance(panel);
    return true;
  }

  function switchTab(panel, renderContent, { immediate = false } = {}) {
    const token = ++generation;
    clearPending();
    activePanel = panel || null;
    if (!panel || typeof renderContent !== "function") return Promise.resolve(false);

    const abortCtrl = typeof AbortController === "function"
      ? new AbortController()
      : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
    activeAbort = abortCtrl;

    const ms = immediate || prefersReducedMotion(view) ? 0 : Math.max(120, Math.min(150, Number(duration) || MOTION.skeleton));
    if (!ms || !view?.setTimeout) {
      return finalizeRender(panel, renderContent, token, abortCtrl);
    }

    const prevHeight = panel.getBoundingClientRect?.().height || 0;
    if (panel.style && prevHeight > 0) {
      lockedMinHeight = panel.style.minHeight || "";
      panel.style.minHeight = `${Math.ceil(prevHeight)}px`;
    }
    panel.setAttribute?.("data-skeleton-loading", "true");
    panel.setAttribute?.("aria-busy", "true");

    return new Promise((resolve, reject) => {
      pendingResolve = resolve;
      timerId = view.setTimeout(() => {
        timerId = 0;
        pendingResolve = null;
        if (token !== generation || abortCtrl.signal.aborted) {
          resolve(false);
          return;
        }
        finalizeRender(panel, renderContent, token, abortCtrl).then(resolve, reject);
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
  onDropEvent = null,
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
    if (typeof onDropEvent === "function") {
      if (files.length && typeof validate === "function") {
        const check = validate(files);
        if (check && check.ok === false) {
          setState("error");
          showToast({ tone: "error", message: check.message || "文件校验未通过，请重新选择。" }, {}, doc);
          return;
        }
      }
      setState("idle");
      onDropEvent(event, files);
      return;
    }
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
    computeScrollProgress,
    computeMultiStageScroll3d,
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
    if (!group || !group.isConnected || indicatorFrames.has(group)) return;
    indicatorFrames.set(group, view.requestAnimationFrame(() => {
      indicatorFrames.delete(group);
      if (group.isConnected && group.getBoundingClientRect().width > 0) updateIndicator(group);
    }));
  }

  const tabObserver = new view.MutationObserver((records) => {
    for (const record of records) {
      const group = record.target.closest?.("[role='tablist']");
      if (group) scheduleIndicator(group);
    }
  });

  function pruneDisconnectedTablists() {
    let pruned = 0;
    for (const group of [...observedTablists]) {
      if (group?.isConnected) continue;
      observedTablists.delete(group);
      indicators.get(group)?.remove?.();
      indicators.delete(group);
      const pendingFrame = indicatorFrames.get(group);
      if (pendingFrame) {
        view.cancelAnimationFrame(pendingFrame);
        indicatorFrames.delete(group);
      }
      pruned += 1;
    }
    if (pruned > 0) {
      tabObserver.disconnect();
      for (const group of observedTablists) {
        tabObserver.observe(group, { subtree: true, attributes: true, attributeFilter: ["aria-selected", "class"] });
      }
    }
    return pruned;
  }

  function registerTabGroup(group) {
    if (!group || !group.isConnected || observedTablists.has(group)) return;
    observedTablists.add(group);
    tabObserver.observe(group, { subtree: true, attributes: true, attributeFilter: ["aria-selected", "class"] });
    if (group.getBoundingClientRect().width > 0) updateIndicator(group);
  }

  const initialTabGroups = [...doc.querySelectorAll("[role='tablist']")];
  for (const group of initialTabGroups) registerTabGroup(group);

  listen("click", () => {
    // Covers a tablist revealed by navigation; prune stale groups first.
    pruneDisconnectedTablists();
    for (const group of observedTablists) scheduleIndicator(group);
  }, { capture: false });

  // Also discover dynamically mounted [role='tablist'] nodes in real DOM documents, and prune detached ones.
  if (doc.documentElement?.nodeType === 1) {
    const dynamicTabObserver = new view.MutationObserver((records) => {
      let hadRemoval = false;
      for (const record of records) {
        if (record.removedNodes?.length) hadRemoval = true;
        for (const node of record.addedNodes || []) {
          if (node.nodeType !== 1) continue;
          if (node.getAttribute?.("role") === "tablist") registerTabGroup(node);
          node.querySelectorAll?.("[role='tablist']")?.forEach(registerTabGroup);
        }
      }
      if (hadRemoval) pruneDisconnectedTablists();
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
    pruneDisconnectedTablists();
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

const activeRouteEntrances = new WeakMap();

/**
 * Play a transform-only route view entrance (keeps opacity: 1 for WCAG contrast)
 * while interrupting cleanly on rapid route switching and respecting reduced motion.
 */
export function animateRouteViewEntrance(element, {
  view = globalThis.window,
  distanceY = 8,
  duration = MOTION.page,
} = {}) {
  if (!element || typeof element.animate !== "function" || prefersReducedMotion(view)) return null;
  const prev = activeRouteEntrances.get(element);
  if (prev) {
    try { prev.cancel(); } catch (_) {}
  }
  const animation = element.animate(
    [
      { transform: `translate3d(0, ${distanceY}px, 0)` },
      { transform: "translate3d(0, 0, 0)" },
    ],
    {
      duration: Math.max(140, Math.min(260, Number(duration) || 200)),
      easing: MOTION.easing,
      fill: "none",
    },
  );
  activeRouteEntrances.set(element, animation);
  animation.finished?.then?.(() => {
    if (activeRouteEntrances.get(element) === animation) activeRouteEntrances.delete(element);
  }, () => {
    if (activeRouteEntrances.get(element) === animation) activeRouteEntrances.delete(element);
  });
  return animation;
}

const RELEASE_SEARCH = (() => {
  try {
    return new URL(import.meta.url).search || "";
  } catch (_) {
    return "";
  }
})();

export const DEFAULT_PREFETCH_ROUTES = Object.freeze({
  tools: [`/tools.js${RELEASE_SEARCH}`],
  workflows: [`/workflows.js${RELEASE_SEARCH}`, `/tools.js${RELEASE_SEARCH}`],
  finance: [`/js/finance/app.js${RELEASE_SEARCH}`, `/js/finance/candidates.js${RELEASE_SEARCH}`],
  language: [`/learning-sync.js${RELEASE_SEARCH}`],
  changelog: [`/changelog.js${RELEASE_SEARCH}`],
  account: [`/js/account/security-center.js${RELEASE_SEARCH}`],
});

/**
 * Low-priority static module/asset prefetcher for likely next routes.
 * Respects offline status, Save-Data, slow 2G connections, and never touches private API data.
 */
export function createAssetPrefetcher({
  doc = globalThis.document,
  view = globalThis.window,
  routes = DEFAULT_PREFETCH_ROUTES,
} = {}) {
  const prefetched = new Set();
  function networkAllowsPrefetch() {
    const nav = view?.navigator || globalThis.navigator;
    if (nav?.onLine === false) return false;
    const conn = nav?.connection || nav?.mozConnection || nav?.webkitConnection;
    if (conn?.saveData === true) return false;
    const eff = String(conn?.effectiveType || "").toLowerCase();
    if (eff === "slow-2g" || eff === "2g") return false;
    return true;
  }
  function prefetchUrl(url) {
    if (!doc?.head || !url || prefetched.has(url) || !networkAllowsPrefetch()) return false;
    prefetched.add(url);
    const link = doc.createElement("link");
    link.rel = "prefetch";
    link.href = url;
    link.crossOrigin = "anonymous";
    doc.head.append(link);
    return true;
  }
  function prefetchRoute(routeKey) {
    const assets = routes?.[routeKey];
    if (!Array.isArray(assets) || !networkAllowsPrefetch()) return 0;
    let count = 0;
    for (const url of assets) {
      if (prefetchUrl(url)) count += 1;
    }
    return count;
  }
  function scheduleIdleWarmup(keys = ["tools", "changelog"]) {
    if (!networkAllowsPrefetch()) return;
    const run = () => {
      for (const key of keys) prefetchRoute(key);
    };
    if (typeof view?.requestIdleCallback === "function") {
      view.requestIdleCallback(run, { timeout: 2200 });
    } else if (typeof view?.setTimeout === "function") {
      view.setTimeout(run, 1400);
    }
  }
  return Object.freeze({
    prefetchRoute,
    prefetchUrl,
    scheduleIdleWarmup,
    count: () => prefetched.size,
  });
}
