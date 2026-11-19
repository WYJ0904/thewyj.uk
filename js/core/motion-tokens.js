/**
 * Shared Aeris V6.3 I07 Motion Tokens, Reduced-Motion Guard & Lifecycle Scope.
 * Leaf module (zero imports) to keep the core ES module graph acyclic.
 */
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
