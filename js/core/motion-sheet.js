/**
 * Platform-adaptive Modal (Desktop spring) & Gesture Drawer (Mobile bottom sheet) adapter.
 * Handles 1:1 touch tracking, rubber-band damping, velocity snap/close, background scaling,
 * ref-counted scroll locking, and safe cleanup on cancel/dispose.
 */
import { prefersReducedMotion } from "./motion-tokens.js?release=20261119-aeris-i07-preview";

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

function setBackgroundScale(doc, scaleTarget, ratio, reduced) {
  if (!scaleTarget?.style || !doc?.body) return;
  if (reduced || ratio <= 0) {
    scaleTarget.style.removeProperty("--ds-bg-scale");
    doc.body.classList?.remove("ds-sheet-scaling");
    return;
  }
  const scale = 1 - 0.018 * Math.max(0, Math.min(1, ratio));
  scaleTarget.style.setProperty("--ds-bg-scale", scale.toFixed(4));
  doc.body.classList?.add("ds-sheet-scaling");
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
      try { panelEl.setPointerCapture?.(event.pointerId); } catch (_) {}
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
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (rafId) {
      view?.cancelAnimationFrame?.(rafId);
      rafId = 0;
      applyDragFrame();
    }
    try { panelEl.releasePointerCapture?.(drag.pointerId); } catch (_) {}
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

  panelEl.addEventListener?.("pointerdown", onPointerDown);
  panelEl.addEventListener?.("pointermove", onPointerMove);
  panelEl.addEventListener?.("pointerup", onPointerEnd);
  panelEl.addEventListener?.("pointercancel", onPointerEnd);
  panelEl.addEventListener?.("lostpointercapture", onPointerEnd);
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
      panelEl.removeEventListener?.("pointermove", onPointerMove);
      panelEl.removeEventListener?.("pointerup", onPointerEnd);
      panelEl.removeEventListener?.("pointercancel", onPointerEnd);
      panelEl.removeEventListener?.("lostpointercapture", onPointerEnd);
      view?.removeEventListener?.("resize", onResize);
      if (createdHandle) handleEl?.remove?.();
      adapters.delete(modalLayer);
    },
  });
  adapters.set(modalLayer, controller);
  return controller;
}
