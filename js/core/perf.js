/**
 * Task 24 reopen #7 - interaction feedback and the click-to-render timeline.
 *
 * Real-device report: "点击后几秒无反馈". A button whose handler only paints
 * *after* the network answers looks dead even when the request is healthy, and
 * the WebView bridge on Android makes that gap much more visible. Three small
 * primitives fix the class of bug instead of one page at a time:
 *
 *  1. [attachInteractionFeedback] puts the pressed/loading/disabled state on the
 *     control synchronously - in the same task as the click - so the next frame
 *     (well inside the 100-150ms budget) already shows that the tap was seen.
 *  2. [beginInteraction] records the documented chain
 *     click -> handler start -> request start -> response -> state apply ->
 *     render end, so a slow interaction can be attributed to a stage instead of
 *     being described as "卡".
 *  3. [singleFlight] and [createLatestOnly] collapse duplicate refreshes and
 *     make sure a slow answer can never overwrite newer state.
 */

export const INTERACTION_STAGES = Object.freeze({
  CLICK: "click",
  HANDLER_START: "handler-start",
  REQUEST_START: "request-start",
  RESPONSE: "response",
  STATE_APPLY: "state-apply",
  RENDER_END: "render-end",
});

/** Interaction budget from the acceptance criteria: feedback within this window. */
export const FEEDBACK_BUDGET_MS = 150;

const TRACE_LIMIT = 60;
const traces = [];

let clock = () => (typeof performance !== "undefined" && typeof performance.now === "function"
  ? performance.now()
  : Date.now());

/** Test seam: replace the monotonic clock. */
export function setInteractionClock(next) {
  clock = typeof next === "function" ? next : clock;
}

/**
 * Starts one interaction trace. The returned object is cheap (array push per
 * stage) and safe to keep on the hot path.
 */
export function beginInteraction(name, meta = {}) {
  const startedAt = clock();
  const stages = [];
  let finishedAt = startedAt;
  const trace = {
    name: String(name || "interaction"),
    meta: { ...meta },
    startedAt,
    finished: false,
    mark(stage, detail = "") {
      const at = clock();
      finishedAt = at;
      stages.push({
        stage: String(stage || ""),
        at,
        ms: Math.max(0, at - startedAt),
        detail: detail === undefined || detail === null ? "" : String(detail),
      });
      return trace;
    },
    snapshot() {
      return {
        name: trace.name,
        meta: { ...meta },
        startedAt,
        totalMs: Math.max(0, finishedAt - startedAt),
        stages: stages.map((entry) => ({ ...entry })),
        /** Time until the first visible feedback stage, when one was recorded. */
        feedbackMs: stages.length ? stages[0].ms : 0,
      };
    },
    finish(detail = "") {
      if (trace.finished) return trace.snapshot();
      trace.finished = true;
      trace.mark(INTERACTION_STAGES.RENDER_END, detail);
      const snapshot = trace.snapshot();
      traces.push(snapshot);
      while (traces.length > TRACE_LIMIT) traces.shift();
      return snapshot;
    },
  };
  return trace;
}

/** Most recent interaction timelines, newest last. */
export function recentInteractions(limit = 10) {
  const count = Math.max(0, Number(limit) || 0);
  return traces.slice(count > 0 ? Math.max(0, traces.length - count) : 0).map((entry) => ({
    ...entry,
    meta: { ...entry.meta },
    stages: entry.stages.map((stage) => ({ ...stage })),
  }));
}

export function clearInteractions() {
  traces.length = 0;
}

/**
 * The browser/WebView hook the device audit reads: `window.__wyjInteractionTrace()`.
 * Only timings and identifiers are recorded - never notification or finance
 * content.
 */
export function interactionTraceApi() {
  return {
    stages: { ...INTERACTION_STAGES },
    budgetMs: FEEDBACK_BUDGET_MS,
    recent: (limit = 10) => recentInteractions(limit),
    clear: clearInteractions,
  };
}

/**
 * Puts a control into its pending state *synchronously* and returns the release
 * function. No layout reads, no timers before the state change, so the feedback
 * is painted with the next frame.
 */
export function attachInteractionFeedback(element) {
  if (!element || typeof element !== "object") return () => {};
  const dataset = element.dataset;
  const hadPending = Boolean(dataset) && Object.prototype.hasOwnProperty.call(dataset, "pending");
  const previousPending = hadPending ? dataset.pending : undefined;
  const hadBusy = typeof element.getAttribute === "function" ? element.getAttribute("aria-busy") : null;
  const hadDisabled = "disabled" in element ? element.disabled : undefined;

  if (dataset) dataset.pending = "true";
  if (typeof element.setAttribute === "function") element.setAttribute("aria-busy", "true");
  if ("disabled" in element) element.disabled = true;
  // Optional textual feedback: keep the user's original label to restore later.
  const label = element.querySelector?.("[data-pending-label]");
  if (label && !label.dataset.originalLabel) {
    label.dataset.originalLabel = label.textContent || "";
    label.textContent = label.dataset.pendingLabel || "处理中…";
  }

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    if (dataset) {
      if (hadPending) dataset.pending = previousPending;
      else delete dataset.pending;
    }
    if (typeof element.setAttribute === "function" && typeof element.removeAttribute === "function") {
      if (hadBusy === null) element.removeAttribute("aria-busy");
      else element.setAttribute("aria-busy", hadBusy);
    }
    if ("disabled" in element && hadDisabled !== undefined) element.disabled = hadDisabled;
    if (label && label.dataset.originalLabel !== undefined) {
      label.textContent = label.dataset.originalLabel;
      delete label.dataset.originalLabel;
    }
  };
}

/**
 * Collapses concurrent identical work (session, config, finance refresh) into one
 * request. The entry is dropped as soon as it settles, so a later call really
 * re-fetches.
 */
export function createSingleFlight() {
  const inFlight = new Map();
  return function run(key, factory) {
    const normalized = String(key || "");
    const existing = inFlight.get(normalized);
    if (existing) return existing;
    const started = Promise.resolve()
      .then(() => factory())
      .finally(() => {
        if (inFlight.get(normalized) === started) inFlight.delete(normalized);
      });
    inFlight.set(normalized, started);
    return started;
  };
}

/**
 * Guards state that arrives out of order: only the newest request may apply.
 * A late answer from a previous render is dropped instead of repainting stale
 * data over the user's action.
 */
export function createLatestOnly() {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isCurrent(token) {
      return token === current;
    },
    get value() {
      return current;
    },
  };
}

/**
 * Leaves the loading overlay transparent to taps for the duration of a pending
 * interaction, so a slow network can never eat the user's next click.
 */
export function patchOverlayClickThrough(overlay) {
  if (!overlay?.style) return () => {};
  const previous = overlay.style.pointerEvents;
  overlay.style.pointerEvents = "none";
  return function restore() {
    overlay.style.pointerEvents = previous || "";
  };
}
