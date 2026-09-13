import assert from "node:assert/strict";

import {
  FEEDBACK_BUDGET_MS,
  INTERACTION_STAGES,
  attachInteractionFeedback,
  beginInteraction,
  clearInteractions,
  createLatestOnly,
  createSingleFlight,
  interactionTraceApi,
  patchOverlayClickThrough,
  recentInteractions,
  setInteractionClock,
} from "../js/core/perf.js";

/**
 * Task 24 reopen #7 regression: "点击后几秒无反馈" is a UI-contract bug, not a
 * performance guess. The interaction primitives must
 *
 *  - put the pressed/loading/disabled state on the control synchronously (the
 *    same task as the click), so the next frame is inside the 100-150ms budget;
 *  - record click → handler → request → response → state → render with
 *    monotonic timings, readable through the device API;
 *  - collapse duplicate refreshes and drop stale answers;
 *  - never leave a control stuck in its pending state.
 */

let now = 0;
setInteractionClock(() => now);
const advance = (ms) => {
  now += ms;
  return now;
};

function fakeButton({ pendingLabel = "" } = {}) {
  const attributes = new Map();
  const labelNode = pendingLabel
    ? {
      dataset: { pendingLabel },
      _text: pendingLabel,
      get textContent() {
        return this._text;
      },
      set textContent(value) {
        this._text = String(value);
      },
    }
    : null;
  return {
    tagName: "BUTTON",
    id: "confirmBtn",
    dataset: {},
    disabled: false,
    attributes,
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    querySelector(selector) {
      return selector === "[data-pending-label]" ? labelNode : null;
    },
    labelNode,
  };
}

// 1. Feedback is synchronous - before any await, i.e. inside the click task.
clearInteractions();
now = 0;
const button = fakeButton({ pendingLabel: "处理中…" });
const trace = beginInteraction("finance-candidate-confirm", { id: "cand-1" });
trace.mark(INTERACTION_STAGES.CLICK, "button#confirmBtn");
const release = attachInteractionFeedback(button);
assert.equal(button.dataset.pending, "true", "the pending flag must be set before any await");
assert.equal(button.getAttribute("aria-busy"), "true", "assistive tech must see the busy state");
assert.equal(button.disabled, true, "the control must be disabled immediately");
assert.equal(button.labelNode.textContent, "处理中…", "the label must show the pending text");
assert.ok(advance(16) <= FEEDBACK_BUDGET_MS, "feedback happens on the next frame");
trace.mark("first-frame", "painted");

// 2. The release restores the exact previous state and is idempotent.
release();
release();
assert.equal("pending" in button.dataset, false, "the pending flag is removed");
assert.equal(button.getAttribute("aria-busy"), null, "aria-busy is removed");
assert.equal(button.disabled, false, "the control is usable again");
assert.equal(button.labelNode.textContent, "处理中…", "the label node keeps its own text");

const preexisting = fakeButton();
preexisting.dataset.pending = "other";
preexisting.disabled = true;
preexisting.setAttribute("aria-busy", "false");
const releaseExisting = attachInteractionFeedback(preexisting);
releaseExisting();
assert.equal(preexisting.dataset.pending, "other", "an existing pending value is preserved");
assert.equal(preexisting.getAttribute("aria-busy"), "false", "an existing aria-busy value is preserved");
assert.equal(preexisting.disabled, true, "a control that was already disabled stays disabled");

// 3. The timeline records every documented stage with monotonic timings.
now = 0;
clearInteractions();
const timeline = beginInteraction("finance-candidate-confirm", { id: "cand-2" });
timeline.mark(INTERACTION_STAGES.CLICK, "button#confirmBtn");
advance(4);
timeline.mark(INTERACTION_STAGES.HANDLER_START, "confirm");
advance(6);
timeline.mark(INTERACTION_STAGES.REQUEST_START, "/api/notification/hints/confirm");
advance(180);
timeline.mark(INTERACTION_STAGES.RESPONSE, "txn-1");
advance(2);
timeline.mark(INTERACTION_STAGES.STATE_APPLY, "booked");
advance(1);
const snapshot = timeline.finish("booked");
assert.deepEqual(
  snapshot.stages.map((stage) => stage.stage),
  [
    INTERACTION_STAGES.CLICK,
    INTERACTION_STAGES.HANDLER_START,
    INTERACTION_STAGES.REQUEST_START,
    INTERACTION_STAGES.RESPONSE,
    INTERACTION_STAGES.STATE_APPLY,
    INTERACTION_STAGES.RENDER_END,
  ],
);
const offsets = snapshot.stages.map((stage) => stage.ms);
assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right), "stage timings must be monotonic");
assert.equal(snapshot.totalMs, 193);
assert.equal(snapshot.feedbackMs, 0, "the click itself is the feedback reference");
assert.deepEqual(recentInteractions(1).at(-1).stages.length, 6);

// 4. The device API exposes the budget and the newest traces only.
const api = interactionTraceApi();
assert.equal(api.budgetMs, FEEDBACK_BUDGET_MS);
assert.equal(api.stages.RENDER_END, INTERACTION_STAGES.RENDER_END);
assert.equal(api.recent(5).length, 1);
api.clear();
assert.equal(api.recent(5).length, 0);

// 5. Duplicate refreshes collapse into one request; a later call re-fetches.
const singleFlight = createSingleFlight();
let fetches = 0;
const fetchOnce = () => singleFlight("finance-candidates", async () => {
  fetches += 1;
  return fetches;
});
const [first, second, third] = await Promise.all([fetchOnce(), fetchOnce(), fetchOnce()]);
assert.equal(fetches, 1, "three concurrent refreshes must share one request");
assert.deepEqual([first, second, third], [1, 1, 1]);
assert.equal(await fetchOnce(), 2, "a refresh after the first settles really re-fetches");
assert.equal(fetches, 2);

// 6. A stale answer never overwrites newer state.
const latest = createLatestOnly();
const slowVersion = latest.begin();
const fastVersion = latest.begin();
assert.equal(latest.isCurrent(slowVersion), false, "the older refresh is stale");
assert.equal(latest.isCurrent(fastVersion), true, "the newest refresh may apply");
let painted = "";
if (latest.isCurrent(slowVersion)) painted = "stale";
if (latest.isCurrent(fastVersion)) painted = "fresh";
assert.equal(painted, "fresh");

// 7. The trace ring stays bounded and the overlay never eats taps.
clearInteractions();
for (let index = 0; index < 80; index += 1) {
  const entry = beginInteraction(`interaction-${index}`);
  entry.mark(INTERACTION_STAGES.CLICK, "button");
  entry.finish("done");
}
assert.equal(recentInteractions(1000).length, 60, "the trace ring is bounded");
assert.equal(recentInteractions(1).at(-1).name, "interaction-79", "the newest trace is kept");

const overlay = { style: { pointerEvents: "auto" } };
const restoreOverlay = patchOverlayClickThrough(overlay);
assert.equal(overlay.style.pointerEvents, "none", "a pending overlay must not swallow the next tap");
restoreOverlay();
assert.equal(overlay.style.pointerEvents, "auto");

console.log(
  "Task 24 interaction feedback checks passed (synchronous pending state, full click-to-render timeline with monotonic timings and a bounded ring, single-flight refreshes, stale-answer guard and click-through overlays).",
);
