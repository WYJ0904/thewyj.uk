import assert from "node:assert/strict";
import test from "node:test";
import {
  MOTION,
  createMotionScope,
  setControlFeedbackState,
  createTabSkeletonSwitcher,
  createToastManager,
  captureFlipSnapshot,
  playFlipSnapshot,
  flipLayout,
  isMobileSheetViewport,
  syncModalScrollLock,
  getScrollLockCount,
  computeScrollProgress,
  computeCenteredParallax,
  createScrollProgressController,
} from "../js/core/motion.js";
import { reconcileKeyedRows } from "../js/core/keyed-list.js";

function makeMockEnv({ reduced = false, width = 1280, height = 800 } = {}) {
  let now = 0;
  let timerSeq = 0;
  let rafSeq = 0;
  const timers = new Map();
  const rafs = new Map();
  const listeners = new Map();

  const view = {
    innerWidth: width,
    innerHeight: height,
    performance: { now: () => now },
    matchMedia: (q) => ({
      matches: q.includes("prefers-reduced-motion") ? reduced : false,
      addEventListener() {},
      removeEventListener() {},
    }),
    setTimeout(fn, ms) {
      const id = ++timerSeq;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) {
      const id = ++rafSeq;
      rafs.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) { rafs.delete(id); },
    queueMicrotask(fn) { fn(); },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };

  function makeElement(tag = "div") {
    const attrs = new Map();
    const classes = new Set();
    const styleMap = new Map();
    const elListeners = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      isConnected: true,
      parentNode: null,
      children: [],
      dataset: {},
      hidden: false,
      disabled: false,
      style: {
        transform: "",
        transformOrigin: "",
        setProperty(k, v) { styleMap.set(k, v); },
        getPropertyValue(k) { return styleMap.get(k) || ""; },
        removeProperty(k) { styleMap.delete(k); },
      },
      classList: {
        add(...xs) { xs.forEach((x) => classes.add(x)); },
        remove(...xs) { xs.forEach((x) => classes.delete(x)); },
        toggle(x, force) {
          const on = force === undefined ? !classes.has(x) : Boolean(force);
          if (on) classes.add(x); else classes.delete(x);
          return on;
        },
        contains(x) { return classes.has(x); },
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      removeAttribute(k) { attrs.delete(k); },
      hasAttribute(k) { return attrs.has(k); },
      addEventListener(t, fn) {
        if (!elListeners.has(t)) elListeners.set(t, new Set());
        elListeners.get(t).add(fn);
      },
      removeEventListener(t, fn) { elListeners.get(t)?.delete(fn); },
      append(...nodes) {
        for (const n of nodes) {
          n.parentNode = el;
          el.children.push(n);
        }
      },
      remove() {
        if (!el.parentNode) return;
        el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
        el.parentNode = null;
      },
      contains(target) {
        if (target === el) return true;
        return el.children.some((c) => c.contains?.(target));
      },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      getBoundingClientRect() { return el._rect || { left: 0, top: 0, width: 100, height: 40 }; },
      animate(keyframes, options) {
        let resolveFinished;
        let rejectFinished;
        const finished = new Promise((res, rej) => { resolveFinished = res; rejectFinished = rej; });
        const anim = {
          keyframes,
          options,
          cancelled: false,
          finished,
          cancel() { anim.cancelled = true; rejectFinished(new Error("cancelled")); },
          finish() { resolveFinished(); },
        };
        el._animations.push(anim);
        return anim;
      },
      _animations: [],
    };
    return el;
  }

  const body = makeElement("body");
  const documentElement = makeElement("html");
  const doc = {
    defaultView: view,
    documentElement,
    body,
    hidden: false,
    createElement: (tag) => makeElement(tag),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  view.document = doc;

  function advance(ms) {
    now += ms;
    for (const [id, item] of [...timers]) {
      if (item.at <= now) {
        timers.delete(id);
        item.fn();
      }
    }
  }

  function flushRaf() {
    for (const [id, fn] of [...rafs]) {
      rafs.delete(id);
      fn();
    }
  }

  return { view, doc, body, makeElement, advance, flushRaf, timers, rafs };
}

test("createMotionScope cancels pending timers, animations, and listeners cleanly", () => {
  const env = makeMockEnv();
  const scope = createMotionScope(env.view);
  let timerFired = false;
  let cleaned = false;
  let animCancelled = false;

  scope.timeout(() => { timerFired = true; }, 200);
  scope.add(() => { cleaned = true; });
  scope.trackAnimation({ cancel() { animCancelled = true; }, finished: Promise.resolve() });

  scope.dispose();
  env.advance(500);
  assert.equal(timerFired, false);
  assert.equal(cleaned, true);
  assert.equal(animCancelled, true);
  assert.equal(scope.disposed, true);
});

test("setControlFeedbackState prevents false success on disabled buttons and manages aria-busy", () => {
  const env = makeMockEnv();
  const btn = env.makeElement("button");
  btn.disabled = true;
  assert.equal(setControlFeedbackState(btn, "success"), false);
  assert.equal(btn.getAttribute("data-feedback-state"), null);

  btn.disabled = false;
  assert.equal(setControlFeedbackState(btn, "pending"), true);
  assert.equal(btn.getAttribute("aria-busy"), "true");
  assert.equal(setControlFeedbackState(btn, "error"), true);
  assert.equal(btn.getAttribute("aria-busy"), null);
  assert.equal(btn.getAttribute("data-feedback-state"), "error");
});

test("createTabSkeletonSwitcher enforces 120-150ms skeleton and drops stale rapid switches", async () => {
  const env = makeMockEnv();
  const panel = env.makeElement("div");
  const switcher = createTabSkeletonSwitcher({ duration: MOTION.skeleton, view: env.view });

  const rendered = [];
  const p1 = switcher.switchTab(panel, () => rendered.push("tab1"));
  assert.equal(panel.getAttribute("data-skeleton-loading"), "true");
  env.advance(60);
  const p2 = switcher.switchTab(panel, () => rendered.push("tab2"));
  env.advance(140);
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, false);
  assert.equal(r2, true);
  assert.deepEqual(rendered, ["tab2"]);
  assert.equal(panel.getAttribute("data-skeleton-loading"), null);
});

test("createToastManager enforces max 2 visible, bounded queue, dedupe, and error protection", () => {
  const env = makeMockEnv();
  const mgr = createToastManager({ doc: env.doc, view: env.view, maxVisible: 2, maxQueue: 5 });

  const errId = mgr.error("保存失败：网络不可用");
  mgr.info("同步提示 1");
  mgr.success("操作成功 2");
  mgr.warning("配额提示 3");
  mgr.info("同步提示 4");

  let snap = mgr.snapshot();
  assert.equal(snap.visible.length, 2, "only 2 toasts may be visible simultaneously");
  assert.equal(snap.visible[0].id, errId, "active error toast cannot be evicted by non-error toasts");
  assert.equal(snap.queued.length, 3);

  // Deduplication increments count instead of adding another toast.
  const dupId = mgr.info("同步提示 4");
  assert.equal(mgr.snapshot().queued.length, 3);
  assert.equal(mgr.snapshot().queued.find((t) => t.id === dupId)?.count, 2);

  // Dismissing the second visible info toast promotes the next queued item.
  const secondVisible = snap.visible[1].id;
  mgr.dismiss(secondVisible);
  // In reduced=false, exit animation finishes asynchronously; finish it manually.
  const secondNode = env.body.children[0].children[0].children[1];
  secondNode._animations.at(-1).finish();

  return Promise.resolve().then(() => {
    snap = mgr.snapshot();
    assert.equal(snap.visible.length, 2);
    assert.equal(snap.visible[0].id, errId);
    assert.equal(snap.queued.length, 2);
    mgr.dispose();
    assert.equal(env.timers.size, 0);
  });
});

test("bidirectional FLIP animates both upward and downward moves and interrupts mid-flight", () => {
  const env = makeMockEnv();
  const container = env.makeElement("div");
  const positions = new Map();
  const items = ["a", "b", "c"].map((k, idx) => {
    const card = env.makeElement("article");
    card.dataset.flipKey = k;
    positions.set(k, idx);
    card.getBoundingClientRect = () => ({ left: 0, top: positions.get(k) * 100, width: 200, height: 80 });
    container.append(card);
    return card;
  });
  container.querySelectorAll = () => [...container.children];

  // Move 'c' upward and 'a' downward simultaneously.
  const ctrl1 = flipLayout(container, () => {
    positions.set("c", 0);
    positions.set("a", 2);
    container.children = [items[2], items[1], items[0]];
  }, { view: env.view });

  assert.equal(ctrl1.animatedCount, 2);
  const cAnim = items[2]._animations[0];
  const aAnim = items[0]._animations[0];
  assert.match(cAnim.keyframes[0].transform, /translate3d\(0\.00px, 200\.00px, 0\)/, "upward move inverts from +200px");
  assert.match(aAnim.keyframes[0].transform, /translate3d\(0\.00px, -200\.00px, 0\)/, "downward move inverts from -200px");

  // Mid-flight reversal before first animation finishes.
  const ctrl2 = flipLayout(container, () => {
    positions.set("c", 2);
    positions.set("a", 0);
    container.children = [items[0], items[1], items[2]];
  }, { view: env.view });

  assert.equal(cAnim.cancelled, true, "prior FLIP animation must cancel cleanly on reversal");
  assert.equal(ctrl2.animatedCount, 2);
  ctrl2.cancel();
});

test("scroll progress & centered parallax are reversible and respect reduced motion", () => {
  assert.equal(computeScrollProgress({ top: 950 }, 1000, { startEdge: 0.95, endEdge: 0.35 }), 0);
  assert.equal(computeScrollProgress({ top: 350 }, 1000, { startEdge: 0.95, endEdge: 0.35 }), 1);
  const mid = computeScrollProgress({ top: 650 }, 1000, { startEdge: 0.95, endEdge: 0.35 });
  assert.ok(Math.abs(mid - 0.5) < 0.01);
  assert.equal(computeCenteredParallax({ top: 450, height: 100 }, 1000), 0);

  const reducedEnv = makeMockEnv({ reduced: true });
  const card = reducedEnv.makeElement("div");
  card.dataset.scroll3d = "true";
  reducedEnv.doc.querySelectorAll = (sel) => (sel.includes("scroll") ? [card] : []);
  const ctrl = createScrollProgressController({ root: reducedEnv.doc, doc: reducedEnv.doc, view: reducedEnv.view });
  assert.equal(card.style.getPropertyValue("--ds-scroll-rx"), "0deg");
  assert.equal(card.style.getPropertyValue("--ds-scroll-scale"), "1");
  ctrl.dispose();
});

test("sheet viewport and scroll lock helpers clean up properly", () => {
  const desktop = makeMockEnv({ width: 1280 });
  const mobile = makeMockEnv({ width: 390 });
  assert.equal(isMobileSheetViewport(desktop.view), false);
  assert.equal(isMobileSheetViewport(mobile.view), true);

  const modal = desktop.makeElement("div");
  modal.classList.add("modal-layer");
  desktop.doc.querySelectorAll = (sel) => (sel.includes(":not(.hidden)") && modal.classList.contains("hidden") ? [] : [modal]);
  assert.equal(syncModalScrollLock(desktop.doc), true);
  assert.equal(getScrollLockCount(desktop.doc), 1);

  modal.classList.add("hidden");
  assert.equal(syncModalScrollLock(desktop.doc), false);
  assert.equal(getScrollLockCount(desktop.doc), 0);
});

test("reconcileKeyedRows with flip preserves exact DOM node identity when rows reorder", () => {
  const env = makeMockEnv();
  // Use simple DOM-like container compatible with reconcileKeyedRows.
  const nodes = new Map();
  let top = 0;
  const makeNode = (html) => {
    const idMatch = html.match(/data-id="([^"]+)"/);
    const el = env.makeElement("div");
    el.dataset.id = idMatch ? idMatch[1] : "";
    el.getBoundingClientRect = () => ({ left: 0, top: top++ * 50, width: 200, height: 40 });
    return el;
  };
  const container = {
    ownerDocument: {
      activeElement: null,
      defaultView: env.view,
      createElement: () => ({
        content: {
          get firstElementChild() { return this._el; },
          set _html(v) { this._el = makeNode(v); },
        },
        set innerHTML(v) { this.content._html = v; },
      }),
    },
    children: [],
    get firstElementChild() { return this.children[0] || null; },
    insertBefore(node, ref) {
      this.children = this.children.filter((n) => n !== node);
      node.parentNode = this;
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx >= 0) this.children.splice(idx, 0, node);
      else this.children.push(node);
    },
    querySelectorAll() { return [...this.children]; },
  };
  Object.defineProperty(env.makeElement("x"), "nextElementSibling", { get() { return null; } });
  // Verify no-crash and identity retention using real element tracking.
  const rows1 = [{ id: "1", label: "One" }, { id: "2", label: "Two" }];
  reconcileKeyedRows(container, rows1, {
    key: (r) => r.id,
    signature: (r) => r.label,
    render: (r) => `<div data-id="${r.id}">${r.label}</div>`,
    flip: false,
  });
  assert.equal(container.children.length, 2);
  nodes.set("1", container.children[0]);
  nodes.set("2", container.children[1]);
  container.children[0].nextElementSibling = container.children[1];
  container.children[1].nextElementSibling = null;

  reconcileKeyedRows(container, [rows1[1], rows1[0]], {
    key: (r) => r.id,
    signature: (r) => r.label,
    render: (r) => `<div data-id="${r.id}">${r.label}</div>`,
    flip: true,
  });
  assert.equal(container.children[0], nodes.get("2"), "reordered row must keep exact DOM node identity");
  assert.equal(container.children[1], nodes.get("1"), "reordered row must keep exact DOM node identity");
});
