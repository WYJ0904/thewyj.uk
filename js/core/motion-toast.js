/**
 * Unified Toast Queue Manager (Task54 UI capsule style, presentation only).
 * Enforces max 2 visible toasts, bounded queue, deduplication, error protection,
 * pause-on-hover/focus, aria-live announcements, and full timer cleanup.
 */
import { prefersReducedMotion } from "./motion-tokens.js?release=20261119-aeris-i07-preview";

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
      clear: () => {},
      dispose: () => {},
      snapshot: () => ({ visible: [], queued: [] }),
    };
  }

  let seq = 0;
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
    politeLive.setAttribute("aria-live", "polite");
    politeLive.setAttribute("aria-atomic", "true");

    assertiveLive = doc.createElement("div");
    assertiveLive.className = "ds-sr-only";
    assertiveLive.setAttribute("aria-live", "assertive");
    assertiveLive.setAttribute("aria-atomic", "true");

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
    item.setAttribute("role", entry.tone === "error" ? "alert" : "status");

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
        try { entry.onAction(); } finally { dismiss(entry.id); }
      });
      body.append(actionBtn);
    }

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ds-toast-close";
    closeBtn.setAttribute("aria-label", "关闭通知");
    closeBtn.textContent = "关闭";
    closeBtn.addEventListener("click", () => dismiss(entry.id));

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
          { opacity: 0, transform: "translate3d(0, 14px, 0) scale(0.96)" },
          { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
        ],
        { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "none" },
      );
      entry.enterAnim?.finished?.catch?.(() => {});
    }
    startTimer(entry);
  }

  function flushQueue() {
    while (!disposed && visible.length < maxVisible && queue.length > 0) {
      const next = queue.shift();
      mountEntry(next);
    }
  }

  function enqueueItem(entry) {
    if (queue.length >= maxQueue) {
      // Never drop queued errors if low-priority info/success can be evicted.
      const dropIndex = queue.findIndex((item) => item.tone !== "error");
      if (dropIndex >= 0) queue.splice(dropIndex, 1);
      else if (entry.tone !== "error") return null;
      else queue.shift();
    }
    queue.push(entry);
    return entry.id;
  }

  function show(input, maybeOptions = {}) {
    if (disposed) return null;
    const opts = typeof input === "string" ? { message: input, ...maybeOptions } : { ...(input || {}) };
    const message = String(opts.message || "").trim();
    if (!message) return null;
    const tone = VALID_TONES.has(opts.tone) ? opts.tone : "info";
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
      remainingMs: duration,
      count: 1,
      actionLabel: opts.actionLabel ? String(opts.actionLabel) : "",
      onAction: typeof opts.onAction === "function" ? opts.onAction : null,
      leaving: false,
      node: null,
      countNode: null,
      enterAnim: null,
      exitAnim: null,
    };

    if (visible.length < maxVisible) {
      mountEntry(entry);
      return entry.id;
    }

    // Never allow a quick non-error toast to overwrite or evict an active error toast.
    enqueueItem(entry);
    return entry.id;
  }

  function finalizeRemoval(entry) {
    clearTimer(entry.id);
    const idx = visible.indexOf(entry);
    if (idx >= 0) visible.splice(idx, 1);
    try { entry.enterAnim?.cancel(); } catch (_) {}
    try { entry.exitAnim?.cancel(); } catch (_) {}
    entry.node?.remove?.();
    entry.node = null;
    flushQueue();
  }

  function dismiss(id) {
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
      finalizeRemoval(entry);
      return;
    }
    entry.exitAnim = entry.node.animate(
      [
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
        { opacity: 0, transform: "translate3d(0, 8px, 0) scale(0.97)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" },
    );
    entry.exitAnim.finished.then(() => finalizeRemoval(entry), () => finalizeRemoval(entry));
  }

  function clear({ includeErrors = true } = {}) {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (includeErrors || queue[i].tone !== "error") queue.splice(i, 1);
    }
    for (const entry of [...visible]) {
      if (includeErrors || entry.tone !== "error") finalizeRemoval(entry);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
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
  }

  function snapshot() {
    return {
      visible: visible.map((item) => ({ id: item.id, tone: item.tone, message: item.message, count: item.count })),
      queued: queue.map((item) => ({ id: item.id, tone: item.tone, message: item.message, count: item.count })),
      maxVisible,
    };
  }

  return Object.freeze({
    show,
    info: (message, opts) => show({ ...opts, message, tone: "info" }),
    success: (message, opts) => show({ ...opts, message, tone: "success" }),
    warning: (message, opts) => show({ ...opts, message, tone: "warning" }),
    error: (message, opts) => show({ ...opts, message, tone: "error" }),
    dismiss,
    clear,
    dispose,
    snapshot,
  });
}

export function getSharedToastManager(doc = globalThis.document) {
  if (!doc) return createToastManager({ doc: null });
  let manager = sharedManagers.get(doc);
  if (!manager) {
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
