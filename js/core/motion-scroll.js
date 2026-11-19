/**
 * Scroll-progress interpolation, 3D perspective flattening, and Bento internal parallax.
 * Uses IntersectionObserver + rAF batch read/write, zero layout thrashing, reversible,
 * and automatic static fallback in Reduced Motion.
 */
import { prefersReducedMotion } from "./motion-tokens.js?release=20261119-aeris-i07-preview";

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
    el.style.setProperty("--ds-scroll-scale", "1");
    el.style.setProperty("--ds-scroll-ty", "0px");
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
      if (!el?.style?.setProperty) continue;
      const startEdge = Number(el.dataset?.scrollStart ?? 0.96);
      const endEdge = Number(el.dataset?.scrollEnd ?? 0.30);
      const maxRx = Number(el.dataset?.scrollMaxRx ?? 12);
      const minScale = Number(el.dataset?.scrollMinScale ?? 0.94);
      const maxTy = Number(el.dataset?.scrollMaxTy ?? 24);
      const progress = computeScrollProgress(rect, vh, { startEdge, endEdge });
      const rx = lerp(maxRx, 0, progress);
      const scale = lerp(minScale, 1, progress);
      const ty = lerp(maxTy, 0, progress);

      el.style.setProperty("--ds-scroll-progress", progress.toFixed(4));
      el.style.setProperty("--ds-scroll-rx", `${rx.toFixed(2)}deg`);
      el.style.setProperty("--ds-scroll-scale", scale.toFixed(4));
      el.style.setProperty("--ds-scroll-ty", `${ty.toFixed(2)}px`);
      sampled3d.push({ el, progress, rx, scale, ty });
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
      for (const entry of entries) {
        if (entry.isIntersecting) visibleElements.add(entry.target);
        else visibleElements.delete(entry.target);
      }
      schedule();
    }, { rootMargin: "140px 0px" })
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
