/** Presentation only. Business locks, routing and durable state remain in their owners. */
export const MOTION = Object.freeze({
  pressed: 80, fast: 140, expand: 200, page: 220, sheet: 280,
  pressedScale: 0.985, pressedOpacity: 0.92, distance: 8,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
});

export function pressedReleaseDelay(started, now, minimum = MOTION.pressed) {
  return Math.max(0, minimum - Math.max(0, now - started));
}

export function motionDuration(kind, view = globalThis.window) {
  return view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : (MOTION[kind] ?? MOTION.fast);
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
  const clock = () => view.performance.now();
  const target = node => node?.closest?.("button,a[href],summary,[role='button'],[role='tab'],input[type='checkbox'],input[type='radio']");
  const usable = node => node && !node.disabled && node.getAttribute("aria-disabled") !== "true" && !node.closest("[inert]");
  function clear(node) {
    const item = pressed.get(node);
    if (item?.timer) view.clearTimeout(item.timer);
    pressed.delete(node); node.removeAttribute("data-aeris-pressed");
  }
  function press(node) {
    if (!usable(node)) return;
    clear(node); pressed.set(node, { at: clock(), timer: null });
    node.setAttribute("data-aeris-pressed", "true");
  }
  function release(node, cancel = false) {
    const item = pressed.get(node); if (!item) return;
    const remaining = cancel ? 0 : pressedReleaseDelay(item.at, clock());
    if (!remaining) clear(node);
    else item.timer = view.setTimeout(() => clear(node), remaining);
  }
  function reset() { for (const node of [...pressed.keys()]) clear(node); pointerTargets.clear(); }
  function listen(type, handler, options = { capture: true }) {
    doc.addEventListener(type, handler, options);
    disposers.push(() => doc.removeEventListener(type, handler, options));
  }
  listen("pointerdown", event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const node = target(event.target); if (!usable(node)) return;
    pointerTargets.set(event.pointerId, node); press(node);
  }, { capture: true, passive: true });
  listen("pointerup", event => { const node = pointerTargets.get(event.pointerId); if (node) release(node); pointerTargets.delete(event.pointerId); }, { capture: true, passive: true });
  listen("pointercancel", event => { const node = pointerTargets.get(event.pointerId); if (node) release(node, true); pointerTargets.delete(event.pointerId); }, { capture: true, passive: true });
  listen("keydown", event => { if (!event.repeat && (event.key === "Enter" || event.key === " ")) press(target(event.target)); });
  listen("keyup", event => { if (event.key === "Enter" || event.key === " ") release(target(event.target)); });
  listen("visibilitychange", () => { if (doc.hidden) reset(); });
  view.addEventListener("blur", reset); disposers.push(() => view.removeEventListener("blur", reset));

  // Native details semantics remain the authority, including programmatic opens.
  // Only a small disclosure is allowed to animate layout; large ledgers keep a
  // single layout change plus a short compositor effect.
  function animateDisclosure(details, summary) {
    let state = disclosures.get(details);
    if (!state) { state = { targetOpen: details.open, generation: 0, animation: null, height: details.style.height, overflow: details.style.overflow }; disclosures.set(details, state); }
    const start = details.getBoundingClientRect().height;
    state.targetOpen = !state.targetOpen; const generation = ++state.generation;
    state.animation?.cancel(); details.style.height = state.height; details.style.overflow = state.overflow;
    if (state.targetOpen) details.open = true;
    summary.setAttribute("aria-expanded", String(state.targetOpen));
    const end = state.targetOpen ? details.getBoundingClientRect().height : summary.getBoundingClientRect().height;
    const finish = () => {
      if (generation !== state.generation) return;
      details.style.height = state.height; details.style.overflow = state.overflow;
      details.open = state.targetOpen; state.animation = null;
    };
    const duration = motionDuration("expand", view);
    if (!duration || typeof details.animate !== "function") { finish(); return; }
    if (Math.abs(start - end) <= 280) {
      details.style.overflow = "hidden";
      state.animation = details.animate([{ height: `${start}px` }, { height: `${end}px` }], { duration, easing: MOTION.easing });
    } else {
      details.open = state.targetOpen;
      state.animation = details.animate([{ opacity: 0.94 }, { opacity: 1 }], { duration: motionDuration("fast", view), easing: MOTION.easing });
    }
    state.animation.finished.then(finish, () => {});
  }
  listen("click", event => {
    const summary = event.target?.closest?.("summary");
    if (!summary || event.target?.closest?.("a,button,input") || event.defaultPrevented) return;
    const details = summary.parentElement; if (details?.tagName !== "DETAILS") return;
    event.preventDefault(); animateDisclosure(details, summary);
  }, { capture: false });
  const disclosureObserver = new view.MutationObserver(records => {
    for (const record of records) {
      const details = record.target; const state = disclosures.get(details);
      if (!state || !details.open || state.targetOpen) continue;
      // A data-owner reopening an in-flight close supersedes its old completion.
      state.targetOpen = true; state.generation++; state.animation?.cancel(); state.animation = null;
      details.style.height = state.height; details.style.overflow = state.overflow;
      details.querySelector("summary")?.setAttribute("aria-expanded", "true");
    }
  });
  disclosureObserver.observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });
  disposers.push(() => disclosureObserver.disconnect());

  function updateIndicator(group) {
    if (!group.isConnected) return;
    const selected = group.querySelector("[role='tab'][aria-selected='true']");
    if (!selected) return;
    let indicator = indicators.get(group);
    if (!indicator) { indicator = doc.createElement("span"); indicator.className = "ds-tab-indicator"; indicator.setAttribute("aria-hidden", "true"); group.append(indicator); group.classList.add("ds-motion-tabs"); indicators.set(group, indicator); }
    const outer = group.getBoundingClientRect(), inner = selected.getBoundingClientRect();
    indicator.style.width = `${inner.width}px`; indicator.style.transform = `translateX(${inner.left - outer.left}px)`;
  }
  const tabGroups = [...doc.querySelectorAll("[role='tablist']")];
  listen("click", () => view.queueMicrotask(() => {
    // Covers a tablist revealed by navigation; no observer on progress events.
    for (const group of tabGroups) if (group.getBoundingClientRect().width > 0) updateIndicator(group);
  }));
  const resize = () => { for (const group of indicators.keys()) updateIndicator(group); };
  view.addEventListener("resize", resize); disposers.push(() => view.removeEventListener("resize", resize));
  for (const group of tabGroups) if (group.getBoundingClientRect().width > 0) updateIndicator(group);

  const dispose = () => { reset(); for (const cleanup of disposers) cleanup(); for (const [group, indicator] of indicators) { indicator.remove(); group.classList.remove("ds-motion-tabs"); } installed.delete(doc); };
  installed.set(doc, dispose); return dispose;
}
