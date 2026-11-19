/**
 * Bidirectional FLIP layout transition & pointer/keyboard drag-sort engine.
 * Preserves DOM node identity, focus, and interruptibility.
 */
import { prefersReducedMotion } from "./motion-tokens.js?release=20261119-aeris-i07-preview";

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
  threshold = 6,
  view = null,
} = {}) {
  if (!container?.addEventListener) return { dispose() {}, cancel() {} };
  const hostView = resolveView(container, view);
  const doc = container.ownerDocument || globalThis.document;
  let drag = null;
  let rafId = 0;

  const getItems = () => [...container.querySelectorAll(itemSelector)];

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

  function onKeyDown(event) {
    if (event.key === "Escape" && drag) {
      event.preventDefault();
      cancelDrag(true);
    }
  }

  container.addEventListener("pointerdown", onPointerDown);
  doc?.addEventListener?.("pointermove", onPointerMove);
  doc?.addEventListener?.("pointerup", onPointerEnd);
  doc?.addEventListener?.("pointercancel", onPointerEnd);
  doc?.addEventListener?.("keydown", onKeyDown);

  return {
    cancel: () => cancelDrag(true),
    dispose() {
      cancelDrag(false);
      container.removeEventListener("pointerdown", onPointerDown);
      doc?.removeEventListener?.("pointermove", onPointerMove);
      doc?.removeEventListener?.("pointerup", onPointerEnd);
      doc?.removeEventListener?.("pointercancel", onPointerEnd);
      doc?.removeEventListener?.("keydown", onKeyDown);
    },
  };
}
