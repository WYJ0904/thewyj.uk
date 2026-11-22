import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createToastManager } from "../js/core/motion.js";
import { createFeatureConsole } from "../js/core/feature-console.js";
import { createFeatureController } from "../js/core/feature-flags.js";

const ROOT = path.resolve(import.meta.dirname, "..");

function makeToastDom({ reduced = true } = {}) {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const view = {
    innerWidth: 1440,
    innerHeight: 900,
    performance: { now: () => now },
    matchMedia: (q) => ({
      matches: q.includes("prefers-reduced-motion") ? reduced : false,
      addEventListener() {},
      removeEventListener() {},
    }),
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    queueMicrotask(fn) { fn(); },
    addEventListener() {},
    removeEventListener() {},
  };

  function el(tag) {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      isConnected: true,
      parentNode: null,
      children: [],
      dataset: {},
      hidden: false,
      disabled: false,
      textContent: "",
      style: { setProperty() {}, removeProperty() {} },
      get className() { return [...classes].join(" "); },
      set className(v) {
        classes.clear();
        String(v || "").split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
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
      addEventListener(t, fn) {
        if (!listeners.has(t)) listeners.set(t, new Set());
        listeners.get(t).add(fn);
      },
      removeEventListener(t, fn) { listeners.get(t)?.delete(fn); },
      dispatchEvent(t, ev = {}) {
        for (const fn of [...(listeners.get(t) || [])]) fn(ev);
      },
      append(...nodes) {
        for (const child of nodes) {
          child.parentNode = node;
          node.children.push(child);
        }
      },
      remove() {
        if (!node.parentNode) return;
        node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
        node.parentNode = null;
      },
      contains(target) {
        if (target === node) return true;
        return node.children.some((c) => c.contains?.(target));
      },
      closest(sel) {
        let cur = node;
        while (cur) {
          if (sel === "[data-toast-id]" && cur.dataset?.toastId) return cur;
          cur = cur.parentNode;
        }
        return null;
      },
      querySelector(sel) {
        for (const c of node.children) {
          if (sel.includes(".ds-toast-action") && (c.classList.contains("ds-toast-action") || c.classList.contains("ds-toast-close"))) return c;
          const nested = c.querySelector?.(sel);
          if (nested) return nested;
        }
        return null;
      },
      focus() { doc.activeElement = node; },
    };
    return node;
  }

  const body = el("body");
  const documentElement = el("html");
  const doc = {
    defaultView: view,
    documentElement,
    body,
    activeElement: null,
    createElement: (tag) => el(tag),
  };
  view.document = doc;
  return { doc, view, body, timers };
}

test("I09 HUD DOM placement, CSS layer zero !important, and SW invariants", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const frameStart = html.indexOf('id="v3AppFrame"');
  const frameEnd = html.indexOf("</main>", frameStart);
  const versionIdx = html.indexOf('id="versionNotice"');
  const saveIdx = html.indexOf('id="siteMessageSaveStatus"');
  assert.ok(frameStart > 0 && frameEnd > frameStart && versionIdx > frameStart);
  // #versionNotice sits inside #appShell, AFTER #v3AppFrame closes, avoiding transform stacking trap.
  const mainSlice = html.slice(frameStart, frameEnd);
  assert.ok(mainSlice.includes('id="versionNotice"'), "#versionNotice must live inside #appShell");
  const v3CanvasEnd = html.indexOf("</div>\n      </div>", html.indexOf('id="v3MainCanvas"'));
  assert.ok(versionIdx > html.indexOf('id="v3MainCanvas"'));
  assert.ok(saveIdx > frameEnd, "#siteMessageSaveStatus sits outside #v3AppFrame");
  const beforeVersion = html.slice(frameStart, versionIdx);
  const lastMainCanvasIdx = html.lastIndexOf('id="v3MainCanvas"');
  assert.ok(versionIdx > lastMainCanvasIdx && !html.slice(lastMainCanvasIdx, versionIdx).includes('id="versionNotice"'));
  // Specifically ensure #versionNotice is immediately before </main> outside #v3AppFrame
  assert.match(html.slice(versionIdx - 120, versionIdx + 220), /<\/div>\s*<\/div>\s*<div class="version-notice hidden" id="versionNotice"/);

  const designCss = fs.readFileSync(path.join(ROOT, "design-system.css"), "utf8");
  for (const token of ["--ds-hud-keyboard-inset:", "--ds-hud-save-offset:", "--ds-hud-version-offset:"]) {
    assert.ok(designCss.includes(token), `Missing I09 HUD CSS token ${token}`);
  }
  assert.ok(!designCss.includes("z-index: 8999"), ".site-message-save-status must use semantic --ds-z-toast scale");

  const spatial = fs.readFileSync(path.join(ROOT, "spatial-experience.css"), "utf8");
  const i09Idx = spatial.indexOf("I09 System Notifications, Layering & Interaction Feedback Layer");
  assert.ok(i09Idx >= 0, "Missing I09 CSS layer in spatial-experience.css");
  const i09End = spatial.indexOf("*/", i09Idx);
  const i09Body = spatial.slice(i09End >= 0 ? i09End + 2 : i09Idx).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(i09Body.includes("!important"), false, "I09 CSS layer must contain 0 !important declarations");

  const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const context = {
    URL,
    Response,
    AbortController,
    crypto,
    TextEncoder,
    setTimeout,
    clearTimeout,
    caches: {},
    fetch: async () => new Response(""),
    self: { location: { origin: "https://isolated.example" }, addEventListener() {} },
  };
  vm.runInNewContext(`${swSource}\n;globalThis.__I09_SHELL={core:CORE_SHELL.length,required:REQUIRED_SHELL.length,install:INSTALL_SHELL.length};`, context);
  assert.equal(context.__I09_SHELL.core, 81);
  assert.equal(context.__I09_SHELL.required, 89);
  assert.equal(context.__I09_SHELL.install, 89);
});

test("I09-02 createToastManager single live-region announcement, stale route token drop, focus protection & Escape", () => {
  const { doc, view, body, timers } = makeToastDom({ reduced: true });
  const mgr = createToastManager({ doc, view, maxVisible: 2, maxQueue: 6 });

  const oldRouteToken = mgr.getContextToken();
  const idFocused = mgr.info("正在同步草稿", { actionLabel: "查看", onAction: () => {} });
  const idOther = mgr.success("空闲提示");

  const region = body.children[0];
  const stack = region.children[0];
  const polite = region.children[1];
  const assertive = region.children[2];
  assert.equal(polite.getAttribute("role"), "status");
  assert.equal(assertive.getAttribute("role"), "alert");
  assert.equal(stack.children[0].getAttribute("role"), "group", "Toast card must not create nested live region alongside polite/assertive");

  // Put focus inside the first toast's button, then fire an incoming error that must evict the idle toast instead.
  doc.activeElement = stack.children[0].querySelector(".ds-toast-action");
  mgr.error("严重错误：需要关注");
  const snap = mgr.snapshot();
  assert.ok(snap.visible.some((t) => t.id === idFocused), "Focused interactive toast must not be evicted by incoming error");
  assert.ok(!snap.visible.some((t) => t.id === idOther), "Idle non-focused toast should yield to error");

  // Escape on focused toast dismisses it cleanly and moves focus to remaining visible toast.
  stack.children[0].dispatchEvent("keydown", { key: "Escape", target: doc.activeElement, preventDefault() {}, stopPropagation() {} });
  region.dispatchEvent("keydown", { key: "Escape", target: doc.activeElement, preventDefault() {}, stopPropagation() {} });
  assert.ok(!mgr.snapshot().visible.some((t) => t.id === idFocused));

  // Route change invalidates scoped non-error requests without hiding errors.
  const route2Token = mgr.invalidateContext({ includeErrors: false });
  assert.notEqual(route2Token, oldRouteToken);
  const dropped = mgr.success("延迟成功消息", { contextToken: oldRouteToken, scoped: true });
  assert.equal(dropped, null, "Superseded route token must drop stale success toast");

  const kept = mgr.warning("可取消提示", { dedupeKey: "k:warn" });
  assert.ok(kept);
  mgr.dismissByKey("k:warn");
  assert.ok(!mgr.snapshot().visible.some((t) => t.dedupeKey === "k:warn"));

  mgr.dispose();
  assert.equal(timers.size, 0);
});

test("I09-04 createFeatureConsole preserves server kill switch warnings on unsaved uncheck, cancel, and load failure", async () => {
  const nodes = new Map();
  const makeNode = (id, tag = "div") => {
    const classes = new Set();
    const attrs = new Map();
    const listeners = new Map();
    const n = {
      id,
      tagName: tag.toUpperCase(),
      value: "",
      checked: false,
      disabled: false,
      readOnly: false,
      dataset: {},
      textContent: "",
      children: [],
      classList: {
        add(...xs) { xs.forEach((x) => classes.add(x)); },
        remove(...xs) { xs.forEach((x) => classes.delete(x)); },
        toggle(x, f) { const on = f === undefined ? !classes.has(x) : Boolean(f); if (on) classes.add(x); else classes.delete(x); return on; },
        contains(x) { return classes.has(x); },
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); },
      dispatchEvent(t, ev = {}) { for (const fn of [...(listeners.get(t) || [])]) fn(ev); },
      querySelectorAll() { return []; },
      append() {},
      replaceChildren(...els) {
        n.children = els;
        if (id === "featureFlagSelect") n.value = els[0]?.value || "";
      },
    };
    nodes.set(id, n);
    return n;
  };
  for (const id of [
    "featureFlagSelect", "featureFlagKey", "featureFlagDescription", "featureFlagEnabled",
    "featureFlagKillSwitch", "featureFlagPercentage", "featureChannel_stable", "featureChannel_beta",
    "featureChannel_experimental", "featureFlagForm", "featureFlagStateCapsule", "featureFlagRolloutCapsule",
    "featureFlagChannelCapsules", "featureFlagRevisionCapsule", "featureFlagKillWarning", "featureConsoleStatus",
    "featureFlagAudit", "featureFlagAuditTimeline", "featureFlagSummaryList", "saveFeatureFlagBtn",
    "refreshFeatureFlagsBtn", "newFeatureFlagBtn", "adminFeatureFlagsTab", "featureOverrideUser",
    "featureEvaluateUser", "featureEvaluationResult", "learningMetrics",
  ]) makeNode(id);

  let failLoad = false;
  let mutateError = null;
  let serverKill = true;
  const doc = {
    getElementById: (id) => nodes.get(id) || null,
    createElement: (tag) => makeNode(`anon_${Math.random()}`, tag),
  };
  const fc = createFeatureConsole({
    document: doc,
    getAccount: () => ({ id: "owner-1", is_admin: true, is_super_admin: true }),
    refreshFeatures: async () => {},
    apiGet: async () => {
      if (failLoad) throw new Error("权限校验失败 (403)");
      return {
        flags: [{
          flag_key: "p07_accessibility",
          description: "UI flag",
          enabled: true,
          kill_switch: serverKill,
          channels: ["stable", "beta", "experimental"],
          rollout_percentage: 100,
          revision: 4,
        }],
        audit: [],
      };
    },
    api: async () => {
      if (mutateError) throw mutateError;
      return { ok: true };
    },
  });
  fc.setAvailable(true);
  await fc.load();

  assert.equal(nodes.get("featureFlagKillWarning").classList.contains("hidden"), false);
  assert.equal(nodes.get("featureFlagKillWarning").dataset.killMode, "active");

  // Uncheck kill switch locally without saving -> server kill switch warning MUST stay visible!
  nodes.get("featureFlagKillSwitch").checked = false;
  nodes.get("featureFlagForm").dispatchEvent("change", {});
  assert.equal(nodes.get("featureFlagKillWarning").classList.contains("hidden"), false, "Server kill warning must remain visible before save succeeds");
  assert.equal(nodes.get("featureFlagKillWarning").dataset.killMode, "pending-clear");
  assert.equal(nodes.get("featureFlagStateCapsule").dataset.state, "kill");

  // Saving gets cancelled -> error message honest & warning preserved.
  mutateError = new Error("操作已取消");
  nodes.get("featureFlagForm").dispatchEvent("submit", { preventDefault() {} });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(nodes.get("featureConsoleStatus").dataset.feedbackState, "info");
  assert.equal(nodes.get("featureFlagKillWarning").classList.contains("hidden"), false);

  // Subsequent failed refresh (403) must NOT clear kill switch warning or discard draft.
  failLoad = true;
  await fc.load();
  assert.equal(nodes.get("featureConsoleStatus").dataset.feedbackState, "error");
  assert.equal(nodes.get("featureFlagKillWarning").classList.contains("hidden"), false);
});

test("I09-03 createFeatureController retains valid snapshot & selection for retry on save failure", async () => {
  const nodes = new Map();
  const makeNode = (id) => {
    const classes = new Set();
    const attrs = new Map();
    const listeners = new Map();
    const n = {
      id,
      value: "stable",
      disabled: false,
      dataset: {},
      textContent: "",
      classList: {
        toggle(x, f) { const on = f === undefined ? !classes.has(x) : Boolean(f); if (on) classes.add(x); else classes.delete(x); return on; },
      },
      toggleAttribute(k, f) {
        const on = f === undefined ? !attrs.has(k) : Boolean(f);
        if (on) attrs.set(k, ""); else attrs.delete(k);
        if (k === "disabled") n.disabled = on;
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); },
      dispatchEvent(t, ev = {}) { for (const fn of [...(listeners.get(t) || [])]) fn(ev); },
    };
    nodes.set(id, n);
    return n;
  };
  for (const id of ["releaseChannelSection", "releaseChannelSelect", "saveReleaseChannelBtn", "refreshReleaseChannelBtn", "releaseChannelStatus", "experimentalFeatureBadge"]) {
    makeNode(id);
  }
  const now = Date.now();
  const future = new Date(now + 25_000).toISOString();
  const doc = {
    hidden: false,
    getElementById: (id) => nodes.get(id) || null,
    addEventListener() {},
  };
  let shouldFailSave = true;
  const ctrl = createFeatureController({
    document: doc,
    getAccount: () => ({ id: "u1" }),
    apiGet: async () => ({
      snapshot: {
        schema_version: 1,
        account_id: "u1",
        channel: "stable",
        channel_revision: 1,
        max_age_seconds: 30,
        expires_at: future,
        flags: {},
      },
    }),
    api: async (_path, body) => {
      if (shouldFailSave) throw new Error("网络超时，请重试");
      return {
        snapshot: {
          schema_version: 1,
          account_id: "u1",
          channel: body.channel,
          channel_revision: 2,
          max_age_seconds: 30,
          expires_at: future,
          flags: {},
        },
      };
    },
  });
  ctrl.setAvailable(true);
  ctrl.updateAccount();
  await new Promise((r) => setTimeout(r, 15));

  nodes.get("releaseChannelSelect").value = "beta";
  nodes.get("releaseChannelSelect").dispatchEvent("change");
  nodes.get("saveReleaseChannelBtn").dispatchEvent("click");
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(nodes.get("releaseChannelStatus").dataset.feedbackState, "error");
  assert.equal(nodes.get("releaseChannelSelect").value, "beta", "Failed save must preserve user's selected channel");
  assert.equal(nodes.get("saveReleaseChannelBtn").disabled, false, "Retry button must remain enabled after failed save");

  // Retry succeeds -> updates state to success.
  shouldFailSave = false;
  nodes.get("saveReleaseChannelBtn").dispatchEvent("click");
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(nodes.get("releaseChannelStatus").dataset.feedbackState, "success");
  assert.equal(ctrl.channel(), "beta");
});
